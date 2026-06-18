import yaml from 'yaml';
import type {
  AgentProfileExportResult,
  AgentProfileLaunchMetadata,
  AgentProfilePackage,
  AgentProfilePackageFormat,
  AgentProfilePackageSummary,
  AgentProfileResolvedLaunch,
  AgentProfileValidationResult,
} from '@veritas-kanban/shared';
import { getConfigService, type ConfigService } from './config-service.js';
import { AgentProfilePackageSchema } from '../schemas/agent-profile-package-schemas.js';

interface ImportProfileInput {
  content: string;
  format?: AgentProfilePackageFormat;
  source?: string;
}

interface UpdateProfileInput {
  enabled?: boolean;
  displayName?: string;
  role?: string;
  description?: string;
  capabilities?: string[];
  defaultTaskTypes?: string[];
}

export class AgentProfilePackageService {
  constructor(private readonly configService: ConfigService = getConfigService()) {}

  async listProfiles(): Promise<AgentProfilePackageSummary[]> {
    const config = await this.configService.getConfig();
    return (config.agentProfiles ?? []).map((profile) => this.toSummary(profile));
  }

  async getProfile(id: string): Promise<AgentProfilePackage | null> {
    const config = await this.configService.getConfig();
    return (config.agentProfiles ?? []).find((profile) => profile.id === id) ?? null;
  }

  validateContent(input: ImportProfileInput): AgentProfileValidationResult {
    try {
      return this.validateUnknown(this.parseContent(input.content, input.format));
    } catch (error) {
      return {
        valid: false,
        issues: [{ path: '$', message: error instanceof Error ? error.message : String(error) }],
      };
    }
  }

  async importProfile(
    input: ImportProfileInput
  ): Promise<{ profile: AgentProfilePackage; created: boolean }> {
    const validation = this.validateContent(input);
    if (!validation.valid || !validation.profile) {
      const firstIssue = validation.issues[0];
      throw new Error(
        firstIssue ? `${firstIssue.path}: ${firstIssue.message}` : 'Invalid profile package'
      );
    }

    const now = new Date().toISOString();
    const profile: AgentProfilePackage = {
      ...validation.profile,
      metadata: {
        ...validation.profile.metadata,
        source: input.source ?? validation.profile.metadata?.source,
        importedAt: validation.profile.metadata?.importedAt ?? now,
        updatedAt: now,
      },
    };

    const config = await this.configService.getConfig();
    const profiles = config.agentProfiles ?? [];
    const index = profiles.findIndex((candidate) => candidate.id === profile.id);
    const created = index === -1;
    config.agentProfiles = created
      ? [...profiles, profile]
      : profiles.map((candidate) => (candidate.id === profile.id ? profile : candidate));
    await this.configService.saveConfig(config);

    return { profile, created };
  }

  async updateProfile(id: string, patch: UpdateProfileInput): Promise<AgentProfilePackage> {
    const config = await this.configService.getConfig();
    const profiles = config.agentProfiles ?? [];
    const existing = profiles.find((profile) => profile.id === id);
    if (!existing) {
      throw new Error(`Agent profile package not found: ${id}`);
    }

    const next = AgentProfilePackageSchema.parse({
      ...existing,
      ...patch,
      metadata: {
        ...existing.metadata,
        updatedAt: new Date().toISOString(),
      },
    }) as AgentProfilePackage;

    config.agentProfiles = profiles.map((profile) => (profile.id === id ? next : profile));
    await this.configService.saveConfig(config);
    return next;
  }

  async deleteProfile(id: string): Promise<void> {
    const config = await this.configService.getConfig();
    const profiles = config.agentProfiles ?? [];
    const next = profiles.filter((profile) => profile.id !== id);
    if (next.length === profiles.length) {
      throw new Error(`Agent profile package not found: ${id}`);
    }
    config.agentProfiles = next;
    await this.configService.saveConfig(config);
  }

  async exportProfile(
    id: string,
    format: AgentProfilePackageFormat
  ): Promise<AgentProfileExportResult> {
    const profile = await this.getProfile(id);
    if (!profile) {
      throw new Error(`Agent profile package not found: ${id}`);
    }
    const content =
      format === 'json' ? `${JSON.stringify(profile, null, 2)}\n` : yaml.stringify(profile);
    return { id, format, content };
  }

  async resolveLaunch(profileId: string): Promise<AgentProfileResolvedLaunch> {
    const config = await this.configService.getConfig();
    const profile = (config.agentProfiles ?? []).find((candidate) => candidate.id === profileId);
    if (!profile) {
      throw new Error(`Agent profile package not found: ${profileId}`);
    }
    if (!profile.enabled) {
      throw new Error(`Agent profile package is disabled: ${profileId}`);
    }

    const agentConfig = config.agents.find((agent) => agent.type === profile.runtime.agent);
    const metadata: AgentProfileLaunchMetadata = {
      id: profile.id,
      displayName: profile.displayName,
      version: profile.version,
      role: profile.role,
      capabilities: profile.capabilities,
      defaultTaskTypes: profile.defaultTaskTypes,
      agent: profile.runtime.agent,
      provider: profile.runtime.provider ?? agentConfig?.provider,
      model: profile.runtime.model ?? agentConfig?.model,
      sandboxPresetId: profile.policy?.sandboxPresetId ?? agentConfig?.sandboxPresetId,
      workflowId: profile.workflow?.id,
    };

    return {
      profile,
      agentConfig,
      agent: profile.runtime.agent,
      model: profile.runtime.model,
      sandboxPresetId: profile.policy?.sandboxPresetId ?? agentConfig?.sandboxPresetId,
      budget: profile.policy?.budget ?? agentConfig?.budget,
      instructions: this.buildInstructions(profile),
      metadata,
    };
  }

  private validateUnknown(value: unknown): AgentProfileValidationResult {
    const parsed = AgentProfilePackageSchema.safeParse(value);
    if (!parsed.success) {
      return {
        valid: false,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.length ? `$.${issue.path.join('.')}` : '$',
          message: issue.message,
        })),
      };
    }

    return {
      valid: true,
      profile: parsed.data as AgentProfilePackage,
      issues: [],
    };
  }

  private parseContent(content: string, format?: AgentProfilePackageFormat): unknown {
    if (format === 'json') return JSON.parse(content);
    if (format === 'yaml') return yaml.parse(content);

    try {
      return JSON.parse(content);
    } catch {
      return yaml.parse(content);
    }
  }

  private buildInstructions(profile: AgentProfilePackage): string | undefined {
    const lines: string[] = [];
    lines.push(`## Agent Profile Package`);
    lines.push('');
    lines.push(`- Profile: ${profile.displayName} (${profile.id}@${profile.version})`);
    lines.push(`- Role: ${profile.role}`);
    if (profile.capabilities.length) {
      lines.push(`- Capabilities: ${profile.capabilities.join(', ')}`);
    }
    if (profile.defaultTaskTypes.length) {
      lines.push(`- Default task types: ${profile.defaultTaskTypes.join(', ')}`);
    }
    if (profile.tools?.allowed?.length) {
      lines.push(`- Allowed tools: ${profile.tools.allowed.join(', ')}`);
    }
    if (profile.permissions?.level) {
      lines.push(`- Permission level: ${profile.permissions.level}`);
    }
    if (profile.instructions?.promptFile) {
      lines.push(`- Prompt file: ${profile.instructions.promptFile}`);
    }
    if (profile.instructions?.files?.length) {
      lines.push(`- Instruction files: ${profile.instructions.files.join(', ')}`);
    }
    if (profile.instructions?.prompt) {
      lines.push('');
      lines.push(profile.instructions.prompt);
    }

    return lines.length > 2 ? lines.join('\n') : undefined;
  }

  private toSummary(profile: AgentProfilePackage): AgentProfilePackageSummary {
    return {
      id: profile.id,
      version: profile.version,
      displayName: profile.displayName,
      role: profile.role,
      description: profile.description,
      enabled: profile.enabled,
      capabilities: profile.capabilities,
      defaultTaskTypes: profile.defaultTaskTypes,
      runtime: profile.runtime,
      policy: profile.policy,
      workflow: profile.workflow,
      metadata: profile.metadata,
    };
  }
}

let agentProfilePackageService: AgentProfilePackageService | null = null;

export function getAgentProfilePackageService(): AgentProfilePackageService {
  if (!agentProfilePackageService) {
    agentProfilePackageService = new AgentProfilePackageService();
  }
  return agentProfilePackageService;
}
