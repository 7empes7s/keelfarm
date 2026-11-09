import { describe, expect, it } from 'vitest';
import { messageActions, type MessageAction } from './chatMessageActions';

const noop = () => undefined;
const opts = (removal: MessageAction, latest = false) => ({ latest, versions: null, edit: noop, showVersions: noop, retry: noop, remember: noop, removal });
const labels = (xs: MessageAction[]) => xs.map((x) => x.label);

describe("a chat message's actions", () => {
  it('ends with Hide on the CEO messages and Delete on the manager ones (#145)', () => {
    expect(labels(messageActions({ from: 'ceo' }, opts({ label: 'Hide', run: noop }, true)))).toEqual(['Retry', 'Remember this', 'Hide']);
    expect(labels(messageActions({ from: 'manager' }, opts({ label: 'Delete', run: noop })))).toEqual(['Edit', 'Remember this', 'Delete']);
  });

  it('offers only Delete on office notices', () => {
    expect(labels(messageActions({ from: 'office' }, opts({ label: 'Delete', run: noop })))).toEqual(['Delete']);
  });

  it('offers Edit and resend on the latest manager message, and Versions when edited', () => {
    expect(labels(messageActions({ from: 'manager' }, { ...opts({ label: 'Delete', run: noop }, true), versions: 2 }))).toEqual(['Edit and resend', 'Versions (2)', 'Remember this', 'Delete']);
  });

  it('offers Read the whole message on the CEO messages while a voice is on (#282)', () => {
    expect(labels(messageActions({ from: 'ceo' }, { ...opts({ label: 'Hide', run: noop }), readWhole: noop }))).toEqual(['Read the whole message', 'Remember this', 'Hide']);
    expect(labels(messageActions({ from: 'manager' }, { ...opts({ label: 'Delete', run: noop }), readWhole: noop }))).toEqual(['Edit', 'Remember this', 'Delete']);
  });
});
