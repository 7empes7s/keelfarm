import { describe, expect, it } from 'vitest';
import { clientIp, demoUploadProblem, filesOverCap, pathScrubber, publicDemoBlock, publicDemoProblem, RateLimiter, resetDue, routePath, scrubRoots } from './publicDemo.ts';

describe('publicDemoProblem', () => {
  const ok = { demo: true, loopback: true, home: '/var/lib/cubefarm-demo', defaultHome: '/root/.cubefarm' };
  it('starts only over the demo, on loopback, with a home of its own', () => {
    expect(publicDemoProblem(ok)).toBeNull();
    expect(publicDemoProblem({ ...ok, demo: false })).toMatch(/needs --demo/);
    expect(publicDemoProblem({ ...ok, loopback: false })).toMatch(/loopback/);
    expect(publicDemoProblem({ ...ok, home: undefined })).toMatch(/SWARM_HOME/);
    expect(publicDemoProblem({ ...ok, home: '/root/.cubefarm/' })).toMatch(/won't wipe/);
  });
});

describe('publicDemoBlock', () => {
  it('refuses settings that matter and lets the harmless ones through', () => {
    expect(publicDemoBlock('PATCH', '/api/settings', { weather: { mode: 'off' }, companyName: 'X' })).toBeNull();
    for (const k of ['dailyLogDir', 'projectsDir', 'defaultModel', 'defaultCli', 'runtime', 'notify', 'cloud', 'tools', 'autoUpdate', 'memory', 'somethingNew']) {
      expect(publicDemoBlock('PATCH', '/api/settings', { [k]: 'x' }), k).toMatch(/^Not in the demo/);
    }
  });
  it('refuses keys, notification setup and updates', () => {
    for (const [m, p] of [
      ['PUT', '/api/notify/webhooks/ntfy'],
      ['POST', '/api/notify/push/devices'],
      ['PUT', '/api/notify/telegram'],
      ['POST', '/api/office/update'],
      ['PUT', '/api/voice/key'],
      ['PUT', '/api/cloud/token'],
    ]) {
      expect(publicDemoBlock(m, p, {}), p).toMatch(/^Not in the demo/);
    }
    expect(publicDemoBlock('POST', '/api/notify/telegram/demo', {})).toBeNull();
    expect(publicDemoBlock('POST', '/api/ceo/message', { text: 'hi' })).toBeNull();
  });
  it('keeps the folder picker inside the pretend folders', () => {
    expect(publicDemoBlock('GET', '/api/folders', undefined)).toBeNull();
    expect(publicDemoBlock('GET', '/api/folders?dir=%2Fdemo%2Fprojects%2Fshop', undefined)).toBeNull();
    expect(publicDemoBlock('GET', '/api/folders?dir=%2Fetc', undefined)).toMatch(/folders/);
    expect(publicDemoBlock('GET', '/api/folders?dir=%2Fdemo%2Fprojects%2F..%2F..%2Fetc', undefined)).toMatch(/folders/);
  });
  it('checks paths the way Express routes them: any case, trailing slashes', () => {
    expect(publicDemoBlock('PATCH', '/api/settings/', { dailyLogDir: '/tmp' })).toMatch(/^Not in the demo/);
    expect(publicDemoBlock('PATCH', '/API/Settings', { projectsDir: '/etc' })).toMatch(/^Not in the demo/);
    for (const [m, p] of [
      ['PUT', '/API/notify/webhooks/ntfy'],
      ['PUT', '/Api/voice/key'],
      ['PUT', '/api/Cloud/key/'],
      ['POST', '/API/office/update'],
    ]) {
      expect(publicDemoBlock(m, p, {}), p).toMatch(/^Not in the demo/);
    }
    expect(publicDemoBlock('GET', '/api/folders/?dir=/etc', undefined)).toMatch(/folders/);
    expect(publicDemoBlock('GET', '/api/Folders//?dir=/etc', undefined)).toMatch(/folders/);
    expect(publicDemoBlock('POST', '/api/notify/Telegram/demo/', {})).toBeNull();
  });
});

describe('pathScrubber', () => {
  it('hides host folders as whole paths, Windows ones in JSON too', () => {
    const scrub = pathScrubber(scrubRoots(['/', '/root', '/root/.cubefarm-demo', 'C:\\Users\\me']));
    expect(scrub('cwd /root/.cubefarm-demo/machines/a/work/o__r ok')).toBe('cwd ~/demo/machines/a/work/o__r ok');
    expect(scrub('{"projectsDir":"/root/Projects"}')).toBe('{"projectsDir":"~/demo/Projects"}');
    expect(scrub(JSON.stringify({ p: 'C:\\Users\\me\\x' }))).toBe('{"p":"~/demo\\\\x"}');
    expect(scrub('https://github.com/root and /rooted')).toBe('https://github.com/root and /rooted');
    expect(scrub('/demo/projects/shop')).toBe('/demo/projects/shop');
    expect(scrub('\x1b[2m/root/.cubefarm-demo/m\x1b[0m')).toBe('\x1b[2m~/demo/m\x1b[0m');
    expect(scrub(JSON.stringify('\x1b[2m/root/x'))).toBe('"\\u001b[2m~/demo/x"');
  });
});

describe('RateLimiter', () => {
  it('allows a burst, then refills over time, per visitor', () => {
    const r = new RateLimiter(3, 1);
    expect([r.take('a', 0), r.take('a', 0), r.take('a', 0), r.take('a', 0)]).toEqual([true, true, true, false]);
    expect(r.take('b', 0)).toBe(true);
    expect(r.take('a', 999)).toBe(false);
    expect(r.take('a', 1000)).toBe(true);
  });
  it('forgets quiet visitors to stay small', () => {
    const r = new RateLimiter(1, 1, 2);
    r.take('a', 0);
    r.take('b', 0);
    r.take('c', 5000);
    expect(r.take('a', 5000)).toBe(true); // forgotten: a full bucket again
  });
});

describe('clientIp', () => {
  it("trusts Cloudflare's header only from the local tunnel", () => {
    expect(clientIp('127.0.0.1', '203.0.113.9')).toBe('203.0.113.9');
    expect(clientIp('::ffff:127.0.0.1', ['203.0.113.9'])).toBe('203.0.113.9');
    expect(clientIp('198.51.100.2', '203.0.113.9')).toBe('198.51.100.2');
    expect(clientIp('127.0.0.1', undefined)).toBe('127.0.0.1');
  });
});

describe('uploads', () => {
  it('finds the upload route in any spelling', () => {
    for (const p of ['/files', '/Files', '/FILES/', '/files//']) expect(routePath(p), p).toBe('/files');
    expect(routePath('/')).toBe('/');
  });
  it('takes images, PDFs and text, not scripts or archives', () => {
    expect(demoUploadProblem('a.png', 'image/png')).toBeNull();
    expect(demoUploadProblem('a.pdf', '')).toBeNull();
    expect(demoUploadProblem('a.md', '')).toBeNull();
    for (const n of ['a.svg', 'a.html', 'a.zip', 'a.exe', 'a.mp4']) expect(demoUploadProblem(n, ''), n).toMatch(/images, PDFs/);
  });
  it('drops the oldest files past the total', () => {
    const files = [
      { id: 'new', size: 30 },
      { id: 'mid', size: 30 },
      { id: 'old', size: 30 },
    ];
    expect(filesOverCap(files, 100)).toEqual([]);
    expect(filesOverCap(files, 60)).toEqual(['old']);
    expect(filesOverCap(files, 20)).toEqual(['old', 'mid', 'new']);
  });
});

describe('resetDue', () => {
  const base = { now: 0, startedAt: 0, visitors: 1, goneAt: null, everyMs: 6 * 3600_000, idleMs: 30 * 60_000 };
  it('resets on the schedule and after the last visitor has been gone a while', () => {
    expect(resetDue(base)).toBeNull();
    expect(resetDue({ ...base, now: 6 * 3600_000 })).toBe('schedule');
    expect(resetDue({ ...base, now: 3600_000, visitors: 0, goneAt: 3600_000 - 29 * 60_000 })).toBeNull();
    expect(resetDue({ ...base, now: 3600_000, visitors: 0, goneAt: 3600_000 - 30 * 60_000 })).toBe('idle');
    expect(resetDue({ ...base, now: 3600_000, visitors: 0, goneAt: null })).toBeNull(); // nobody came: nothing to reset
  });
});
