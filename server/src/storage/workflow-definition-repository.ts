import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'yaml';
import { withFileLock } from '../services/file-lock.js';
import type { WorkflowACL, WorkflowAuditEvent, WorkflowDefinition } from '../types/workflow.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_WORKFLOW_BYTES = 2 * 1024 * 1024;
const MAX_ACL_BYTES = 2 * 1024 * 1024;
const MAX_AUDIT_BYTES = 64 * 1024 * 1024;

type WorkflowMetadata = Pick<WorkflowDefinition, 'id' | 'name' | 'version' | 'description'>;

export class FileWorkflowDefinitionRepository {
  private readonly workflowsDir: string;

  constructor(workflowsDir: string) {
    this.workflowsDir = path.resolve(workflowsDir);
    ensureWithinBase(path.dirname(this.workflowsDir), this.workflowsDir);
  }

  async count(): Promise<number> {
    return (await this.listDefinitionFiles()).length;
  }

  async get(id: string): Promise<WorkflowDefinition | null> {
    const content = await this.readBoundedFile(this.getWorkflowPath(id), MAX_WORKFLOW_BYTES, true);
    return content === null ? null : (yaml.parse(content) as WorkflowDefinition);
  }

  async list(): Promise<WorkflowDefinition[]> {
    const workflows: WorkflowDefinition[] = [];
    for (const file of await this.listDefinitionFiles()) {
      const content = await this.readBoundedFile(
        ensureWithinBase(this.workflowsDir, path.join(this.workflowsDir, file)),
        MAX_WORKFLOW_BYTES,
        false
      );
      if (content === null) throw new Error('Workflow definition disappeared while listing');
      workflows.push(yaml.parse(content) as WorkflowDefinition);
    }
    return workflows;
  }

  async listMetadata(): Promise<WorkflowMetadata[]> {
    const metadata: WorkflowMetadata[] = [];
    for (const file of await this.listDefinitionFiles()) {
      try {
        const content = await this.readBoundedFile(
          ensureWithinBase(this.workflowsDir, path.join(this.workflowsDir, file)),
          MAX_WORKFLOW_BYTES,
          false
        );
        if (content === null) continue;
        const workflow = yaml.parse(content) as Partial<WorkflowDefinition> | null;
        if (
          !workflow ||
          typeof workflow.id !== 'string' ||
          typeof workflow.name !== 'string' ||
          typeof workflow.version !== 'number'
        ) {
          continue;
        }
        metadata.push({
          id: workflow.id,
          name: workflow.name,
          version: workflow.version,
          description: workflow.description,
        });
      } catch {
        // Preserve the legacy metadata behavior by skipping unreadable definitions.
      }
    }
    return metadata;
  }

  async save(workflow: WorkflowDefinition): Promise<void> {
    const workflowPath = this.getWorkflowPath(workflow.id);
    const content = yaml.stringify(workflow);
    this.assertBounded(content, MAX_WORKFLOW_BYTES, 'Workflow definition');
    await this.prepareDirectory();
    await withFileLock(workflowPath, () => atomicWriteFile(workflowPath, content, 'utf8'));
  }

  async delete(id: string): Promise<boolean> {
    const workflowPath = this.getWorkflowPath(id);
    await this.prepareDirectory();
    return withFileLock(workflowPath, async () => {
      try {
        await unlink(workflowPath);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    });
  }

  async getAcl(workflowId: string): Promise<WorkflowACL | null> {
    const content = await this.readBoundedFile(this.getAclPath(), MAX_ACL_BYTES, true);
    if (content === null) return null;
    const acls = JSON.parse(content) as Record<string, WorkflowACL>;
    return acls[workflowId] ?? null;
  }

  async saveAcl(acl: WorkflowACL): Promise<void> {
    const aclPath = this.getAclPath();
    await this.prepareDirectory();
    await withFileLock(aclPath, async () => {
      const current = await this.readBoundedFile(aclPath, MAX_ACL_BYTES, true);
      const acls = current === null ? {} : (JSON.parse(current) as Record<string, WorkflowACL>);
      acls[acl.workflowId] = acl;
      const content = JSON.stringify(acls, null, 2);
      this.assertBounded(content, MAX_ACL_BYTES, 'Workflow ACL state');
      await atomicWriteFile(aclPath, content, 'utf8');
    });
  }

  async appendAuditEvent(event: WorkflowAuditEvent): Promise<void> {
    const auditPath = this.getAuditPath();
    const line = `${JSON.stringify(event)}\n`;
    this.assertBounded(line, MAX_AUDIT_BYTES, 'Workflow audit event');
    await this.prepareDirectory();

    await withFileLock(auditPath, async () => {
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(
          auditPath,
          constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
          0o600
        );
        const stats = await handle.stat();
        if (!stats.isFile() || stats.size + Buffer.byteLength(line, 'utf8') > MAX_AUDIT_BYTES) {
          throw new Error('Workflow audit log must use a bounded regular file');
        }
        await handle.writeFile(line, { encoding: 'utf8' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
          throw new Error('Workflow audit log must not be a symbolic link', { cause: error });
        }
        throw error;
      } finally {
        await handle?.close();
      }
    });
  }

  private getWorkflowPath(id: string): string {
    const safeId = validatePathSegment(id);
    return ensureWithinBase(this.workflowsDir, path.join(this.workflowsDir, `${safeId}.yml`));
  }

  private getAclPath(): string {
    return ensureWithinBase(this.workflowsDir, path.join(this.workflowsDir, '.acl.json'));
  }

  private getAuditPath(): string {
    return ensureWithinBase(this.workflowsDir, path.join(this.workflowsDir, '.audit.jsonl'));
  }

  private async listDefinitionFiles(): Promise<string[]> {
    await this.prepareDirectory();
    const entries = await readdir(this.workflowsDir);
    return entries.filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'));
  }

  private async prepareDirectory(): Promise<void> {
    await mkdir(this.workflowsDir, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.workflowsDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Workflow storage path must use a regular directory');
    }
  }

  private async readBoundedFile(
    filePath: string,
    maximumBytes: number,
    missingAsNull: boolean
  ): Promise<string | null> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > maximumBytes) {
        throw new Error('Workflow storage must use a bounded regular file');
      }
      return await handle.readFile({ encoding: 'utf8' });
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (missingAsNull && errorCode === 'ENOENT') return null;
      if (errorCode === 'ELOOP') {
        throw new Error('Workflow storage must not use symbolic links', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private assertBounded(content: string, maximumBytes: number, label: string): void {
    if (Buffer.byteLength(content, 'utf8') > maximumBytes) {
      throw new Error(`${label} exceeds the ${maximumBytes}-byte storage limit`);
    }
  }
}
