import { describe, expect, it } from 'vitest';
import { issueActions } from './issueActionRules';

const ready = { open: true, pr: false, waits: [] };
describe('issue actions shared by the console and pocket CardView', () => {
  it('makes assignment primary for backlog, ready and manually held issues', () => {
    expect(issueActions(ready)).toMatchObject({ primary: 'assign', assign: true, close: true, stop: false, confirmAssignment: false });
  });
  it('allows the console dependency override only after asking', () => {
    expect(issueActions({ ...ready, waits: [12] })).toMatchObject({ primary: 'assign', assign: true, close: true, confirmAssignment: true });
  });
  it.each(['working', 'preparing'])('opens the agent and offers confirmed Stop while %s', (agentStatus) => {
    expect(issueActions({ ...ready, agentStatus })).toMatchObject({ primary: 'agent', assign: false, close: true, stop: true });
  });
  it.each(['stopped', 'error', 'done'])('keeps the agent accessible and allows reassignment when %s', (agentStatus) => {
    expect(issueActions({ ...ready, agentStatus })).toMatchObject({ primary: 'agent', assign: true, close: true, stop: false });
  });
  it('cannot assign an untrusted issue', () => {
    expect(issueActions({ ...ready, untrusted: true })).toMatchObject({ primary: null, assign: false, close: true, stop: false });
  });
  it.each([{ open: false }, { pr: true }])('has no issue mutations for closed issues or PR cards (%j)', (state) => {
    expect(issueActions({ ...ready, ...state })).toMatchObject({ primary: null, close: false, stop: false });
  });
});
