// The console and CardView use the same rules. Manual assignment can override dependencies;
// automatic scheduling cannot. A stopped desk can be assigned again, and only a live session has Stop.
export function issueActions(x: { open: boolean; pr: boolean; untrusted?: boolean; agentStatus?: string; waits: readonly number[] }) {
  if (!x.open || x.pr) return { primary: null, assign: false, close: false, stop: false, confirmAssignment: false } as const;
  const running = x.agentStatus === 'working' || x.agentStatus === 'preparing';
  return {
    primary: x.agentStatus ? 'agent' : x.untrusted ? null : 'assign',
    assign: !running && !x.untrusted,
    close: true,
    stop: running,
    confirmAssignment: x.waits.length > 0,
  } as const;
}
