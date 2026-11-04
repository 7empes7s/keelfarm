// An agent's status as a coloured pill, apart from TerminalView so 2D views (pocket mode) don't load the 3D camera.
const STATUS_LABEL: Record<string, string> = {
  idle: 'free',
  preparing: 'setting up',
  working: 'working',
  done: 'done',
  error: 'needs help',
  stopped: 'stopped',
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}
