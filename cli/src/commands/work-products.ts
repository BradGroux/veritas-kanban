import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { Command } from 'commander';
import chalk from 'chalk';
import type { WorkProduct, WorkProductArtifactMetadata } from '@veritas-kanban/shared';
import { API_BASE, api, assertApiPermissionForRequest, buildApiHeaders } from '../utils/api.js';

interface WorkProductArtifactRegistration {
  product: WorkProduct;
  metadata: WorkProductArtifactMetadata;
}

async function writeVerifiedArtifact(
  outputPath: string,
  content: Buffer,
  expectedSha256: string,
  force: boolean
): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error('Download response did not include a valid artifact SHA-256 digest.');
  }
  const actualSha256 = createHash('sha256').update(content).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error('Downloaded artifact bytes did not match the server integrity digest.');
  }

  const flags =
    constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_NOFOLLOW |
    (force ? constants.O_TRUNC : constants.O_EXCL);
  const handle = await open(outputPath, flags, 0o600);
  try {
    let offset = 0;
    while (offset < content.byteLength) {
      const { bytesWritten } = await handle.write(
        content,
        offset,
        content.byteLength - offset,
        offset
      );
      if (bytesWritten <= 0) throw new Error('Artifact download write made no progress.');
      offset += bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function printError(error: unknown): void {
  console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
  process.exitCode = 1;
}

function printProduct(product: WorkProduct): void {
  console.log(chalk.bold(`${product.id} ${product.title}`));
  console.log(`  ${product.kind} v${product.version} | ${product.status}`);
  if (product.render.kind === 'file') {
    const artifact = product.render.artifact;
    console.log(`  ${artifact.safeName} | ${artifact.mediaType} | ${artifact.byteSize} bytes`);
    console.log(`  SHA-256 ${artifact.sha256}`);
    console.log(`  ${artifact.state} | run ${artifact.runId} | attempt ${artifact.attemptId}`);
  }
}

export function registerWorkProductCommands(program: Command): void {
  const workProducts = program
    .command('work-products')
    .description('Register, inspect, list, and download governed work products');

  workProducts
    .command('register')
    .description('Register a file from the current run artifact root')
    .requiredOption('--task <id>', 'Producing task ID')
    .requiredOption('--run <id>', 'Producing run ID')
    .requiredOption('--attempt <id>', 'Producing attempt ID')
    .requiredOption('--request-id <id>', 'Stable request ID for idempotent retries')
    .requiredOption('--event <id>', 'Causal producing event ID')
    .requiredOption('--path <relative-path>', 'File path relative to the granted artifact root')
    .requiredOption('--title <text>', 'Work product title')
    .requiredOption('--media-type <type>', 'Artifact media type')
    .option('--product <id>', 'Existing file Work Product ID to create a new version')
    .option('--json', 'Output stable JSON')
    .action(async (options) => {
      try {
        const registration = await api<WorkProductArtifactRegistration>(
          '/api/work-products/artifacts/register',
          {
            method: 'POST',
            body: JSON.stringify({
              taskId: options.task,
              runId: options.run,
              attemptId: options.attempt,
              requestId: options.requestId,
              producingEventId: options.event,
              relativePath: options.path,
              title: options.title,
              mediaType: options.mediaType,
              workProductId: options.product,
            }),
          }
        );
        if (options.json) console.log(JSON.stringify(registration, null, 2));
        else printProduct(registration.product);
      } catch (error) {
        printError(error);
      }
    });

  workProducts
    .command('inspect <id>')
    .description('Inspect one governed file Work Product')
    .option('--json', 'Output stable JSON')
    .action(async (id, options) => {
      try {
        const product = await api<WorkProduct>(
          `/api/work-products/${encodeURIComponent(id)}/artifact`
        );
        if (options.json) console.log(JSON.stringify(product, null, 2));
        else printProduct(product);
      } catch (error) {
        printError(error);
      }
    });

  workProducts
    .command('list')
    .description('List governed file Work Products')
    .option('--task <id>', 'Filter by task ID')
    .option('--run <id>', 'Filter by source run ID')
    .option('--include-archived', 'Include archived Work Products')
    .option('--limit <count>', 'Maximum records', '100')
    .option('--json', 'Output stable JSON')
    .action(async (options) => {
      try {
        const query = new URLSearchParams({ limit: options.limit });
        if (options.task) query.set('taskId', options.task);
        if (options.run) query.set('sourceRunId', options.run);
        if (options.includeArchived) query.set('includeArchived', 'true');
        const products = await api<WorkProduct[]>(
          `/api/work-products/artifacts?${query.toString()}`
        );
        if (options.json) console.log(JSON.stringify(products, null, 2));
        else if (products.length === 0) console.log(chalk.dim('No file Work Products matched.'));
        else products.forEach(printProduct);
      } catch (error) {
        printError(error);
      }
    });

  workProducts
    .command('download <id>')
    .description('Download one immutable artifact version')
    .requiredOption('--output <path>', 'Destination file path')
    .option('--version <number>', 'Specific Work Product version')
    .option('--force', 'Overwrite an existing destination file')
    .option('--json', 'Output stable JSON')
    .action(async (id, options) => {
      try {
        const query = new URLSearchParams();
        if (options.version) query.set('version', options.version);
        const suffix = query.size > 0 ? `?${query.toString()}` : '';
        const requestPath = `/api/work-products/${encodeURIComponent(id)}/artifact/download${suffix}`;
        await assertApiPermissionForRequest(requestPath);
        const response = await fetch(`${API_BASE}${requestPath}`, {
          headers: buildApiHeaders({ accept: 'application/octet-stream' }),
        });
        if (!response.ok) {
          const detail = await response.text();
          throw new Error(detail || `Download failed with HTTP ${response.status}`);
        }
        const content = Buffer.from(await response.arrayBuffer());
        const sha256 = response.headers.get('x-artifact-sha256');
        await writeVerifiedArtifact(options.output, content, sha256 ?? '', Boolean(options.force));
        const result = {
          productId: id,
          version: options.version ? Number(options.version) : undefined,
          output: options.output,
          byteSize: content.byteLength,
          sha256,
          contentDigest: response.headers.get('content-digest') ?? undefined,
        };
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else
          console.log(chalk.green(`Downloaded ${content.byteLength} bytes to ${options.output}`));
      } catch (error) {
        printError(error);
      }
    });

  workProducts
    .command('purge <id>')
    .description('Physically delete one archived file Work Product and all immutable bodies')
    .requiredOption('--confirm <id>', 'Exact Work Product ID confirmation')
    .option('--json', 'Output stable JSON')
    .action(async (id, options) => {
      try {
        if (options.confirm !== id) {
          throw new Error('Physical purge confirmation must exactly match the Work Product ID.');
        }
        const query = new URLSearchParams({ confirm: options.confirm });
        const result = await api<{
          productId: string;
          artifactsDeleted: number;
          bytesDeleted: number;
        }>(`/api/work-products/${encodeURIComponent(id)}/artifact?${query.toString()}`, {
          method: 'DELETE',
        });
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else {
          console.log(
            chalk.green(
              `Purged ${result.artifactsDeleted} artifact versions and ${result.bytesDeleted} bytes for ${result.productId}`
            )
          );
        }
      } catch (error) {
        printError(error);
      }
    });
}
