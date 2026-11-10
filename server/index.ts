import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo, Socket } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import { CLIP_MAX_BYTES, CLIP_TOO_BIG } from '../shared/clipLimits.ts';
import { DAY_PARTS } from '../shared/speech.ts';
import { BEAT_MS } from '../shared/heartbeat.ts';
import type { ServerEvent } from '../shared/types.ts';
import { liveLaneRefusal } from './portLanes.ts';
import { DEFAULT_PROJECTS_DIR, DEMO, DEMO_NO_TOUR, DEMO_SCALE, HOME_DIR, HOST, PORT, PREVIEW_PORT, PUBLIC_DEMO, PUBLIC_DEMO_RESET_H, STATE_FILE, VERSION, WORKSPACE_ROOT, isLoopback, localAddress, networkUrls } from './config.ts';
import { MACHINES_DIR } from './workspace.ts';
import { realBackend } from './backend.ts';
import { handleHook, handleMcp, setOfficeUrl } from './cliRunner.ts';
import { createDemoBackend } from './demo.ts';
import { seedDemoNotes } from './demoChat.ts';
import { fileRoutes } from './fileRoutes.ts';
import { parseRange } from './journal.ts';
import { underLauncher } from './officeUpdate.ts';
import { serviceWorkerSource, swVersion } from './pwa.ts';
import { screenStatus } from './screenReply.ts';
import { parseSendBackNote } from './sendBack.ts';
import { handleGateway, upgradeGateway } from './previewGateway.ts';
import { PresenceHub } from './presence.ts';
import { PUBLIC_DEMO_FILE_BYTES, RateLimiter, clientIp, demoUploadProblem, filesOverCap, pathScrubber, publicDemoBlock, publicDemoProblem, resetDue, routePath, scrubRoots } from './publicDemo.ts';
import { HttpError, Swarm } from './swarm.ts';
import { historyFilter } from './history.ts';
import { libraryQuery } from '../shared/library.ts';

if (PUBLIC_DEMO) {
  const why = publicDemoProblem({ demo: DEMO, loopback: isLoopback(HOST), home: process.env.SWARM_HOME, defaultHome: path.join(os.homedir(), '.cubefarm') });
  if (why) {
    console.error(`\n  ✖ ${why}\n`);
    process.exit(1);
  }
}

const swarm = new Swarm(DEMO ? createDemoBackend(DEMO_SCALE, DEMO_NO_TOUR) : realBackend);
if (DEMO) seedDemoNotes(); // the demo CEO's NOTES.md, for "What the CEO remembers"
// Who else is in the 3D office (shared presence): relayed between tabs over /ws, never saved. The demo adds fake visitors.
const presence = new PresenceHub({ demo: DEMO });
// Sessions the office picks back up while it starts need the address their CLIs call back on before it listens.
if (PORT) setOfficeUrl(`http://${localAddress(HOST)}:${PORT}`);
await swarm.init();

const app = express();
// The public demo (#95, server/publicDemo.ts): a rate limit per visitor, capped uploads and no host path in any answer.
const scrub = PUBLIC_DEMO ? pathScrubber(scrubRoots([HOME_DIR, path.resolve(import.meta.dirname, '..'), DEFAULT_PROJECTS_DIR, process.cwd(), os.homedir(), os.tmpdir()])) : null;
const ipOf = (req: http.IncomingMessage) => clientIp(req.socket.remoteAddress, req.headers['cf-connecting-ip']);
const apiLimit = new RateLimiter(240, 8);
const wsLimit = new RateLimiter(30, 0.5);
if (scrub) {
  app.use('/api', (req, res, next) => {
    if (!apiLimit.take(ipOf(req))) return void res.status(429).json({ error: 'Slow down a little: too many clicks at once for the demo. Try again in a few seconds.' });
    res.json = (body: unknown) => res.type('json').send(scrub(JSON.stringify(body) ?? ''));
    if (req.method === 'POST' && routePath(req.path) === '/files') {
      let name = '';
      try {
        name = decodeURIComponent(String(req.headers['x-file-name'] ?? ''));
      } catch {
        // a malformed name: judged by its type alone
      }
      const why = demoUploadProblem(name, String(req.headers['content-type'] ?? ''));
      if (why) return void res.set('Connection', 'close').status(415).json({ error: why });
      // Past the demo's total, the oldest files go.
      res.on('finish', () => void Promise.all(filesOverCap(swarm.files.list()).map((id) => swarm.files.remove(id))).catch((err) => console.error(err)));
    }
    next();
  });
}
// Previews through the office's own address, for browsers on other devices (server/previewGateway.ts). First: their
// request bodies pass on untouched.
const proxied = (port: number) => swarm.previewProxied(port);
const previewUse = swarm.previewUse;
app.use((req, res, next) => void (handleGateway(req, res, proxied, previewUse) || next()));
// Agent CLIs calling back: hooks (a tool result can be a large screenshot, hence the limit) and the CEO's office tools.
// The token in the path is the session's; unknown tokens get an empty answer.
app.post('/api/hooks/:token', express.json({ limit: '64mb' }), (req, res) => void res.json(handleHook(String(req.params.token), req.body)));
app.post('/api/mcp/:token', express.json({ limit: '4mb' }), (req, res, next) => void handleMcp(String(req.params.token), req, res).catch(next));
app.all('/api/mcp/:token', (_req, res) => void res.status(405).set('Allow', 'POST').end());
// The chat's files (server/fileRoutes.ts): uploads stream to disk, so before the JSON body parser.
app.use(fileRoutes(swarm.files, { max: PUBLIC_DEMO ? PUBLIC_DEMO_FILE_BYTES : undefined }));
app.use(express.json({ limit: '1mb' }));
if (PUBLIC_DEMO) {
  app.use((req, _res, next) => {
    const why = publicDemoBlock(req.method, req.originalUrl, req.body);
    next(why ? new HttpError(403, why) : undefined);
  });
}

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const route = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (err) {
    next(err);
  }
};
const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid number: ${v}`);
  return n;
};
const str = (v: unknown) => (typeof v === 'string' ? v : '');
// Repo ids contain a slash ("owner/name"), so they travel URL-encoded as a single segment.
const repoId = (req: Request) => decodeURIComponent(String(req.params.repo));

app.get('/api/state', route(() => swarm.snapshot()));

app.get('/api/github/repos', route((req) => swarm.listGithubRepos(str(req.query.owner) || undefined)));

// What happens once a project moves in: the CEO's brief, and whether work starts on its own.
const floorOptions = (req: Request) => ({ mission: str(req.body.mission), autoAssign: req.body.autoAssign === true });

app.post('/api/repos', route((req) => swarm.connectRepo(str(req.body.fullName).trim(), floorOptions(req))));

// Your projects folder
app.get('/api/folders', route((req) => swarm.listProjectFolders(str(req.query.dir) || undefined)));
app.post('/api/folders/connect', route((req) => swarm.connectFolder(str(req.body.path), floorOptions(req))));
app.post(
  '/api/folders/publish',
  route((req) =>
    swarm.publishFolder(str(req.body.path), {
      ...floorOptions(req),
      name: str(req.body.name) || undefined,
      visibility: req.body.visibility === 'public' ? 'public' : 'private',
      description: str(req.body.description),
    }),
  ),
);
app.post(
  '/api/setup',
  route((req) =>
    swarm.setup({
      managerName: str(req.body.managerName),
      companyName: str(req.body.companyName),
      scaling: str(req.body.scaling),
      ceoName: str(req.body.ceoName),
      ceoLook: str(req.body.ceoLook),
      ceoColor: str(req.body.ceoColor),
    }),
  ),
);
app.post(
  '/api/repos/new',
  route((req) =>
    swarm.createRepo(str(req.body.name).trim(), {
      ...floorOptions(req),
      description: str(req.body.description),
      visibility: req.body.visibility === 'public' ? 'public' : 'private',
      owner: str(req.body.owner).trim() || undefined,
    }),
  ),
);
app.patch('/api/repos/:repo', route((req) => swarm.updateRepo(repoId(req), req.body ?? {})));
app.delete('/api/repos/:repo', route((req) => swarm.disconnectRepo(repoId(req))));
app.post('/api/repos/:repo/sync', route((req) => swarm.syncRepo(repoId(req))));
app.post('/api/repos/:repo/sync-folder', route((req) => swarm.syncFolderNow(repoId(req))));
app.post(
  '/api/repos/:repo/issues',
  route(async (req) => ({
    number: await swarm.createIssue(repoId(req), str(req.body.title), str(req.body.body), str(req.body.assignTo) || undefined),
  })),
);
app.post('/api/repos/:repo/issues/:n/close', route((req) => swarm.closeIssueByManager(repoId(req), num(req.params.n))));
app.post('/api/repos/:repo/issues/:n/assign', route((req) => swarm.assignIssue(repoId(req), num(req.params.n), str(req.body?.agentId))));
app.post('/api/repos/:repo/issues/:n/trust', route((req) => swarm.trustIssue(repoId(req), num(req.params.n))));
app.post('/api/repos/:repo/plan', route((req) => swarm.planFloor(repoId(req), typeof req.body?.mission === 'string' ? req.body.mission : undefined, req.body?.research === true)));
app.post('/api/repos/:repo/onboard', route((req) => swarm.onboardFloor(repoId(req))));
// The floor's charter (#48): the manager's edit, their call on the CEO's proposal, an objective's status (#105), and Export
app.put('/api/repos/:repo/charter', route((req) => swarm.setCharter(repoId(req), req.body?.charter)));
app.post('/api/repos/:repo/charter/proposal', route((req) => swarm.decideCharter(repoId(req), req.body?.approve === true, req.body?.charter ?? undefined)));
app.put('/api/repos/:repo/charter/status', route((req) => swarm.setObjectiveStatus(repoId(req), req.body?.objective, req.body?.status ?? null)));
app.post('/api/repos/:repo/charter/export', route((req) => swarm.exportCharter(repoId(req))));
// The setup advisor (#366): the floor's use case, a gap's fix by its action's index, Not now, the new floor's checklist closed.
app.put('/api/repos/:repo/setup/use-case', route((req) => swarm.setFloorUseCase(repoId(req), req.body?.useCase)));
app.post('/api/repos/:repo/setup/apply', route((req) => swarm.applyFloorSetup(repoId(req), req.body?.gap, req.body?.action ?? 0)));
app.post('/api/repos/:repo/setup/snooze', route((req) => swarm.snoozeFloorSetup(repoId(req), req.body?.gap)));
app.post('/api/repos/:repo/setup/review', route((req) => swarm.closeFloorReview(repoId(req))));
app.put('/api/company/use-cases', route((req) => swarm.setCompanyUseCases(req.body?.useCases)));
// The floor's app, for the preview monitor
app.post(
  '/api/repos/:repo/preview',
  route((req) => {
    const pr = req.body?.pr;
    if (pr !== undefined && pr !== null && (typeof pr !== 'number' || !Number.isInteger(pr) || pr <= 0)) throw new HttpError(400, 'pr must be a positive integer');
    return swarm.startPreview(repoId(req), pr ?? null, req.body?.otherPort === true);
  }),
);
app.delete('/api/repos/:repo/preview', route((req) => swarm.stopPreview(repoId(req))));
// A finished ping-pong game, for the floor's leaderboard
app.post('/api/repos/:repo/pong', route((req) => swarm.recordPong(repoId(req), req.body ?? {})));
// The PR theatre: open PRs running beside the floor's app, and what the app viewer has on screen
app.post('/api/repos/:repo/pr-previews/:n', route((req) => swarm.startPrPreview(repoId(req), num(req.params.n), req.body?.restart === true)));
app.delete('/api/repos/:repo/pr-previews/:n', route((req) => swarm.stopPrPreview(repoId(req), num(req.params.n))));
app.post(
  '/api/previews/watch',
  route((req) => {
    const viewer = str(req.body?.viewer);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(viewer)) throw new HttpError(400, 'viewer must be an id of 8-64 letters, digits or dashes');
    const repo = req.body?.repoId == null ? null : str(req.body.repoId);
    const pr = req.body?.pr == null ? null : num(req.body.pr);
    return swarm.watchPreview(viewer, repo || null, repo ? pr : null);
  }),
);
// Keep a preview running (📌 an hour, until stopped, or off), or start its max lifetime again ("Keep it running", #252)
app.post(
  '/api/repos/:repo/preview/keep',
  route((req) => {
    const pr = req.body?.pr == null ? null : num(req.body.pr);
    const pin = req.body?.pin ?? undefined;
    if (pin !== undefined && pin !== 'hour' && pin !== 'forever' && pin !== 'off') throw new HttpError(400, "pin must be 'hour', 'forever' or 'off'");
    return swarm.keepPreview(repoId(req), pr, pin);
  }),
);
app.post('/api/repos/:repo/preview/sync', route((req) => swarm.previewSyncUrl(repoId(req), req.body?.pr == null ? null : num(req.body.pr))));
app.get('/api/repos/:repo/pulls/:n/qa-shots/:i', async (req, res, next) => {
  try {
    const index = Number(req.params.i);
    const shot = Number.isInteger(index) && index >= 0 ? await swarm.qaShot(repoId(req), num(req.params.n), index) : null;
    res.setHeader('Cache-Control', 'no-store');
    if (!shot) return void res.status(404).end();
    res.setHeader('Content-Type', shot.mime);
    // Screenshots can be SVG: never let one run script as a page of the office.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.end(shot.data);
  } catch (err) {
    next(err);
  }
});
app.post('/api/repos/:repo/pulls/:n/merge', route((req) => swarm.mergePull(repoId(req), num(req.params.n), req.body?.method ?? 'squash')));
app.post('/api/repos/:repo/pulls/:n/close', route((req) => swarm.closePull(repoId(req), num(req.params.n))));
app.post('/api/repos/:repo/pulls/:n/qa', route((req) => swarm.sendToQa(repoId(req), num(req.params.n), str(req.body?.agentId) || undefined)));
app.post('/api/repos/:repo/pulls/:n/fix', route((req) => swarm.sendBackToDev(repoId(req), num(req.params.n), parseSendBackNote(req.body))));
app.post(
  '/api/repos/:repo/agents',
  route((req) =>
    swarm.hireAgent(repoId(req), {
      name: str(req.body.name),
      cli: str(req.body.cli),
      host: str(req.body.host),
      strict: true,
      model: str(req.body.model),
      effort: str(req.body.effort),
      look: str(req.body.look),
    }),
  ),
);

app.patch('/api/agents/:id', route((req) => swarm.updateAgent(String(req.params.id), req.body ?? {})));
app.delete('/api/agents/:id', route((req) => swarm.fireAgent(String(req.params.id))));
app.post('/api/agents/:id/assign', route((req) => swarm.assign(String(req.params.id), num(req.body.issueNumber), str(req.body.note) || undefined, req.body?.waitForDeps === true)));
app.post('/api/agents/:id/stop', route((req) => swarm.stopAgent(String(req.params.id))));
app.post('/api/agents/:id/reset', route((req) => swarm.resetAgent(String(req.params.id))));
app.post('/api/agents/:id/message', route((req) => swarm.message(String(req.params.id), str(req.body.text))));
app.post('/api/agents/:id/react', route((req) => swarm.react(String(req.params.id), req.body?.itemId, req.body?.reaction)));
app.post('/api/agents/:id/sign-in', route((req) => swarm.signIn(String(req.params.id))));
app.post('/api/agents/:id/sign-in-check', route((req) => swarm.recheckSignIn(String(req.params.id))));
app.get('/api/agents/:id/sign-in-link', route((req) => swarm.signInLinkOf(String(req.params.id))));
app.get('/api/costs', route((req) => swarm.costsView(req.query.days, str(req.query.repo))));
// The session history (#49): a page of entries, Settings' disk-usage line, and one entry with its transcript.
app.get('/api/history', route((req) => swarm.history.page(historyFilter(req.query))));
app.get('/api/history/usage', route(() => swarm.history.usage()));
app.get('/api/history/:id', route(async (req) => (await swarm.history.detail(String(req.params.id))) ?? Promise.reject(new HttpError(404, 'No such session in the history'))));
// The lab (#23): the manager defines experiments, starts, stops and promotes them; the results come on /ws.
app.post('/api/experiments', route((req) => swarm.lab.define(req.body, 'manager')));
app.post('/api/experiments/:id', route((req) => swarm.lab.act(String(req.params.id), req.body?.action, req.body?.variant ?? null)));
app.post('/api/experiments/:id/every-project', route((req) => swarm.adoptPractices(String(req.params.id), req.body?.variant)));
app.get('/api/agents/:id/timeline', route((req) => swarm.careerTimeline(String(req.params.id))));
app.get('/api/agents/:id/prompt', route((req) => swarm.agentPrompt(String(req.params.id))));
app.get('/api/agents/:id/screen', (req, res) => {
  const shot = swarm.screenshot(String(req.params.id), Number(req.query.at) || undefined);
  res.setHeader('Cache-Control', 'no-store');
  if (!shot) return void res.status(screenStatus(shot)).end();
  res.setHeader('Content-Type', shot.mime);
  res.end(shot.data);
});

app.patch('/api/settings', route((req) => swarm.updateSettings(req.body ?? {})));
app.post('/api/tools/refresh', route(() => swarm.refreshTooling()));
app.post('/api/models/refresh', route(() => swarm.refreshModels()));
app.post('/api/tools/switch', route((req) => swarm.setToolSwitch(str(req.body?.scope), req.body?.id, req.body?.on)));

// Phone messages read aloud (docs/voice.md). The key goes in and never comes back out.
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '));
  return r.data;
};
const sendAudio = (res: Response, audio: Buffer, cache = 'private, max-age=3600') => {
  // Real clips are mp3; the demo's chime is a WAV.
  res.setHeader('Content-Type', audio.subarray(0, 4).toString('latin1') === 'RIFF' ? 'audio/wav' : 'audio/mpeg');
  res.setHeader('Cache-Control', cache);
  res.end(audio);
};
app.put('/api/voice/key', route((req) => swarm.voice.setKey(parse(z.object({ key: z.string().max(400) }), req.body).key)));
// Settings → Cloud agents (docs/cloud.md): keys and tokens go in, never come back out.
app.put('/api/cloud/key', route((req) => swarm.setCloudKey(parse(z.object({ key: z.string().max(400) }), req.body).key)));
app.put(
  '/api/cloud/token',
  route((req) => {
    const body = parse(z.object({ kind: z.enum(['github', 'anthropic', 'openai']), value: z.string().max(400) }), req.body);
    return swarm.setCloudToken(body.kind, body.value);
  }),
);
app.post('/api/cloud/test', route(() => swarm.testCloud()));
app.post('/api/cloud/orphans', route(() => swarm.deleteCloudOrphans()));
app.post('/api/cloud/demo-expire', route(() => swarm.expireSignIns()));
app.post('/api/cloud/key-again', route((req) => swarm.useKeyAgain(parse(z.object({ kind: z.enum(['anthropic', 'openai']) }), req.body).kind)));
app.post('/api/cloud/demo-credit', route(() => swarm.simulateOutOfCredit()));
// Usage (#361): an Admin key for the organisation's cost report; it goes in and never comes back out.
app.put(
  '/api/usage/admin-key',
  route((req) => {
    const body = parse(z.object({ provider: z.enum(['anthropic', 'openai']), key: z.string().max(400) }), req.body);
    return swarm.setUsageAdminKey(body.provider, body.key);
  }),
);
// Settings → Providers (#362): keys and MCP servers' secrets come in here and never go back out.
app.post(
  '/api/providers',
  route((req) => {
    const body = parse(z.object({ provider: z.string().max(40), key: z.string().max(400), label: z.string().max(60).optional() }), req.body);
    return swarm.providers.add(body.provider, body.key, body.label);
  }),
);
app.post('/api/providers/:id/test', route((req) => swarm.providers.test(String(req.params.id))));
app.delete('/api/providers/:id', route(async (req) => ({ removed: await swarm.providers.remove(String(req.params.id)).then(() => true) })));
app.post(
  '/api/providers/mcp',
  route((req) => {
    const body = parse(
      z.object({ name: z.string().max(40), command: z.string().max(500).optional(), url: z.string().max(500).optional(), secrets: z.record(z.string().max(64), z.string().max(2000)).optional(), agents: z.array(z.string().max(80)).max(200).optional() }),
      req.body,
    );
    return swarm.addMcpServer(body);
  }),
);
app.patch('/api/providers/mcp/:id', route((req) => swarm.providers.setMcp(String(req.params.id), parse(z.object({ on: z.boolean().optional(), agents: z.array(z.string().max(80)).max(200).optional() }), req.body))));
app.post('/api/providers/mcp/:id/test', route((req) => swarm.providers.testMcp(String(req.params.id))));
app.delete('/api/providers/mcp/:id', route(async (req) => ({ removed: await swarm.providers.removeMcp(String(req.params.id)).then(() => true) })));
// Providers & accounts (#247, docs/accounts.md): keys come in here and never go back out.
app.post('/api/accounts', route((req) => swarm.accounts.add(req.body ?? {})));
app.patch('/api/accounts/:id', route((req) => swarm.accounts.update(String(req.params.id), req.body ?? {})));
app.post('/api/accounts/:id/move', route((req) => swarm.accounts.move(String(req.params.id), Number((req.body ?? {}).by))));
app.put('/api/accounts/:id/key', route(async (req) => ({ note: await swarm.accounts.setKey(String(req.params.id), (req.body ?? {}).key) })));
app.post('/api/accounts/:id/test', route(async (req) => ({ note: await swarm.accounts.test(String(req.params.id)) })));
app.post('/api/accounts/:id/signin', route((req) => swarm.accounts.signIn(String(req.params.id), (req.body ?? {}).mode === 'setup-token' ? 'setup-token' : 'login')));
app.post('/api/accounts/:id/signin/code', route((req) => swarm.accounts.signInCodeIn(String(req.params.id), (req.body ?? {}).code)));
app.post('/api/accounts/:id/signin/answer', route((req) => swarm.accounts.signInAnswer(String(req.params.id), (req.body ?? {}).option)));
app.delete('/api/accounts/:id', route(async (req) => ({ result: await swarm.accounts.remove(String(req.params.id)) })));
app.post('/api/accounts/:id/use-now', route((req) => swarm.useAccountNow(String(req.params.id))));
app.post('/api/accounts/:id/simulate-limit', route((req) => swarm.simulateAccountLimit(String(req.params.id))));
app.get('/api/voice/voices', route(() => swarm.voice.voices()));
app.get(
  '/api/voice/messages/:id',
  route(async (req, res) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const q = parse(z.object({ cached: z.literal('1').optional(), whole: z.literal('1').optional(), part: z.coerce.number().int().min(0).max(99).default(0) }), req.query);
    if (!q.cached) return sendAudio(res, await swarm.voice.messageAudio(id, !!q.whole));
    // The phone's ▶: a saved clip or a 404, never a new synthesis. Not kept by the browser, so "Clear saved clips" holds.
    const { audio, parts } = await swarm.voice.cachedAudio(id, q.part);
    res.setHeader('X-Voice-Parts', String(parts));
    sendAudio(res, audio, 'no-store');
  }),
);
app.delete('/api/voice/cache', route(() => swarm.voice.clearCache()));
// The 🎙 with ElevenLabs: the recorded clip as the raw body (its Content-Type, X-Clip-Ms its length). A body over the
// cap is refused before it's read, in the same words as clipProblem's.
const clipBody = express.raw({ type: () => true, limit: CLIP_MAX_BYTES });
app.post(
  '/api/voice/transcribe',
  (req, res, next) => clipBody(req, res, (err?: unknown) => next((err as { type?: unknown } | undefined)?.type === 'entity.too.large' ? new HttpError(413, CLIP_TOO_BIG) : err)),
  route(async (req) => {
    const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return { text: await swarm.voice.transcribe(audio, req.get('content-type'), Number(req.get('x-clip-ms'))) };
  }),
);
app.get(
  '/api/voice/sample',
  route(async (req, res) => sendAudio(res, await swarm.voice.sampleAudio(parse(z.object({ voiceId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'not a voice id').optional() }), req.query).voiceId))),
);
app.get(
  '/api/voice/standup',
  route(async (req, res) => {
    const q = parse(z.object({ n: z.coerce.number().int().min(1).max(99), part: z.enum(DAY_PARTS) }), req.query);
    sendAudio(res, await swarm.voice.standupAudio(q.n, q.part));
  }),
);
// A clicked agent's line (#321): the words (POST, `hour` the manager's local hour), then its clip in their voice (GET).
app.post('/api/voice/lines/:id', route((req) => swarm.agentSays(String(req.params.id), parse(z.object({ hour: z.number().int().min(0).max(23) }), req.body ?? {}).hour)));
app.get('/api/voice/lines/:id', route(async (req, res) => sendAudio(res, await swarm.agentLineAudio(String(req.params.id)), 'no-store')));
// Notifications (docs/pocket.md). Webhook URLs, tokens and push subscriptions go in; only hints come back out.
app.put('/api/notify/webhooks/:channel', route((req) => swarm.notifier.setWebhook(String(req.params.channel), req.body ?? {})));
app.post('/api/notify/test', route((req) => swarm.notifier.test(str(req.body?.channel))));
app.get('/api/notify/push/key', route(() => swarm.notifier.pushKey()));
app.post('/api/notify/push/devices', route((req) => swarm.notifier.subscribe(req.body?.subscription, req.body?.name)));
app.delete('/api/notify/push/devices', route((req) => swarm.notifier.unsubscribe(str(req.body?.endpoint))));
app.post('/api/notify/push/whois', route((req) => swarm.notifier.whois(str(req.body?.endpoint))));
app.patch('/api/notify/push/devices/:id', route((req) => swarm.notifier.renameDevice(String(req.params.id), req.body?.name)));
app.delete('/api/notify/push/devices/:id', route((req) => swarm.notifier.removeDevice(String(req.params.id))));
app.post('/api/notify/push/devices/:id/test', route((req) => swarm.notifier.testDevice(String(req.params.id))));
app.post('/api/notify/push/report', route((req) => swarm.notifier.report(req.body?.step, req.body?.error)));
app.post('/api/notify/ntfy/quick', route(() => swarm.notifier.quickNtfy()));
app.put('/api/notify/telegram', route((req) => swarm.telegram.setToken(req.body?.token)));
app.post('/api/notify/telegram/link', route(() => swarm.telegram.link()));
app.post('/api/notify/telegram/retry', route(() => swarm.telegram.retryNow()));
app.delete('/api/notify/telegram', route(() => swarm.telegram.remove()));
app.post('/api/notify/telegram/demo', route((req) => swarm.telegramDemo(req.body ?? {})));
// The office's own update: Update now / Later
app.post('/api/office/update', route((req) => swarm.updateOffice(req.body?.action)));
// Claude's usage: resume full speed after a usage warning; in the demo, a warning or the limit on demand
app.post('/api/usage/resume', route(() => swarm.resumeFullSpeed()));
app.post('/api/usage/simulate', route((req) => swarm.simulateUsage(req.body?.kind)));
// The health strip (#55): in the demo, low memory on demand
app.post('/api/health/simulate', route((req) => swarm.health.simulate(req.body?.low === true)));
// The disk (#340): "Free up space"'s preview and run, the disk settings (a new working-copies disk is checked), the demo's low disk
app.get('/api/disk/plan', route(() => swarm.diskPlan()));
app.post('/api/disk/clean', route(() => swarm.cleanDisk()));
app.patch('/api/disk/settings', route((req) => swarm.setDiskSettings(req.body)));
app.post('/api/disk/simulate', route((req) => swarm.simulateDisk(req.body?.low === true)));
// The server's load by program (#271): the 24 h trend (in memory), and Mission control's "Stop it" for a leftover process
app.get('/api/server/trend', route(() => swarm.serverTrend()));
app.post('/api/server/orphans/:pid/stop', route((req) => swarm.stopOrphan(Number(req.params.pid))));
// The test lab desk's thumbnails (#56): a recent result's first screenshot.
app.get('/api/testlab/shot/:id', (req, res) => {
  const file = swarm.testLab.shotFile(String(req.params.id));
  res.setHeader('Cache-Control', 'no-store');
  if (!file) return void res.status(404).end();
  res.setHeader('Content-Type', 'image/png');
  res.sendFile(file, { dotfiles: 'allow' }, (err) => err && !res.headersSent && res.status(404).end()); // it sits in .lab/
});
// The office doctor (#262): a finding's one-click fix or Ignore; in the demo, its scenarios
app.post('/api/doctor/fix', route((req) => swarm.doctorFix(req.body?.id, req.body?.fix)));
app.post('/api/doctor/ignore', route((req) => swarm.doctorIgnore(req.body?.id)));
app.post('/api/doctor/demo', route((req) => swarm.demoDoctor(req.body?.action)));

// The journal, for the time-lapse replay (read-only); the demo can write itself a sample day.
app.get('/api/journal/days', route(() => swarm.journal.days()));
app.get(
  '/api/journal/events',
  route((req) => {
    const { from, to, seek } = parseRange(req.query, Date.now());
    return swarm.journal.read(from, to, seek);
  }),
);
app.post('/api/journal/sample', route(() => swarm.journalSample()));

// The CEO and the manager's phone
app.post(
  '/api/ceo/message',
  route((req) => {
    const files: unknown = req.body.files ?? [];
    if (!Array.isArray(files) || !files.every((f) => typeof f === 'string')) throw new HttpError(400, 'files is a list of file ids');
    const clientId = typeof req.body.clientId === 'string' && /^[\w-]{1,64}$/.test(req.body.clientId) ? req.body.clientId : undefined;
    return swarm.messageCeo(str(req.body.text), Number.isInteger(req.body.replyTo) ? req.body.replyTo : undefined, undefined, files, undefined, clientId);
  }),
);
app.get('/api/ceo/picks', route(() => swarm.ceoPicks()));
app.post('/api/ceo/review', route(() => swarm.requestReview()));
// The chat closer to Claude's (#51): stop, edit and retry, conversations, and what the CEO remembers
app.post('/api/ceo/stop', route(() => swarm.stopCeo()));
app.post('/api/ceo/retry', route(() => swarm.retryCeo()));
app.post('/api/ceo/jobs/:id/redo', route((req) => swarm.redoCeoJob(Number(req.params.id))));
app.post('/api/ceo/messages/:id/edit', route((req) => swarm.editMessage(Number(req.params.id), str(req.body?.text))));
app.post('/api/ceo/messages/:id/react', route((req) => swarm.reactToMessage(Number(req.params.id), str(req.body?.emoji), str(req.body?.note))));
app.get('/api/ceo/messages', route((req) => swarm.chatMessages(Number(req.query.before), Number(req.query.limit))));
app.delete('/api/ceo/messages/:id', route((req) => swarm.removeChatMessage(Number(req.params.id))));
app.post('/api/ceo/conversations', route((req) => swarm.newConversation(req.body?.repoId ?? null)));
app.get('/api/ceo/conversations/search', route((req) => swarm.searchConversations(typeof req.query.q === 'string' ? req.query.q : '')));
app.post('/api/ceo/conversations/:id/open', route((req) => swarm.openConversation(String(req.params.id))));
app.post('/api/ceo/conversations/:id/pin', route((req) => swarm.editConversation(String(req.params.id), { pinned: req.body?.pinned === true })));
app.post('/api/ceo/conversations/:id/edit', route((req) => swarm.editConversation(String(req.params.id), req.body)));
app.get('/api/ceo/library', route((req) => swarm.library(libraryQuery(req.query))));
app.get('/api/ceo/notes', route(() => swarm.ceoNotes()));
app.post('/api/ceo/memory', route((req) => swarm.addMemory(str(req.body?.text))));
app.put('/api/ceo/memory/:id', route((req) => swarm.editMemory(String(req.params.id), str(req.body?.text))));
app.delete('/api/ceo/memory/:id', route((req) => swarm.deleteMemory(String(req.params.id))));
app.get('/api/messages/:id/artifacts/:artifactId', route((req) => swarm.artifact(Number(req.params.id), String(req.params.artifactId))));
app.get('/api/messages/:id/refs/:index/file', route((req) => swarm.refFile(Number(req.params.id), Number(req.params.index))));
app.post('/api/notices/read', route((req) => swarm.readNotices(req.body?.ids)));
app.post('/api/phone/read', route((req) => swarm.markPhoneRead(Number(req.body?.at) || Date.now())));
app.post(
  '/api/requests/:id/approve',
  route((req) =>
    swarm.approveRequest(String(req.params.id), {
      name: str(req.body?.name) || undefined,
      cli: typeof req.body?.cli === 'string' ? req.body.cli : undefined,
      model: typeof req.body?.model === 'string' ? req.body.model : undefined,
      effort: typeof req.body?.effort === 'string' ? req.body.effort : undefined,
      host: typeof req.body?.host === 'string' ? req.body.host : undefined,
      note: str(req.body?.note),
    }),
  ),
);
app.post('/api/requests/:id/reject', route((req) => swarm.rejectRequest(String(req.params.id), str(req.body?.note))));
app.post('/api/decisions/:id', route((req) => swarm.decideOpen(String(req.params.id), req.body?.action)));
// The demo office only: the CEO grows (or shrinks) a floor's team on demand.
app.post('/api/demo/proposals', route((req) => swarm.demoPropose(req.body?.kind, req.body?.floor)));
app.post('/api/demo/new-commit', route(() => swarm.demoNewCommit()));
app.post('/api/demo/lab-update', route(() => swarm.demoLabUpdate()));

// Office progression (#210): the lobby kiosk, a floor's decorations, the player's coffees, and the demo's coins and
// tenure for QA.
app.post('/api/repos/:repo/decor/buy', route((req) => swarm.buyDecoration(repoId(req), req.body?.item)));
app.post('/api/repos/:repo/decor/place', route((req) => swarm.placeDecoration(repoId(req), req.body ?? {})));
app.post('/api/progress/coffee', route((req) => swarm.drankCoffee(req.body?.id)));
app.post('/api/progress/demo', route((req) => swarm.demoProgress(req.body ?? {})));

// Serve the built client: the published package, or `npm start` after `npm run build`.
const dist = path.resolve(import.meta.dirname, '../dist');
if (fs.existsSync(dist)) {
  // The installable app's worker, versioned by the build and the office's commit so an update replaces it (server/pwa.ts).
  app.get('/sw.js', (_req, res) => {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(serviceWorkerSource(swVersion(html, VERSION, swarm.officeCommit())));
  });
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // express.json() flags malformed bodies with a 4xx status of its own.
  const parserStatus = (err as { status?: unknown })?.status;
  const status = err instanceof HttpError ? err.status : typeof parserStatus === 'number' && parserStatus >= 400 && parserStatus < 500 ? parserStatus : 500;
  const message = err instanceof Error ? err.message : String(err);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

const server = http.createServer(app);
// Node cuts a request still arriving after 5 minutes; a 500 MB upload from a phone can take longer (#148).
server.requestTimeout = 2 * 3600_000;
// Two sockets: /ws carries the office's state to every tab, /ws/term?agent=<id> one agent's terminal to whoever opened it.
const wss = new WebSocketServer({ noServer: true });
const terms = new WebSocketServer({ noServer: true });
// The public demo's scrubber sees everything a tab is sent.
const scrubbed = (ws: WebSocket) => {
  if (!scrub) return ws;
  const send = ws.send.bind(ws);
  ws.send = ((data: unknown, ...rest: unknown[]) => (send as (...a: unknown[]) => void)(typeof data === 'string' ? scrub(data) : data, ...rest)) as typeof ws.send;
  return ws;
};
wss.on('connection', (raw) => {
  const ws = scrubbed(raw);
  swarm.addClient(ws);
  presence.attach(ws);
});
// The heartbeat (#93): a tab that stops hearing it knows its socket died quietly (a phone's background) and reconnects.
const BEAT = JSON.stringify({ type: 'beat' } satisfies ServerEvent);
setInterval(() => {
  for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(BEAT);
}, BEAT_MS).unref();
terms.on('connection', (ws, req) => swarm.attachTerminal(new URL(req.url ?? '', 'http://localhost').searchParams.get('agent') ?? '', scrubbed(ws)));
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '', 'http://localhost');
  const target = pathname === '/ws' ? wss : pathname === '/ws/term' ? terms : null;
  if (!target && upgradeGateway(req, socket as Socket, head, proxied, previewUse)) return;
  if (!target) return void socket.destroy();
  if (PUBLIC_DEMO && !wsLimit.take(ipOf(req))) return void socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

server.listen(PORT, HOST, () => {
  const port = (server.address() as AddressInfo).port;
  setOfficeUrl(`http://${localAddress(HOST)}:${port}`);
  const scale = DEMO_SCALE ? `, ${DEMO_SCALE.floors} floors × ${DEMO_SCALE.agents} people` : '';
  const shown = localAddress(HOST) === '127.0.0.1' ? 'localhost' : localAddress(HOST);
  console.log(`\n  🏢 cubefarm ${VERSION} on http://${shown}:${PORT}${DEMO ? `  (DEMO MODE: fake GitHub + fake agents${scale})` : ''}`);
  if (!isLoopback(HOST)) {
    for (const url of networkUrls(HOST, port)) console.log(`     on your network: ${url}`);
    console.log(`     ⚠ listening on ${HOST}: anyone who can reach this machine can use the office and its agents, with no sign-in`);
  }
  if (PUBLIC_DEMO) console.log(`     public demo: visitors change nothing that matters; resets every ${PUBLIC_DEMO_RESET_H} h and 30 min after the last visitor leaves`);
  console.log(`     state: ${STATE_FILE}`);
  console.log(`     workspaces: ${WORKSPACE_ROOT}`);
  const refused = liveLaneRefusal(PREVIEW_PORT, DEMO);
  if (refused) console.warn(`     ⚠ previews won't start: ${refused}`);
  console.log(`     agents' machines: ${DEMO ? '(pretend ones, in the demo)' : MACHINES_DIR}\n`);
});

// Floors' apps don't outlive the office. (A hard kill skips this; the next start clears the orphans.) Agents' CLIs
// carry on through a restart and stop when the office quits.
let closing = false;
const shutdown = (signal: string) => {
  if (closing) return;
  closing = true;
  console.log(`\n  ${signal}: stopping floor previews…`);
  const force = setTimeout(() => process.exit(0), 15_000);
  presence.stop();
  void swarm
    .shutdown(signal === 'restart')
    .catch((err) => console.error(err))
    .finally(() => {
      clearTimeout(force);
      // The public demo starts over: its home emptied, the service manager starts it fresh (ops/cubefarm-demo.service).
      if (signal === 'reset') for (const f of fs.readdirSync(HOME_DIR)) fs.rmSync(path.join(HOME_DIR, f), { recursive: true, force: true, maxRetries: 3 });
      process.exit(0);
    });
};
if (PUBLIC_DEMO) {
  const startedAt = Date.now();
  let goneAt: number | null = null;
  wss.on('connection', (ws) => {
    goneAt = null;
    ws.on('close', () => void (wss.clients.size === 0 && (goneAt = Date.now())));
  });
  setInterval(() => {
    const why = resetDue({ now: Date.now(), startedAt, visitors: wss.clients.size, goneAt, everyMs: PUBLIC_DEMO_RESET_H * 3600_000 });
    if (why) {
      console.log(`\n  public demo: resetting (${why === 'idle' ? 'the last visitor left' : 'its schedule'})`);
      shutdown('reset');
    }
  }, 60_000).unref();
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGHUP', () => shutdown('SIGHUP')); // its terminal window closed (macOS, Linux; Windows' console too)
// The launcher asks the office to stop: to restart it (an update, a code change) unless it says it's quitting.
if (underLauncher()) {
  process.on('message', (msg) => {
    const m = msg as { type?: unknown; restart?: unknown } | null;
    if (m?.type === 'office:shutdown') shutdown(m.restart === false ? 'stop' : 'restart');
  });
}
