// Settings → Providers (#362): the keys added on the Providers page and the MCP servers the office gives its agents
// (server/providers.ts), every change sent to the tabs as a `providers` event, the page's cards for the CEO's
// company_status line. Claude and Codex accounts, the ElevenLabs key and the Upstash key stay where they were.
// Keys found on this computer (#367): the scan's values stay in this layer's memory until imported or dismissed; the
// tabs, the notification and the CEO get the last 4 characters and the test result only (shared/keyScan.ts).
import path from 'node:path';
import { HOME_DIR } from '../config.ts';
import { Providers } from '../providers.ts';
import { CliSetup, cliBinDir, cliPrefix } from '../cliInstall.ts';
import { useOfficeCliBin } from '../clis.ts';
import { providerCards, providerDef, providersLine, type McpInput } from '../../shared/providers.ts';
import { checkRequest, checkResult, foundView, importName, importSource, keyScanText, mergeFound, scanSummary, type FoundKey } from '../../shared/keyScan.ts';
import { redact } from '../../shared/journal.ts';
import type { KeyScanView, ProvidersView, WorldSnapshot } from '../../shared/types.ts';
import { SwarmCloudCredit } from './cloudCredit.ts';

export abstract class SwarmProviders extends SwarmCloudCredit {
  readonly providers = new Providers({
    file: path.join(HOME_DIR, this.backend.demo ? 'demo-providers.json' : 'providers.json'),
    secretsFile: path.join(HOME_DIR, this.backend.demo ? 'demo-providers-secrets.json' : 'secrets.json'),
    probe: (req) => this.backend.providerProbe(req),
    changed: (view) => this.providersChanged(view),
  });

  /** Coding-agent CLIs installed from Settings (#493): looked for at startup and again after an install or "Check again". */
  readonly cliSetup = new CliSetup({
    detect: () => (useOfficeCliBin(cliBinDir(cliPrefix(HOME_DIR))), this.backend.detectClis()),
    install: (id) => this.backend.installCli(id, cliPrefix(HOME_DIR)),
    signIn: (term, exited) => this.backend.opencodeSignIn(term, exited),
    changed: (clis) => {
      this.clis = clis;
      this.broadcast({ type: 'clis', clis });
    },
  });

  /** A sign-in that couldn't start: its CLI may have gone, or come. */
  protected recheckClis() {
    void this.cliSetup.check().catch((err) => console.warn('could not look for agent CLIs', err));
  }

  private found: FoundKey[] = [];
  private keyScan: KeyScanView = { state: 'idle', at: null, keys: [] };
  private scanning: Promise<KeyScanView> | null = null;

  protected providersChanged(providers: ProvidersView) {
    this.broadcast({ type: 'providers', providers });
  }

  override snapshot(): WorldSnapshot {
    return { ...super.snapshot(), providers: this.providers.view(), keyScan: this.keyScan };
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
    return [...super.secrets(), ...this.providers.secretValues(), ...this.found.map((f) => f.value)];
  }

  // ---------- keys found on this computer (#367) ----------

  private setKeyScan(v: KeyScanView) {
    this.keyScan = v;
    this.broadcast({ type: 'keyScan', keyScan: v });
  }

  keyScanView(): KeyScanView {
    return this.keyScan;
  }

  /** Scan, test every key, and tell the manager; one at a time (a second call gets the running one). */
  scanKeys(): Promise<KeyScanView> {
    this.scanning ??= this.runKeyScan().finally(() => (this.scanning = null));
    return this.scanning;
  }

  private async runKeyScan(): Promise<KeyScanView> {
    this.setKeyScan({ ...this.keyScan, state: 'scanning' });
    try {
      const found = mergeFound(await this.backend.scanForKeys(), this.providers.savedKeys());
      await Promise.all(
        found.map(async (f) => {
          const req = checkRequest(f.provider, f.value);
          f.check = req ? checkResult(f.provider, await this.backend.providerProbe(req)) : { result: 'unknown', note: 'No integration to test it with yet' };
        }),
      );
      this.found = found;
      this.setKeyScan({ state: 'done', at: Date.now(), keys: found.map(foundView) });
      this.notice({ kind: 'keys', title: scanSummary(this.keyScan.keys), text: 'Review them in Settings → Providers: live ones are ticked, nothing is saved until you import.', actions: ['reviewKeys'] });
    } catch (err) {
      this.found = [];
      this.setKeyScan({ state: 'failed', at: Date.now(), keys: [], note: redact((err as Error).message, this.secrets()).slice(0, 200) });
    }
    return this.keyScan;
  }

  /** "Import selected": each one a Providers connection (tested again); duplicates and keys without an integration skipped. */
  async importKeys(ids: readonly string[]): Promise<{ imported: number; skipped: string[] }> {
    let imported = 0;
    const skipped: string[] = [];
    for (const f of this.found.filter((x) => ids.includes(x.id))) {
      const v = foundView(f);
      const name = `${providerDef(f.provider)?.name ?? 'Unknown provider'} ••••${v.keyHint}`;
      if (!v.importable) {
        skipped.push(`${name}: ${f.savedAs ? `already saved as ${f.savedAs}` : 'no integration to import it into yet'}`);
        continue;
      }
      try {
        f.savedAs = (await this.providers.add(f.provider, f.value, importName(f.provider, f.variable), importSource(f))).label;
        imported++;
      } catch (err) {
        skipped.push(`${name}: ${(err as Error).message}`);
      }
    }
    this.setKeyScan({ ...this.keyScan, keys: this.found.map(foundView) });
    return { imported, skipped };
  }

  /** Forget what the scan found (the values leave memory); the files are never touched. */
  dismissKeys() {
    this.found = [];
    this.setKeyScan({ state: 'idle', at: null, keys: [] });
  }

  /** scan_keys: the last scan's rows, or a new scan (when asked, or none yet) awaited. */
  async keyScanForCeo(rescan: boolean): Promise<string> {
    if (this.scanning) await this.scanning;
    else if (rescan || this.keyScan.state === 'idle' || this.keyScan.state === 'failed') await this.scanKeys();
    return keyScanText(this.keyScan);
  }
}
