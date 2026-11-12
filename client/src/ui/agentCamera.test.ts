import { describe, expect, it } from 'vitest';
import { camDue, camFps, cameraCommand, demoCamera, camPose, CAM_FPS, MOUTH_GATE, mouthOpen, shyLine, shyReason, SHY_GRACE_MS, speechLevel, WAVE_MS, type CamWho } from './agentCamera';

describe('cameraCommand', () => {
  it.each(['Turn on your camera', 'turn your camera on please!', 'Can you switch on your cam?', 'camera on', 'Show yourself', 'show me your face 😄', 'let me see you', 'enable your video', "Turn on your camera — let's see"])('turns it on for "%s"', (t) => {
    expect(cameraCommand(t)).toBe('on');
  });
  it.each(['Turn off your camera', 'turn your camera off', 'camera off', 'hide yourself', 'stop your video', 'switch off the cam'])('turns it off for "%s"', (t) => {
    expect(cameraCommand(t)).toBe('off');
  });
  it('leaves ordinary messages alone, even ones that mention a camera', () => {
    expect(cameraCommand('')).toBeNull();
    expect(cameraCommand('Fix the bug where the camera jitters on the elevator')).toBeNull();
    expect(cameraCommand('What did the camera module change in the last PR, and should we turn on your camera tests in CI?')).toBeNull();
    expect(cameraCommand('ship it')).toBeNull();
  });
});

describe('mouthOpen', () => {
  it('keeps the mouth shut for silence and room noise', () => {
    expect(mouthOpen(0)).toBe(0);
    expect(mouthOpen(MOUTH_GATE)).toBe(0);
    expect(mouthOpen(Number.NaN)).toBe(0);
  });
  it('opens more as the voice gets louder, up to wide open', () => {
    expect(mouthOpen(0.1)).toBeGreaterThan(0);
    expect(mouthOpen(0.3)).toBeGreaterThan(mouthOpen(0.1));
    expect(mouthOpen(0.5)).toBe(1);
    expect(mouthOpen(2)).toBe(1);
  });
  it('a speech-like level moves the mouth over time', () => {
    const opens = Array.from({ length: 40 }, (_, i) => mouthOpen(speechLevel(i * 0.03)));
    expect(Math.max(...opens)).toBeGreaterThan(0.5);
    expect(Math.min(...opens)).toBe(0);
  });
});

describe('camPose', () => {
  it('waves as the camera comes on, then talks, thinks or idles', () => {
    expect(camPose(0, 0, false)).toBe('wave');
    expect(camPose(WAVE_MS + 1, 0.3, true)).toBe('talk');
    expect(camPose(WAVE_MS + 1, 0, true)).toBe('think');
    expect(camPose(WAVE_MS + 1, 0, false)).toBe('idle');
  });
});

describe('camera shy', () => {
  const who = (over: Partial<CamWho> = {}): CamWho => ({ id: 'a1', name: 'Ada', status: 'working', task: 'issue', ...over });
  it('is shy only while busy with a merge conflict, a fix or a test', () => {
    expect(shyReason(who())).toBeNull();
    expect(shyReason(who({ status: 'idle', task: 'fix' }))).toBeNull();
    expect(shyReason(who({ nudge: 'Told to merge main: server/swarm/core.ts' }))).toBe('conflict');
    expect(shyReason(who({ task: 'fix' }))).toBe('fix');
    expect(shyReason(who({ task: 'qa' }))).toBe('qa');
  });
  it('refuses from a template, then gives in to a second ask', () => {
    const a = who({ nudge: 'merge conflict in core.ts' });
    const line = shyLine(a, undefined, 1000);
    expect(line).toMatch(/merge conflict/i);
    expect(shyLine(a, undefined, 5000)).toBe(line); // steady per agent
    expect(shyLine(a, 1000, 1000 + SHY_GRACE_MS - 1)).toBeNull();
    expect(shyLine(a, 1000, 1000 + SHY_GRACE_MS + 1)).toBe(line);
    expect(shyLine(who(), undefined, 0)).toBeNull();
  });
});

describe('camDue', () => {
  const shown = { hidden: false, onScreen: true };
  it('draws at CAM_FPS while the tile shows', () => {
    expect(camDue(1000, -Infinity, shown)).toBe(true);
    expect(camDue(1000 + 1000 / CAM_FPS, 1000, shown)).toBe(true);
    expect(camDue(1010, 1000, shown)).toBe(false);
  });
  it('draws fewer frames when they are dear, so the office keeps its frame rate', () => {
    expect(camFps(0)).toBe(CAM_FPS);
    expect(camFps(5)).toBe(CAM_FPS);
    expect(camFps(100)).toBeCloseTo(2);
    expect(camDue(1100, 1000, shown, 100)).toBe(false); // 100 ms frames: one every 500 ms
    expect(camDue(1500, 1000, shown, 100)).toBe(true);
  });
  it('pauses while the tab is hidden or the tile is off screen', () => {
    expect(camDue(5000, 0, { ...shown, hidden: true })).toBe(false);
    expect(camDue(5000, 0, { ...shown, onScreen: false })).toBe(false);
  });
});

describe('demoCamera', () => {
  it('turns a camera on from ?camera= in the demo only', () => {
    expect(demoCamera('?camera=ceo', true)).toBe('ceo');
    expect(demoCamera('?camera=ceo', false)).toBeNull();
    expect(demoCamera('?meeting=call', true)).toBeNull();
  });
});
