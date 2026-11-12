import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CEO_ID } from '../../../shared/types';
import type { Agent } from '../store';

const st = vi.hoisted(() => ({ agents: {} as Record<string, unknown>, toasts: [] as { text: string }[] }));
vi.mock('../store', () => ({ useStore: { getState: () => ({ ...st, pushToast: (_: string, text: string) => st.toasts.push({ text }) }) } }));
const { cameraOff, cameraOn, cameraWords, toggleCamera, useCamera } = await import('./agentCameraStore');

const agent = (id: string, over: Partial<Agent> = {}) => ({ id, name: id === CEO_ID ? 'Mimoun' : 'Ada', status: 'idle', task: null, ...over }) as Agent;

describe('the camera', () => {
  beforeEach(() => {
    cameraOff();
    st.agents = { [CEO_ID]: agent(CEO_ID), a1: agent('a1'), busy: agent('busy', { status: 'working', task: 'fix' }) };
    st.toasts = [];
  });

  it('the camera button turns it on with a greeting, and off again', () => {
    toggleCamera(CEO_ID);
    expect(useCamera.getState().agent).toBe(CEO_ID);
    expect(useCamera.getState().saying).toMatch(/Mimoun/);
    toggleCamera(CEO_ID);
    expect(useCamera.getState().agent).toBeNull();
  });

  it('typed or said words are handled here and never sent on', () => {
    expect(cameraWords('turn on your camera', 'a1')).toBe(true);
    expect(useCamera.getState().agent).toBe('a1');
    expect(cameraWords('turn off your camera', CEO_ID)).toBe(true); // someone else's: nothing changes
    expect(useCamera.getState().agent).toBe('a1');
    expect(cameraWords('turn off your camera', 'a1')).toBe(true);
    expect(useCamera.getState().agent).toBeNull();
    expect(cameraWords('how is the build going?', 'a1')).toBe(false);
  });

  it('a busy agent refuses playfully in a toast, then turns it on when asked again', () => {
    cameraOn('busy', 1000);
    expect(useCamera.getState().agent).toBeNull();
    expect(st.toasts.at(-1)?.text).toMatch(/^Ada: /);
    cameraOn('busy', 2000);
    expect(useCamera.getState().agent).toBe('busy');
  });
});
