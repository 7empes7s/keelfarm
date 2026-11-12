// The daily Agent SDK check's two reads (#569): the version installed with the office and the npm registry's latest.
// Read only: nothing here installs anything; a bump goes through an issue, a PR and the office's self-update.
import { packageField } from './clis.ts';
import { releaseOf, SDK_PACKAGE, type SdkRelease } from '../shared/agentSdk.ts';

export interface AgentSdkHost {
  /** The Agent SDK the office runs (and the Claude Code it bundles), or null when it isn't installed. */
  installed(): SdkRelease | null;
  /** The registry's latest release; throws with a plain reason when it can't be read. */
  latest(): Promise<SdkRelease>;
  /** The demo only (SWARM_DEMO_AGENT_SDK=stale): behind since then and unable to file a bump, so the alarm card shows. */
  demoStale?: number;
}

export const realAgentSdk: AgentSdkHost = {
  installed() {
    const version = packageField(SDK_PACKAGE, 'version');
    return version ? { version, claudeCode: packageField(SDK_PACKAGE, 'claudeCodeVersion') } : null;
  },
  async latest() {
    const res = await fetch(`https://registry.npmjs.org/${SDK_PACKAGE}/latest`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`the npm registry answered ${res.status}`);
    return releaseOf(await res.json());
  },
};
