import { describe, expect, it } from 'vitest';
import { appCallRefusal, officeApiUrl } from './appCall.ts';

// #663: IT reads the live office's own API on localhost (GET and HEAD only), besides the Access-protected apps.
describe("app_call to the office's own API", () => {
  it('allows GET and HEAD to /api/ on the office port', () => {
    expect(appCallRefusal('http://localhost:4317/api/voice/traces', 'GET', 4317)).toBeNull();
    expect(appCallRefusal('http://127.0.0.1:4317/api/health', 'HEAD', 4317)).toBeNull();
    expect(officeApiUrl('http://localhost:4317/api/voice/traces', 4317)).toBe(true);
    expect(officeApiUrl('https://clip.techinsiderbytes.com/api/settings', 4317)).toBe(false);
  });

  it('refuses writes, other ports and paths outside /api/', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(appCallRefusal('http://localhost:4317/api/voice/traces', m, 4317)).toMatch(/only reads the office's API/);
    expect(appCallRefusal('http://localhost:5317/api/x', 'GET', 4317)).toMatch(/https only/);
    expect(appCallRefusal('http://localhost:4317/admin', 'GET', 4317)).toMatch(/https only/);
    expect(appCallRefusal('http://evil.test:4317/api/x', 'GET', 4317)).toMatch(/https only/);
  });

  it('still refuses everything else as before', () => {
    expect(appCallRefusal('https://example.com/x', 'GET', 4317)).toMatch(/isn't on app_call's list/);
    expect(appCallRefusal('https://keel.techinsiderbytes.com/api/x', 'POST', 4317)).toMatch(/POST isn't allowed/);
  });
});
