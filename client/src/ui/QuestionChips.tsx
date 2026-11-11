// An agent's question the CEO brought to the manager (#36): its options as one-tap answers under the chat message, or
// a reply in their own words. Gone while the answer is on its way; once it reached the agent, when it did (#508).
import { useStore } from '../store';
import type { PhoneMessage } from '../../../shared/types';
import { Icon } from './Icon';

export function QuestionChips({ m, sent, onPick, onWrite }: { m: PhoneMessage; sent: boolean; onPick: (s: string) => void; onWrite: () => void }) {
  const q = useStore((s) => s.ceo.questions?.find((x) => x.id === m.question && x.to === 'manager'));
  if (!q && m.answered) {
    return (
      <div className="suggestions small muted" role="status">
        <Icon name="check" /> Answer delivered {new Date(m.answered).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </div>
    );
  }
  if (!q || sent) return null;
  return (
    <div className="suggestions" role="group" aria-label={`Answers to ${q.agentName}'s question`}>
      {q.options.map((s) => (
        <button key={s} type="button" className="suggestion-chip" onClick={() => onPick(s)} aria-label={`Answer “${s}” to ${q.agentName}`}>
          <Icon name="reply" /> {s}
        </button>
      ))}
      <button type="button" className="suggestion-chip" onClick={onWrite} aria-label={`Write ${q.agentName} an answer`}>
        <Icon name="pencil" /> Write an answer
      </button>
    </div>
  );
}
