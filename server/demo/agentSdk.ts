// The demo's Agent SDK check (#569): the office's own version (or an old one with SWARM_DEMO_CLAUDE_VERSION=2.1.283),
// up to date at start-up, then Check now finds a newer release, so floor 1 gets the bump issue.
// SWARM_DEMO_AGENT_SDK=fail: the registry can't be read; =stale: a week and a half behind with nothing in flight (the alarm).
import { realAgentSdk, type AgentSdkHost } from '../agentSdk.ts';
import type { SdkRelease } from '../../shared/agentSdk.ts';
import { registerDemo } from './registry.ts';

const patchOf = (v: string | null | undefined) => Number(/\d+\.\d+\.(\d+)/.exec(v ?? '')?.[1] ?? 322);
const release = (patch: number): SdkRelease => ({ version: `0.3.${patch}`, claudeCode: `2.1.${patch}` });

registerDemo('agentSdk', () => {
  const mode = process.env.SWARM_DEMO_AGENT_SDK;
  const own = patchOf(realAgentSdk.installed()?.claudeCode);
  const installed = release(process.env.SWARM_DEMO_CLAUDE_VERSION ? patchOf(process.env.SWARM_DEMO_CLAUDE_VERSION) : own);
  let checks = 0;
  const agentSdk: AgentSdkHost = {
    installed: () => installed,
    latest: async () => {
      if (mode === 'fail') throw new Error('the npm registry answered 503');
      // A newer release comes out once the demo has checked once (or at once when the demo's Claude is old or stale).
      return release(checks++ === 0 && mode !== 'stale' ? own : own + 4);
    },
    ...(mode === 'stale' && { demoStale: Date.now() - 10 * 86_400_000 }),
  };
  return { agentSdk };
});
