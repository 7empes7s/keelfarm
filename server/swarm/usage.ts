// Usage for every account and provider (#361): the usage card's sources in the accounts view, read every minute in the
// background (server/usageSources.ts), a notification when one crosses 90% or is limited, and the Admin keys that
// let the office read Anthropic's and OpenAI's organisation cost reports (secrets.json, never shown again).
import path from 'node:path';
import { HttpError } from '../httpError.ts';
import { mergeSecrets, readSecrets } from '../secrets.ts';
import { UsageBoard, type UsageKeys } from '../usageSources.ts';
import { HOME_DIR } from '../config.ts';
import type { AccountView, UsageSource } from '../../shared/types.ts';
import { SwarmCloudCredit } from './cloudCredit.ts';

const TICK_MS = 60_000;
const ADMIN_SECRET = { anthropic: 'anthropicAdminKey', openai: 'openaiAdminKey' } as const;

export abstract class SwarmUsage extends SwarmCloudCredit {
  private adminKeys: Pick<UsageKeys, 'anthropic' | 'openai'> = { anthropic: '', openai: '' };
  private usageTimer: NodeJS.Timeout | null = null;
  private readonly secretsFile = path.join(HOME_DIR, this.backend.demo ? 'demo-secrets.json' : 'secrets.json');

  protected readonly usageBoard = new UsageBoard({
    api: this.backend.usage,
    keys: () => ({ elevenlabs: this.voice.secret(), ...this.adminKeys }),
    boxes: () => {
      const v = this.cloud.view();
      if (!v.keySet && !this.backend.demo) return null;
      const agents = this.state.agents.filter((a) => a.host === 'box').length;
      return { total: Math.max(v.boxes?.total ?? 0, agents), running: v.boxes?.running ?? 0, limit: this.state.settings.cloud.boxLimit };
    },
    spend: () => this.spend.ledger.all().filter((r) => r.type === 'session'),
    alertsFile: path.join(HOME_DIR, this.backend.demo ? 'demo-usage-alerts.json' : 'usage-alerts.json'),
    changed: () => this.accounts.emit(),
  });

  /** The usage card's rows, from the accounts' view and what the board has read (the accounts view's `sources`). */
  protected usageSources(accounts: readonly AccountView[], now: number): UsageSource[] {
    return this.usageBoard.sources(accounts, now);
  }

  /** Start reading every minute (not in tests: no network there). */
  protected async startUsage() {
    const s = await readSecrets(this.secretsFile);
    for (const p of ['anthropic', 'openai'] as const) this.adminKeys[p] = typeof s[ADMIN_SECRET[p]] === 'string' ? (s[ADMIN_SECRET[p]] as string) : '';
    if (process.env.VITEST || this.usageTimer) return;
    const tick = () => {
      this.usageBoard.tick();
      void this.usageBoard
        .check(this.accounts.view().sources ?? [])
        .then((alerts) => {
          for (const a of alerts) this.notice({ kind: 'usage', title: a.title, text: a.text }, { event: 'usage' });
        })
        .catch((err) => console.warn('could not check usage', err));
    };
    tick();
    this.usageTimer = setInterval(tick, TICK_MS);
    this.usageTimer.unref?.();
  }

  /** PUT /api/usage/admin-key: an Anthropic or OpenAI Admin key for the organisation's cost report; '' removes it. */
  async setUsageAdminKey(provider: 'anthropic' | 'openai', raw: string): Promise<{ set: boolean }> {
    const key = raw.trim();
    if (key && (key.length > 300 || /\s/.test(key))) throw new HttpError(400, "That doesn't look like an Admin key.");
    if (key && provider === 'anthropic' && !key.startsWith('sk-ant-admin')) throw new HttpError(400, 'Anthropic Admin keys start with sk-ant-admin: make one in the Console → Settings → Admin keys.');
    await mergeSecrets(this.secretsFile, { [ADMIN_SECRET[provider]]: key || undefined });
    this.adminKeys[provider] = key;
    this.usageBoard.reset(provider === 'anthropic' ? 'anthropic-org' : 'openai-org');
    this.usageBoard.tick();
    this.accounts.emit();
    return { set: !!key };
  }

  protected override secrets(): string[] {
    return [...super.secrets(), ...Object.values(this.adminKeys).filter(Boolean)];
  }
}
