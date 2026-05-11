import { execFile } from 'child_process';
import { promisify } from 'util';
import { ConfigService } from './config-service.js';

const execFileAsync = promisify(execFile);

export interface CodexHealthStatus {
  checkedAt: string;
  cli: {
    installed: boolean;
    path?: string;
    version?: string;
    authenticated: boolean;
    authMode?: string;
    error?: string;
  };
  sdk: {
    available: boolean;
    error?: string;
  };
  agents: {
    codexCli: boolean;
    codexSdk: boolean;
    codexCloud: boolean;
    enabled: string[];
  };
  ready: {
    cli: boolean;
    sdk: boolean;
    cloud: boolean;
    overall: boolean;
  };
  recommendations: string[];
}

export class CodexHealthService {
  private configService: ConfigService;

  constructor() {
    this.configService = new ConfigService();
  }

  async getHealth(): Promise<CodexHealthStatus> {
    const [cli, sdk, config] = await Promise.all([
      this.checkCli(),
      this.checkSdk(),
      this.configService.getConfig(),
    ]);

    const codexCli = config.agents.some((agent) => agent.provider === 'codex-cli');
    const codexSdk = config.agents.some((agent) => agent.provider === 'codex-sdk');
    const codexCloud = config.agents.some((agent) => agent.provider === 'codex-cloud');
    const enabled = config.agents
      .filter((agent) => agent.enabled && String(agent.provider || '').startsWith('codex'))
      .map((agent) => agent.type);

    const ready = {
      cli: cli.installed && cli.authenticated && codexCli,
      sdk: cli.installed && cli.authenticated && sdk.available && codexSdk,
      cloud: cli.installed && cli.authenticated && codexCloud,
      overall: false,
    };
    ready.overall = ready.cli || ready.sdk || ready.cloud;

    return {
      checkedAt: new Date().toISOString(),
      cli,
      sdk,
      agents: { codexCli, codexSdk, codexCloud, enabled },
      ready,
      recommendations: this.buildRecommendations(cli, sdk, {
        codexCli,
        codexSdk,
        codexCloud,
      }),
    };
  }

  private async checkCli(): Promise<CodexHealthStatus['cli']> {
    try {
      const { stdout: path } = await execFileAsync('which', ['codex']);
      const version = await execFileAsync('codex', ['--version'])
        .then(({ stdout }) => stdout.trim())
        .catch(() => undefined);
      const login = await execFileAsync('codex', ['login', 'status'])
        .then(({ stdout, stderr }) => `${stdout}${stderr}`.trim())
        .catch((error: Error) => error.message);

      const authenticated = /logged in/i.test(login);
      return {
        installed: true,
        path: path.trim(),
        version,
        authenticated,
        authMode: authenticated ? login.split(/\r?\n/)[0] : undefined,
        error: authenticated ? undefined : login,
      };
    } catch (error: any) {
      return {
        installed: false,
        authenticated: false,
        error: error.message || 'Codex CLI is not installed',
      };
    }
  }

  private async checkSdk(): Promise<CodexHealthStatus['sdk']> {
    try {
      await import('@openai/codex-sdk');
      return { available: true };
    } catch (error: any) {
      return { available: false, error: error.message || 'Codex SDK is not available' };
    }
  }

  private buildRecommendations(
    cli: CodexHealthStatus['cli'],
    sdk: CodexHealthStatus['sdk'],
    agents: { codexCli: boolean; codexSdk: boolean; codexCloud: boolean }
  ): string[] {
    const recommendations: string[] = [];
    if (!cli.installed)
      recommendations.push('Install the Codex CLI and ensure `codex` is on PATH.');
    if (cli.installed && !cli.authenticated)
      recommendations.push('Run `codex login` to authenticate.');
    if (!sdk.available)
      recommendations.push('Install server dependencies so `@openai/codex-sdk` is available.');
    if (!agents.codexCli) recommendations.push('Add the default Codex CLI agent profile.');
    if (!agents.codexSdk) recommendations.push('Add the default Codex SDK agent profile.');
    if (!agents.codexCloud) recommendations.push('Add the default Codex Cloud agent profile.');
    return recommendations;
  }
}
