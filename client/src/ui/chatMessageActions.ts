// A chat message's ⋯ menu entries (pure), so merges can't silently drop one: Edit, Versions, Read the whole message (#282), Retry, Remember this,
// then Delete or Hide (#145).
import type { PhoneMessage } from '../../../shared/types';
import type { IconName } from './icons';

export type MessageAction = { label: string; icon?: IconName; run: () => void };

/** The entries for `m`. `latest`: it's the newest from its sender; `removal`: its Delete/Hide entry. */
export function messageActions(
  m: Pick<PhoneMessage, 'from'>,
  o: { latest: boolean; versions: number | null; edit: () => void; showVersions: () => void; retry: () => void; remember: () => void; removal: MessageAction; readWhole?: () => void },
): MessageAction[] {
  if (m.from === 'office') return [o.removal];
  return [
    ...(m.from === 'manager' ? [{ label: o.latest ? 'Edit and resend' : 'Edit', icon: 'pencil' as const, run: o.edit }] : []),
    ...(o.versions !== null ? [{ label: `Versions (${o.versions})`, icon: 'clock' as const, run: o.showVersions }] : []),
    ...(m.from === 'ceo' && o.readWhole ? [{ label: 'Read the whole message', icon: 'volume-2' as const, run: o.readWhole }] : []),
    ...(m.from === 'ceo' && o.latest ? [{ label: 'Retry', icon: 'refresh-cw' as const, run: o.retry }] : []),
    { label: 'Remember this', icon: 'pin' as const, run: o.remember },
    o.removal,
  ];
}
