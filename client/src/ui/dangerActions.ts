// The agent actions that are hard to undo, each behind the office's confirmation (docs/design.md: they sit in a ⋯
// menu's danger section, never one tap away). Shared by the console, the terminal, pocket mode and mission control.
import { api } from '../api';
import { confirmDialog } from './Confirm';

/** Asks, then lets the agent go. True once they're gone (errors were toasted by api()). */
export async function letGo(agent: { id: string; name: string }): Promise<boolean> {
  const ok = await confirmDialog({
    tone: 'danger',
    icon: '👋',
    title: `Let ${agent.name} go?`,
    body: 'Their worktree is removed. Branches they pushed stay on GitHub.',
    confirm: `Let ${agent.name} go`,
  });
  if (!ok) return false;
  return api.fireAgent(agent.id).then(
    () => true,
    () => false,
  );
}

/** Asks, then clears the agent's desk: their task is dropped and they're free for new work. */
export async function clearDesk(agent: { id: string; name: string }): Promise<boolean> {
  const ok = await confirmDialog({
    tone: 'danger',
    icon: '↺',
    title: `Clear ${agent.name}'s desk?`,
    body: 'They drop the task they had and take new work. A PR they were testing goes back in the QA queue; one they were fixing is marked failed. Their branch stays on GitHub.',
    confirm: 'Clear desk',
  });
  if (!ok) return false;
  return api.reset(agent.id).then(
    () => true,
    () => false,
  );
}

/** Asks, then stops the agent's session (#117: Stop always asks, wherever it is). */
export async function stopAgent(agent: { id: string; name: string }): Promise<boolean> {
  const ok = await confirmDialog({ tone: 'danger', icon: '■', title: `Stop ${agent.name}?`, body: 'Their session ends now. A message picks it back up.', confirm: 'Stop' });
  if (!ok) return false;
  return api.stop(agent.id).then(
    () => true,
    () => false,
  );
}
