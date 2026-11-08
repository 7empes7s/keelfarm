// Settings → Providers (#362): the keys added on the Providers page and the MCP servers the office gives its agents
// (server/providers.ts), every change sent to the tabs as a `providers` event, the page's cards for the CEO's
// company_status line. Claude and Codex accounts, the ElevenLabs key and the Upstash key stay where they were.
import path from 'node:path';
import { HOME_DIR } from '../config.ts';
import { Providers } from '../providers.ts';
import { providerCards, providersLine, type McpInput } from '../../shared/providers.ts';
import type { ProvidersView, WorldSnapshot } from '../../shared/types.ts';
import { SwarmCloudCredit } from './cloudCredit.ts';

export abstract class SwarmProviders extends SwarmCloudCredit {
  readonly providers = new Providers({
    file: path.join(HOME_DIR, this.backend.demo ? 'demo-providers.json' : 'providers.json'),
    secretsFile: path.join(HOME_DIR, this.backend.demo ? 'demo-providers-secrets.json' : 'secrets.json'),
    probe: (req) => this.backend.providerProbe(req),
    changed: (view) => this.providersChanged(view),
  });

  protected providersChanged(providers: ProvidersView) {
    this.broadcast({ type: 'providers', providers });
  }

  override snapshot(): WorldSnapshot {
    return { ...super.snapshot(), providers: this.providers.view() };
  }

  /** Read the saved ones; a fresh demo office gets a made-up connection in every category. */
  protected async initProviders() {
    await this.providers.init();
    const seed = this.backend.demoProviders?.();
    const v = this.providers.view();
    if (!seed || v.connections.length || v.mcp.length) return;
    for (const k of seed.keys) await this.providers.add(k.provider, k.key, k.label);
    for (const m of seed.mcp) await this.providers.addMcp(m);
  }

  /** The CEO's company_status line: every connection, whatever stores it. */
  protected providersLine(): string {
    const names = new Map(this.state.agents.map((a) => [a.id, a.name]));
    return providersLine(
      providerCards({
        accounts: this.accounts.view().accounts,
        voiceKeySet: this.voice.keyView().voiceKeySet,
        voiceKeyHint: '',
        cloud: this.cloud.view(),
        providers: this.providers.view(),
        clis: this.clis,
        agentName: (id) => names.get(id) ?? id,
        cloudAgents: this.state.agents.filter((a) => a.host === 'box').length,
      }),
    );
  }

  addMcpServer(input: McpInput & { secrets?: Record<string, string> }) {
    return this.providers.addMcp({ ...input, agents: (input.agents ?? []).filter((id) => this.state.agents.some((a) => a.id === id)) });
  }

  protected override secrets(): string[] {
    return [...super.secrets(), ...this.providers.secretValues()];
  }
}
