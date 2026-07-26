import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ReflectionConsolidationProposal,
  ReflectionMemoryDomain,
} from '@veritas-kanban/shared';
import { REFLECTION_CONSOLIDATION_SCHEMA_VERSION } from '@veritas-kanban/shared';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';

const MAX_PROPOSALS = 500;

interface ProposalState {
  version: 1;
  proposals: ReflectionConsolidationProposal[];
}

export interface ReflectionConsolidationProposalRepository {
  get(id: string): Promise<ReflectionConsolidationProposal | undefined>;
  list(domain?: ReflectionMemoryDomain): Promise<ReflectionConsolidationProposal[]>;
  put(proposal: ReflectionConsolidationProposal): Promise<ReflectionConsolidationProposal>;
}

export class FileReflectionConsolidationProposalRepository implements ReflectionConsolidationProposalRepository {
  private readonly storageDir: string;
  private readonly statePath: string;

  constructor(storageDir = path.join(getRuntimeDir(), 'reflections')) {
    this.storageDir = storageDir;
    this.statePath = path.join(storageDir, 'consolidation-proposals.json');
    ensureWithinBase(storageDir, this.statePath);
  }

  async get(id: string): Promise<ReflectionConsolidationProposal | undefined> {
    return (await this.read()).proposals.find((proposal) => proposal.id === id);
  }

  async list(domain?: ReflectionMemoryDomain): Promise<ReflectionConsolidationProposal[]> {
    const proposals = (await this.read()).proposals;
    return proposals
      .filter((proposal) => !domain || sameDomain(proposal.domain, domain))
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
          left.id.localeCompare(right.id)
      );
  }

  async put(proposal: ReflectionConsolidationProposal): Promise<ReflectionConsolidationProposal> {
    await fs.mkdir(this.storageDir, { recursive: true });
    return withFileLock(this.statePath, async () => {
      const state = await this.read();
      const existing = state.proposals.find((item) => item.id === proposal.id);
      if (existing) return existing;
      state.proposals.push(proposal);
      state.proposals = state.proposals
        .sort(
          (left, right) =>
            Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
            left.id.localeCompare(right.id)
        )
        .slice(-MAX_PROPOSALS);
      await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf8');
      return proposal;
    });
  }

  private async read(): Promise<ProposalState> {
    try {
      const parsed = JSON.parse(
        await fs.readFile(this.statePath, 'utf8')
      ) as Partial<ProposalState>;
      return {
        version: 1,
        proposals: Array.isArray(parsed.proposals) ? parsed.proposals.filter(isProposal) : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, proposals: [] };
      }
      throw error;
    }
  }
}

function isProposal(value: unknown): value is ReflectionConsolidationProposal {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ReflectionConsolidationProposal).schemaVersion ===
      REFLECTION_CONSOLIDATION_SCHEMA_VERSION &&
    typeof (value as ReflectionConsolidationProposal).id === 'string' &&
    Array.isArray((value as ReflectionConsolidationProposal).diff)
  );
}

function sameDomain(left: ReflectionMemoryDomain, right: ReflectionMemoryDomain): boolean {
  return left.kind === right.kind && left.id === right.id && left.workspaceId === right.workspaceId;
}
