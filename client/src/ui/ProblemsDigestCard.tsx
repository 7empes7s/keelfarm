// The daily problems digest in the CEO chat (#544): the office's line ("Yesterday: 3 new problems, 5 resolved; top: …;
// needs you: 1"), then its items, the manager's decisions first, each opening its PR, issue or agent like a chat chip,
// and Open Problems for the whole register.
import type { ProblemsDigest } from '../../../shared/problems';
import { go } from './goTo';
import { Icon } from './Icon';
import { problemLinks } from './problemLinks';
import { useRefOpen } from './RefChips';
import './problems.css';

export function ProblemsDigestCard({ text, digest }: { text: string; digest: ProblemsDigest }) {
  const open = useRefOpen();
  return (
    <div className="notice-card pb-digest-card" role="note">
      <p className="notice-card-title">{text}</p>
      {digest.items.length > 0 && (
        <ul className="pb-digest-items">
          {digest.items.map((i) => {
            const link = problemLinks(i)[0];
            const tap = link ? open(link.ref) : null;
            return (
              <li key={i.id}>
                <button type="button" className={`pb-digest-item${i.needsYou ? ' pb-digest-yours' : ''}`} disabled={!tap} onClick={() => tap?.()}>
                  <Icon name={i.needsYou ? 'hand' : (link?.icon ?? 'circle-alert')} />
                  <span>
                    {i.needsYou && 'Needs you: '}
                    {i.title}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="notice-card-links">
        <button type="button" className="btn" onClick={() => go({ kind: 'section', section: 'problems' })}>
          <Icon name="clipboard-list" /> Open Problems
        </button>
      </div>
    </div>
  );
}
