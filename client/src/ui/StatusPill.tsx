// An agent's status as a coloured pill, apart from TerminalView so 2D views (pocket mode) don't load the 3D camera.
const STATUS_LABEL: Record<string, string> = {
  idle: 'free',
  preparing: 'setting up',
  working: 'working',
  done: 'done',
  error: 'needs help',
  stopped: 'stopped',
  'waiting-ceo': 'waiting for CEO',
  'waiting-you': 'waiting for you',
};

/** The pill's status: an agent waiting on an answer to their question (#36) shows who they wait for, not "done". */
export const badgeStatus = (a: { status: string; waiting?: 'ceo' | 'manager' | null }) => (a.waiting && a.status !== 'working' ? (a.waiting === 'ceo' ? 'waiting-ceo' : 'waiting-you') : a.status);

export function StatusPill({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}
