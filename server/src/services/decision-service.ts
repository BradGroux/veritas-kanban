import { nanoid } from 'nanoid';
import type {
  CreateDecisionInput,
  DecisionListFilters,
  DecisionRecord,
  DecisionAssumption,
  UpdateDecisionAssumptionInput,
} from '@veritas-kanban/shared';
import { createLogger } from '../lib/logger.js';
import { BadRequestError, NotFoundError } from '../middleware/error-handler.js';
import { fileExists, mkdir, readFile, readdir, writeFile } from '../storage/fs-helpers.js';
import { getDecisionsDir } from '../utils/paths.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';

const log = createLogger('decision-service');

export class DecisionService {
  private readonly decisionsDir = getDecisionsDir();

  private async ensureDir(): Promise<void> {
    await mkdir(this.decisionsDir, { recursive: true });
  }

  private getDecisionPath(id: string): string {
    validatePathSegment(id);
    const target = ensureWithinBase(this.decisionsDir, `${this.decisionsDir}/${id}.json`);
    return target;
  }

  private normalizeAssumptions(
    assumptions: CreateDecisionInput['assumptions'] | undefined,
    timestamp: string
  ): DecisionAssumption[] {
    return (assumptions ?? []).map((assumption) => ({
      text: typeof assumption === 'string' ? assumption : assumption.text,
      status: 'pending',
      updatedAt: timestamp,
    }));
  }

  private async readDecision(id: string): Promise<DecisionRecord | null> {
    const filePath = this.getDecisionPath(id);
    if (!(await fileExists(filePath))) {
      return null;
    }

    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as DecisionRecord;
  }

  private async writeDecision(decision: DecisionRecord): Promise<void> {
    await this.ensureDir();
    await writeFile(this.getDecisionPath(decision.id), JSON.stringify(decision, null, 2), 'utf8');
  }

  async create(input: CreateDecisionInput): Promise<DecisionRecord> {
    const timestamp = input.timestamp ?? new Date().toISOString();

    if (input.parentDecisionId) {
      const parent = await this.readDecision(input.parentDecisionId);
      if (!parent) {
        throw new BadRequestError(`Parent decision not found: ${input.parentDecisionId}`);
      }
    }

    const decision: DecisionRecord = {
      id: `decision_${Date.now()}_${nanoid(6)}`,
      inputContext: input.inputContext,
      outputAction: input.outputAction,
      assumptions: this.normalizeAssumptions(input.assumptions, timestamp),
      confidenceLevel: input.confidenceLevel,
      riskScore: input.riskScore,
      parentDecisionId: input.parentDecisionId,
      agentId: input.agentId,
      taskId: input.taskId,
      timestamp,
    };

    await this.writeDecision(decision);
    return decision;
  }

  async list(filters: DecisionListFilters = {}): Promise<DecisionRecord[]> {
    await this.ensureDir();
    const files = await readdir(this.decisionsDir);
    const decisions = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => JSON.parse(await readFile(`${this.decisionsDir}/${file}`, 'utf8')))
    );

    return (decisions as DecisionRecord[])
      .filter((decision) => {
        const timestamp = new Date(decision.timestamp).getTime();
        const startTime = filters.startTime ? new Date(filters.startTime).getTime() : undefined;
        const endTime = filters.endTime ? new Date(filters.endTime).getTime() : undefined;

        if (filters.agent && decision.agentId !== filters.agent) return false;
        if (startTime !== undefined && timestamp < startTime) return false;
        if (endTime !== undefined && timestamp > endTime) return false;
        if (
          filters.minConfidence !== undefined &&
          decision.confidenceLevel < filters.minConfidence
        ) {
          return false;
        }
        if (
          filters.maxConfidence !== undefined &&
          decision.confidenceLevel > filters.maxConfidence
        ) {
          return false;
        }
        if (filters.minRisk !== undefined && decision.riskScore < filters.minRisk) return false;
        if (filters.maxRisk !== undefined && decision.riskScore > filters.maxRisk) return false;
        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async getById(id: string): Promise<DecisionRecord | null> {
    return this.readDecision(id);
  }

  async getChain(id: string): Promise<DecisionRecord[]> {
    const visited = new Set<string>();
    const chain: DecisionRecord[] = [];
    let current = await this.readDecision(id);

    while (current) {
      if (visited.has(current.id)) {
        log.warn({ id, currentId: current.id }, 'Decision chain cycle detected');
        break;
      }

      visited.add(current.id);
      chain.push(current);

      if (!current.parentDecisionId) {
        break;
      }

      current = await this.readDecision(current.parentDecisionId);
    }

    return chain.reverse();
  }

  async updateAssumption(
    id: string,
    index: number,
    input: UpdateDecisionAssumptionInput
  ): Promise<DecisionRecord> {
    const decision = await this.readDecision(id);
    if (!decision) {
      throw new NotFoundError('Decision not found');
    }

    if (!decision.assumptions[index]) {
      throw new NotFoundError('Assumption not found');
    }

    decision.assumptions[index] = {
      ...decision.assumptions[index],
      status: input.status,
      note: input.note,
      updatedAt: new Date().toISOString(),
    };

    await this.writeDecision(decision);
    return decision;
  }
}

let instance: DecisionService | null = null;

export function getDecisionService(): DecisionService {
  if (!instance) {
    instance = new DecisionService();
  }
  return instance;
}
