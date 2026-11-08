// QA and previews: each PR's QA record with its cues, and the PR theatre's previews.
import type { PrPreviewView, QaView } from '../../../../shared/types';
import { qaKey } from '../../store';
import { cue } from '../../ui/sfx';
import { rememberQa } from '../../world/confetti';
import type { ApplyHandlers, SnapshotPart } from './types';

export const handlers = {
  qa: (ev, { set, get, cues }) => {
    const prev = get().qa[qaKey(ev.qa.repoId, ev.qa.prNumber)]?.status;
    const failed = (st?: QaView['status']) => st === 'failed' || st === 'needs-human';
    if (cues && ev.qa.status === 'passed' && prev !== 'passed') cue('ready');
    if (cues && failed(ev.qa.status) && !failed(prev)) cue('qaFailed');
    set({ qa: { ...get().qa, [qaKey(ev.qa.repoId, ev.qa.prNumber)]: ev.qa } });
  },
  qaRemoved: (ev, { set, get }) => {
    const { [qaKey(ev.repoId, ev.prNumber)]: gone, ...qa } = get().qa;
    if (gone) rememberQa(qaKey(ev.repoId, ev.prNumber), gone);
    set({ qa });
  },
  prPreview: (ev, { set, get }) => set({ prPreviews: { ...get().prPreviews, [qaKey(ev.preview.repoId, ev.preview.pr)]: ev.preview } }),
  previewStats: (ev, { set }) => set({ previewStats: ev.stats }),
  prPreviewRemoved: (ev, { set, get }) => {
    const { [qaKey(ev.repoId, ev.pr)]: _gone, ...prPreviews } = get().prPreviews;
    set({ prPreviews });
  },
} satisfies ApplyHandlers;

export const snapshot: SnapshotPart = (d) => {
  const qa: Record<string, QaView> = {};
  for (const q of d.qa) qa[qaKey(q.repoId, q.prNumber)] = q;
  const prPreviews: Record<string, PrPreviewView> = {};
  for (const p of d.prPreviews ?? []) prPreviews[qaKey(p.repoId, p.pr)] = p;
  return { qa, prPreviews, previewStats: d.previewStats ?? { diskBytes: null, memMb: null, cleanedAt: null } };
};
