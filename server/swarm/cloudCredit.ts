// Cloud agents whose API key stopped working (#258, docs/cloud.md): out of credit, a spend limit or turned away. They
// go off the key onto their CLI's own login, the manager gets one chat card and notification per burst with the steps
// to sign them in, the CEO hears of it, and they go back on the key once it's replaced or the manager uses it again.
import { HttpError } from '../httpError.ts';
import { keyKindOf } from '../cloud.ts';
import { cliLabel } from '../clis.ts';
import { keyOwner, ownLoginStep, signInLink, signInMessage, SignInBurst } from '../../shared/keyTrouble.ts';
import type { AgentCli, AgentView, KeyTrouble } from '../../shared/types.ts';
import type { PersistedAgent } from './model.ts';
import { SwarmAgents } from './agents.ts';

/** Agents switched within this long of the first are told about in one card and one notification. */
const BURST_MS = 5_000;

interface Switched {
  id: string;
  name: string;
  cli: 'claude' | 'codex';
  why: KeyTrouble;
}

export abstract class SwarmCloudCredit extends SwarmAgents {
  protected signInBurst = new SignInBurst<Switched>(BURST_MS, (items) => this.tellSignIns(items));

  /**
   * Is this cloud agent off the office's key? Looked at as their task starts: off while the key has trouble, back on
   * it once that's gone (a new key, or "Use the key again"). The switch shows in their terminal.
   */
  protected offKey(a: PersistedAgent, cli: AgentCli): boolean {
    const step = ownLoginStep(a.ownLogin, this.cloud.trouble(cli));
    if (step.ownLogin === a.ownLogin) return !!step.ownLogin;
    if (step.ownLogin) a.ownLogin = step.ownLogin;
    else delete a.ownLogin;
    if (step.note === 'back') this.appendLog(a, [{ kind: 'done', text: "🔑 Back on the office's API key." }]);
    if (step.note === 'off') this.appendLog(a, [{ kind: 'system', text: `🔑 The office's API key ${step.ownLogin === 'out-of-credit' ? 'ran out of credit' : 'was turned away'}: ${cliLabel(cli)} uses its own sign-in in their cloud machine.` }]);
    this.emitAgent(a);
    this.save();
    return !!a.ownLogin;
  }

  /** A session showed the key it ran on stopped working: it's marked in Settings, this agent goes off it, and the CEO hears once. */
  protected keyStopped(a: PersistedAgent, cli: 'claude' | 'codex', why: KeyTrouble) {
    const news = this.cloud.markTrouble(cli, why);
    this.offKey(a, cli);
    if (!news) return;
    const what = why === 'out-of-credit' ? 'out of credit' : 'turned away';
    this.followup({
      kind: 'agentError',
      key: `credit:${keyKindOf(cli)}`,
      label: `${keyOwner(cli)} key ${what}`,
      repoId: a.repoId,
      text: `Cloud agent ${a.name} (${a.id}) switched to own login: key ${what} (${keyOwner(cli)} API key, Settings → Cloud agents). Other cloud agents on it switch at their next task; the manager signs them in, or adds credit and presses Use the key again.`,
    });
  }

  /** holdForSignIn for an agent off the key: their card joins this burst's. */
  protected creditSignIn(a: PersistedAgent, cli: 'claude' | 'codex') {
    if (a.ownLogin) this.signInBurst.add({ id: a.id, name: a.name, cli, why: a.ownLogin });
  }

  /** One card and one notification for the burst: the steps, and a row per agent still waiting. */
  private tellSignIns(items: Switched[]) {
    const waiting = items.filter((i) => this.state.agents.find((a) => a.id === i.id)?.needsSignIn);
    if (!waiting.length) return;
    const { cli, why } = waiting[0];
    const text = signInMessage(
      waiting.map((i) => i.name),
      cli,
      why,
    );
    const m = this.postMessage('office', text, undefined, { signIn: { why, cli, agents: waiting.map(({ id, name }) => ({ id, name })) } });
    const title = waiting.length === 1 ? `Sign ${waiting[0].name} in` : `${waiting.length} cloud agents need signing in`;
    this.notice({ kind: 'needsYou', title, text, target: { kind: 'agent', agentId: waiting[0].id, terminal: true }, actions: ['terminal'] }, { event: 'needsHuman', line: title, message: m.id });
  }

  // ---------- REST ----------

  /** POST /api/cloud/key-again: the manager topped the key up; cloud agents go back on it (waiting ones at once). */
  async useKeyAgain(kind: string) {
    if (kind !== 'anthropic' && kind !== 'openai') throw new HttpError(400, 'kind must be anthropic or openai');
    const view = await this.cloud.clearTrouble(kind);
    for (const a of this.state.agents) if (a.host === 'box' && a.needsSignIn) void this.checkSignIn(a);
    return view;
  }

  /** GET /api/agents/:id/sign-in-link: the link their terminal shows for signing in, for the card's Copy link. */
  signInLinkOf(id: string): { url: string | null } {
    const a = this.agent(id);
    if (a.host !== 'box' || !a.needsSignIn) throw new HttpError(409, `${a.name} doesn't need signing in.`);
    const t = this.agentRt.get(a.id)?.terminal;
    return { url: t ? signInLink(t.unwrapped()) : null };
  }

  /** POST /api/agents/:id/sign-in-check: "I've signed in": look again, and say so if they still aren't. */
  async recheckSignIn(id: string): Promise<AgentView> {
    const a = this.agent(id);
    if (a.host !== 'box') throw new HttpError(409, `${a.name} works on this computer: their coding agent signs in there.`);
    await this.checkSignIn(a);
    if (a.needsSignIn) throw new HttpError(409, `${a.name} isn't signed in yet: finish the steps in their terminal, then tap again.`);
    return this.agentView(a, false);
  }

  /**
   * The demo's stand-in for a key out of credit (POST /api/cloud/demo-credit): cloud agents get a key if they had none,
   * working ones' sessions fail the way Anthropic's would, and idle ones switch at once.
   */
  async simulateOutOfCredit() {
    const expire = this.backend.cloud.expireSignIns;
    if (!expire) throw new HttpError(404, 'Running out of credit can only be simulated in the demo office.');
    if (!this.cloud.view().claude.hint) await this.setCloudToken('anthropic', 'sk-ant-api03-demo-out-of-credit');
    expire(true);
    for (const a of this.state.agents) {
      if (a.host !== 'box' || a.task || (a.cli || this.state.settings.defaultCli) !== 'claude') continue;
      this.keyStopped(a, 'claude', 'out-of-credit');
      void this.checkSignIn(a);
    }
    return this.cloud.view();
  }
}
