import { useStore } from '../store';
import './threads.css';
import { Icon } from './Icon';
import { UNTITLED, type Conversation } from '../../../shared/conversations';

// Above the chat (#132): the thread's project, a floor (its charter's focus and open issues, a tap opens its board) or
// the Company (the floors it named), and the Chat | Files segment, Files with the 📎 count.

export type ChatSegment = 'chat' | 'files';

interface Props {
  thread: Conversation | undefined;
  seg: ChatSegment;
  onSeg: (s: ChatSegment) => void;
  files: number;
  onFloor: (floor: number) => void;
}

export function ThreadBar({ thread, seg, onSeg, files, onFloor }: Props) {
  const repos = useStore((s) => s.repos);
  const repo = thread?.repoId ? repos.find((r) => r.id === thread.repoId) : undefined;
  const named = (thread?.floors ?? []).flatMap((id) => repos.find((r) => r.id === id) ?? []);
  return (
    <div className="thread-bar">
      {repo ? (
        <button type="button" className="thread-project" onClick={() => onFloor(repo.floor)} title={`Open floor ${repo.floor}'s board`}>
          <b className="thread-project-name">
            <Icon name="building-2" /> Floor {repo.floor} · {repo.fullName.split('/').pop()}
          </b>
          <span className="small muted thread-project-meta">
            {repo.charter.focus ? `Focus: ${repo.charter.focus} · ` : ''}
            {repo.issues.length} open issue{repo.issues.length === 1 ? '' : 's'}
          </span>
        </button>
      ) : (
        <div className="thread-project">
          <b className="thread-project-name">
            <Icon name="message-circle" /> {thread?.title && thread.title !== UNTITLED ? thread.title : 'Company thread'}</b>
          <span className="small muted thread-project-meta">{named.length ? `Company · ${named.map((r) => `floor ${r.floor}`).join(', ')}` : 'Company: across every floor'}</span>
        </div>
      )}
      <div className="seg thread-seg" role="tablist" aria-label="Chat or files">
        {(['chat', 'files'] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={seg === s} className={`seg-btn ${seg === s ? 'seg-on' : ''}`} onClick={() => onSeg(s)}>
            {s === 'chat' ? 'Chat' : `Files${files ? ` ${files}` : ''}`}
          </button>
        ))}
      </div>
    </div>
  );
}
