// Mission control's "What uses the server" card (#271): the chat's `server:*` sources drawn as the chat draws them
// (tiles, memory by program and by agent, the last 24 hours, memory by preview, each bar opening who uses it), and the
// processes ended sessions left behind, each with "Stop it" (by pid, after a confirmation).
import { lazy, Suspense, useMemo } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { ChatVisual } from '../../../shared/chatVisuals';
import { formatValue } from '../../../shared/chatVisuals';
import type { OrphanUse } from '../../../shared/serverLoad';
import { confirmDialog } from './Confirm';
import { Section } from './DetailsPage';
import { Icon } from './Icon';
import { Menu } from './Menu';
import './serverCard.css';

const ChatVisuals = lazy(() => import('./ChatVisuals'));

const chart = (title: string, source: string): ChatVisual => ({ kind: 'chart', type: 'bar', title, unit: 'mb', labels: [], series: [], source });

async function stopOrphan(o: OrphanUse) {
  if (document.pointerLockElement) document.exitPointerLock();
  const ok = await confirmDialog({
    icon: 'square',
    tone: 'danger',
    title: `Stop ${o.name}?`,
    body: <p>It was left running in {o.agent ? `${o.agent}'s` : 'an'} worktree after their session ended. It stops with what it started (process {o.pid}), nothing else.</p>,
    confirm: 'Stop it',
  });
  if (!ok) return;
  try {
    await api.stopOrphan(o.pid);
  } catch {
    // api() already toasted it
  }
}

export function ServerCard() {
  const server = useStore((s) => s.serverLoad);
  const previews = server?.programs.some((p) => p.kind === 'preview') ?? false;
  const visuals = useMemo<ChatVisual[]>(
    () => [{ kind: 'dashboard', title: 'Server now', tiles: [], charts: [], source: 'server:now' }, ...(previews ? [chart('Memory by preview', 'server:previews')] : [])],
    [previews],
  );
  if (!server) return null;
  return (
    <Section
      id="ops-card-server"
      className="server-card"
      title={
        <>
          <Icon name="chart-column" /> What uses the server
        </>
      }
    >
      <Suspense fallback={<p className="muted small">Loading…</p>}>
        <ChatVisuals visuals={visuals} />
      </Suspense>
      {server.orphans.length > 0 && (
        <div className="server-orphans">
          <h5 className="server-orphans-h">Left running by ended sessions</h5>
          {server.orphans.map((o) => (
            <div key={o.pid} className="server-orphan">
              <Icon name="triangle-alert" />
              <span className="grow">
                <b>{o.name}</b> <span className="muted small">{o.agent ? `in ${o.agent}'s worktree · ` : ''}{formatValue(o.rssMb, 'mb')}</span>
              </span>
              <Menu label={`More for ${o.name}`} title={`${o.name} (process ${o.pid})`} items={[{ label: 'Stop it…', hint: 'Stop it and what it started, by process id', danger: true, onSelect: () => void stopOrphan(o) }]} />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
