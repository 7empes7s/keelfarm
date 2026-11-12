import { describe, expect, it } from 'vitest';
import { labQueueLine, type LabJobView, type TestLabView } from './testLab.ts';

// The lab's queue on IT → Health (#560): from the snapshot's lab view, no polling.

const job = (id: string, queuedAt: number, startedAt: number | null = null): LabJobView => ({ id, kind: 'run', repoId: 'r', floor: 1, agentId: id, agent: id, pr: null, title: 'npm test', queuedAt, startedAt });
const view = (x: Partial<TestLabView>): TestLabView => ({ enabled: true, browser: 'off', running: [], queue: [], recent: [], usage: [], held: null, ...x });

describe('labQueueLine', () => {
  it('says the lab is idle, or what runs and waits and for how long', () => {
    expect(labQueueLine(view({}), 0)).toEqual({ level: 'good', line: 'Idle' });
    expect(labQueueLine(view({ running: [job('a', 0, 0)], queue: [job('b', 60_000), job('c', 100_000)] }), 180_000)).toEqual({ level: 'good', line: '1 running, 2 waiting · longest wait 2 min' });
  });

  it('needs a look once a job has waited over 5 minutes, and says why it waits', () => {
    expect(labQueueLine(view({ queue: [job('b', 0)], held: 'Waiting for memory: 1.0 GB available' }), 6 * 60_000)).toEqual({ level: 'warn', line: '0 running, 1 waiting · longest wait 6 min · Waiting for memory: 1.0 GB available' });
  });

  it('shows nothing without the lab', () => {
    expect(labQueueLine(null, 0)).toBeNull();
    expect(labQueueLine(view({ enabled: false }), 0)).toBeNull();
  });
});
