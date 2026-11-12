import { describe, expect, it } from 'vitest';
import type { ItRunbookJob } from '../shared/itRunbook.ts';
import { memoryExec, memoryFiles } from './itFiles.ts';
import { CADDYFILE, parseRunbook, runbookSummary, runbookVerdict, runRunbook, setCaddyBlock, setEnv, stepLabel, stepNever, undoRunbook, type RunbookHost, type RunbookPolicy } from './itRunbook.ts';

// #611: a runbook from a floor's repo runs as one job: parsed from markdown, auto-approved when every step is the
// project's own, progress per step, stop on the first failure, a health check last, and an Undo that restores it all.
// Secrets are generated or come from Providers and never show in any output.

const RUNBOOK = `# Install Postiz

Postiz behind Caddy.

## Steps

\`\`\`bash
git clone https://github.com/acme/clipfarm.git /opt/clipfarm
sudo mkdir -p /opt/postiz
install -m 0644 /opt/clipfarm/ops/postiz/docker-compose.yml /opt/postiz/docker-compose.yml
\`\`\`

\`\`\`env /opt/postiz/.env from /opt/clipfarm/ops/postiz/.env.example
JWT_SECRET=generate
POSTGRES_PASSWORD=generate:24
OPENAI_API_KEY=provider:openai
MAIN_URL=https://postiz.example.com
\`\`\`

\`\`\`bash
docker compose -f /opt/postiz/docker-compose.yml up -d
install -m 0644 /opt/clipfarm/ops/postiz/postiz.service /etc/systemd/system/postiz.service
systemctl daemon-reload
systemctl enable --now postiz
\`\`\`

\`\`\`caddy postiz.example.com
reverse_proxy localhost:5000
\`\`\`

## Health check

\`\`\`bash
curl -fsS --max-time 20 https://postiz.example.com/
\`\`\`
`;

const OPENAI = 'sk-proj-THEKEYVALUE1234567890abcd';
const scope = { project: 'postiz', repoName: 'clipfarm', repoUrls: ['https://github.com/acme/clipfarm'] };
const policy = (level: RunbookPolicy['level'] = 'routine'): RunbookPolicy => ({ ...scope, level, protectedDirs: ['/root/keelfarm', '/root/.cubefarm'], itUnits: [], officeUnits: ['cubefarm.service'], exists: () => false, linux: true });

function steps(md = RUNBOOK) {
  const r = parseRunbook(md);
  if ('refused' in r) throw new Error(r.refused);
  return r;
}

/** The clone's files, which git clone brings. */
const REPO: Record<string, string> = {
  '/opt/clipfarm/ops/postiz/docker-compose.yml': 'services: {}\n',
  '/opt/clipfarm/ops/postiz/postiz.service': '[Service]\nExecStart=/usr/bin/docker compose up\n',
  '/opt/clipfarm/ops/postiz/.env.example': '# Postiz\nJWT_SECRET=\nPOSTGRES_PASSWORD=change-me\nMAIN_URL=http://localhost\nOTHER=kept\n',
};

/** A fake machine: its files in memory, the commands it ran, and `fail` for the ones that break. */
function machine(fail?: (argv: string[]) => boolean) {
  const m = memoryFiles({ [CADDYFILE]: 'keel.example.com {\n\treverse_proxy localhost:3600\n}\n' });
  const ran: string[][] = [];
  const exec = memoryExec(m, (argv) => (fail?.(argv) ? { code: 1, out: '', err: `${argv[0]}: it broke` } : null));
  const host: RunbookHost = {
    ...m,
    exec: async (argv, ms, cwd) => {
      ran.push(argv);
      const r = await exec(argv, ms, cwd);
      if (r.code === 0 && argv[0] === 'git' && argv[1] === 'clone') for (const [p, data] of Object.entries(REPO)) await m.write(p, data, 0o644);
      return r;
    },
  };
  return { m, host, ran };
}

const job = (plan: ReturnType<typeof steps>['steps']): ItRunbookJob => ({
  id: 'rb-1',
  title: 'Install Postiz',
  project: 'postiz',
  source: 'floor 4: ops/postiz/RUNBOOK.md',
  by: 'Iris',
  at: 1,
  summary: '',
  auto: true,
  state: 'waiting',
  steps: plan.map((s) => ({ label: stepLabel(s), state: 'waiting', ...(s.kind === 'run' && s.check && { check: true as const }) })),
  undoable: false,
  plan,
  changes: [],
});

const run = (j: ItRunbookJob, host: RunbookHost, outs: string[]) =>
  runRunbook(j, host, { mask: (s) => s.split(OPENAI).join('[redacted]'), key: (p) => (p === 'openai' ? OPENAI : null), changed: (v) => outs.push(JSON.stringify(v)) });

describe('parseRunbook', () => {
  it('reads the title, the bash lines, the env and caddy blocks, and puts the health check last', () => {
    const r = steps();
    expect(r.title).toBe('Install Postiz');
    expect(r.steps.map((s) => s.kind)).toEqual(['run', 'run', 'run', 'env', 'run', 'run', 'run', 'run', 'caddy', 'run']);
    expect(r.steps[1]).toEqual({ kind: 'run', argv: ['mkdir', '-p', '/opt/postiz'] }); // sudo dropped: IT runs as root
    expect(r.steps[3]).toMatchObject({ kind: 'env', file: '/opt/postiz/.env', from: '/opt/clipfarm/ops/postiz/.env.example', vars: [{ name: 'JWT_SECRET', value: { generate: 32 } }, { name: 'POSTGRES_PASSWORD', value: { generate: 24 } }, { name: 'OPENAI_API_KEY', value: { provider: 'openai' } }, { name: 'MAIN_URL', value: { literal: 'https://postiz.example.com' } }] });
    expect(r.steps.at(-1)).toMatchObject({ kind: 'run', check: true, argv: ['curl', '-fsS', '--max-time', '20', 'https://postiz.example.com/'] });
    expect(runbookSummary(r.steps, scope)).toBe('10 steps, touches /opt/clipfarm, /opt/postiz, a systemd unit postiz, docker compose for postiz, the Caddy block for postiz.example.com');
  });

  it('refuses a caddy block that writes its own site line', () => {
    expect(parseRunbook('```caddy p.example.com\np.example.com {\n}\n```')).toMatchObject({ refused: expect.stringMatching(/directives only/) });
    expect(parseRunbook('```caddy p.example.com\nhandle /api {\n\treverse_proxy :1\n}\n```')).toMatchObject({ steps: [{ kind: 'caddy' }] });
  });

  it('refuses shell lines, pointing secrets to an env block', () => {
    const r = parseRunbook('```bash\necho "JWT=$(openssl rand -hex 32)" >> /opt/postiz/.env\n```');
    expect(r).toMatchObject({ refused: expect.stringMatching(/no shell.*```env block/s) });
  });
});

describe('the policy', () => {
  it("auto-approves a runbook whose steps are all the project's own", () => {
    const r = steps();
    expect(runbookVerdict(r.steps, policy())).toEqual({ auto: true });
    expect(r.steps.map((s) => stepNever(s, scope, policy().protectedDirs))).toEqual(r.steps.map(() => null)); // .env writes are allowed now
  });

  it('a step outside the policy turns the whole job into one card', () => {
    const r = steps(RUNBOOK.replace('systemctl daemon-reload', 'systemctl restart nginx'));
    expect(runbookVerdict(r.steps, policy())).toEqual({ auto: false, why: expect.stringMatching(/^step 7, `systemctl restart nginx`: .*only units IT installed/) });
    expect(runbookVerdict(steps().steps, policy('off'))).toEqual({ auto: false, why: 'auto-approve is off' });
  });

  it("other projects' files, the firewall and KEEL still ask or never run", () => {
    const one = (line: string) => steps(`\`\`\`bash\n${line}\n\`\`\``).steps;
    expect(runbookVerdict(one('systemctl restart clipfarm'), policy()).auto).toBe(false);
    expect(runbookVerdict(one('rm -rf /opt/other'), policy()).auto).toBe(false);
    expect(runbookVerdict(one('ufw allow 5000'), policy()).auto).toBe(false);
    expect(runbookVerdict(one('docker compose -f /opt/other/compose.yml up -d'), policy()).auto).toBe(false);
    expect(runbookVerdict(one('git clone https://github.com/evil/repo.git /opt/postiz'), policy()).auto).toBe(false);
    const env = one('install -m 600 /opt/clipfarm/ops/postiz/.env.example /opt/postiz/.env'); // refused outright before #611
    expect(stepNever(env[0], scope, [])).toBeNull();
    expect(runbookVerdict(env, policy())).toEqual({ auto: true });
    expect(stepNever(one('cat /opt/postiz/.env')[0], scope, [])).toMatch(/holds secrets/); // reading a credential file: never
    expect(stepNever(one('cp /etc/keel/keel.env /opt/postiz/keel.env')[0], scope, [])).toMatch(/holds secrets/);
    expect(stepNever({ kind: 'env', file: '/etc/keel/keel.env', vars: [] }, scope, [])).toMatch(/only under \/opt\/postiz/);
  });
});

describe('runRunbook', () => {
  it('runs as one job: env from the template with generated and Providers secrets, backups, the check last, and a full Undo', async () => {
    const { m, host, ran } = machine();
    const j = job(steps().steps);
    const outs: string[] = [];
    await run(j, host, outs);
    expect(j.state).toBe('done');
    expect(j.steps.every((s) => s.state === 'done')).toBe(true);
    expect(j.check).toEqual({ ok: true, out: '' });
    expect(outs.length).toBe(20); // running and finished, per step

    const env = m.files.get('/opt/postiz/.env')!;
    expect(env.mode).toBe(0o600);
    const jwt = env.data.match(/^JWT_SECRET=(\w+)$/m)![1];
    const pg = env.data.match(/^POSTGRES_PASSWORD=(\w+)$/m)![1];
    expect(jwt).toMatch(/^[0-9a-f]{64}$/);
    expect(pg).toMatch(/^[0-9a-f]{48}$/);
    expect(env.data).toContain(`OPENAI_API_KEY=${OPENAI}\n`);
    expect(env.data).toContain('# Postiz\n');
    expect(env.data).toContain('OTHER=kept\n');
    expect(env.data).toContain('MAIN_URL=https://postiz.example.com\n');
    expect(j.steps[3].out).toBe(`/opt/postiz/.env (mode 600): JWT_SECRET (set, ends …${jwt.slice(-4)}), generated; POSTGRES_PASSWORD (set, ends …${pg.slice(-4)}), generated; OPENAI_API_KEY (set, ends …abcd), from Providers (openai); MAIN_URL (set, ends ….com)`);

    expect(m.files.get(CADDYFILE)!.data).toBe('keel.example.com {\n\treverse_proxy localhost:3600\n}\n\n# cubefarm-it:postiz begin\npostiz.example.com {\n\treverse_proxy localhost:5000\n}\n# cubefarm-it:postiz end\n');
    expect(ran.slice(-3)).toEqual([['caddy', 'validate', '--config', CADDYFILE, '--adapter', 'caddyfile'], ['systemctl', 'reload', 'caddy'], ['curl', '-fsS', '--max-time', '20', 'https://postiz.example.com/']]);

    // No secret value in any output: the steps, the progress, the job.
    const everything = JSON.stringify(j).replace(JSON.stringify(j.plan), '') + outs.join('\n');
    for (const secret of [jwt, pg, OPENAI]) expect(everything).not.toContain(secret);

    expect(j.undoable).toBe(true);
    const undo = await undoRunbook(j, host, (s) => s);
    expect(undo.ok).toBe(true);
    expect(m.files.get(CADDYFILE)!.data).toBe('keel.example.com {\n\treverse_proxy localhost:3600\n}\n');
    expect(await host.exists('/opt/postiz')).toBe(false);
    expect(await host.exists('/opt/clipfarm')).toBe(false);
    expect(await host.exists('/etc/systemd/system/postiz.service')).toBe(false);
    expect(ran).toContainEqual(['systemctl', 'disable', '--now', 'postiz.service']);
    expect(ran).toContainEqual(['docker', 'compose', '-f', '/opt/postiz/docker-compose.yml', 'down']);
    expect(ran.slice(-2)).toEqual([['systemctl', 'daemon-reload'], ['systemctl', 'reload', 'caddy']]);
    expect(undo.out).not.toContain(OPENAI);
  });

  it('stops at the first failure with its output, skips the rest, and the Undo restores what it had changed', async () => {
    const { m, host, ran } = machine((argv) => argv[0] === 'docker');
    await m.write('/opt/postiz/.env', 'JWT_SECRET=oldoldoldoldold1\nKEEP=1\n', 0o600);
    const j = job(steps().steps);
    await run(j, host, []);
    expect(j.state).toBe('failed');
    expect(j.steps[4]).toMatchObject({ state: 'failed', code: 1, out: 'docker: it broke' });
    expect(j.steps.slice(5).every((s) => s.state === 'skipped')).toBe(true);
    expect(ran.some((a) => a[0] === 'curl')).toBe(false);
    expect(m.files.get('/opt/postiz/.env')!.data).toMatch(/^JWT_SECRET=oldoldoldoldold1$/m); // a generated secret already set is kept
    await undoRunbook(j, host, (s) => s);
    expect(m.files.get('/opt/postiz/.env')).toEqual({ data: 'JWT_SECRET=oldoldoldoldold1\nKEEP=1\n', mode: 0o600 });
    expect(await host.exists('/opt/clipfarm')).toBe(false);
  });

  it('puts the Caddyfile back at once when it fails to validate, and the health check reports a failure', async () => {
    const bad = machine((argv) => argv[0] === 'caddy');
    const j = job(steps().steps);
    await run(j, bad.host, []);
    expect(j.steps[8]).toMatchObject({ state: 'failed', out: expect.stringMatching(/^caddy validate failed, so the Caddyfile is back as it was/) });
    expect(bad.m.files.get(CADDYFILE)!.data).not.toContain('postiz');

    const down = machine((argv) => argv[0] === 'curl');
    const k = job(steps().steps);
    await run(k, down.host, []);
    expect(k.state).toBe('failed');
    expect(k.check).toEqual({ ok: false, out: 'curl: it broke' });
  });

  it('fails the env step plainly when Providers has no key', async () => {
    const { host } = machine();
    const j = job(steps(RUNBOOK.replace('provider:openai', 'provider:twitch')).steps);
    await run(j, host, []);
    expect(j.steps[3]).toMatchObject({ state: 'failed', out: expect.stringMatching(/no twitch key in Settings → Providers/) });
  });
});

describe('env and Caddy edits', () => {
  it('setEnv replaces lines in place and appends new ones', () => {
    expect(setEnv('A=1\nexport B=2\n# c\n', [{ name: 'B', value: 'x' }, { name: 'C', value: 'y' }])).toBe('A=1\nB=x\n# c\nC=y\n');
  });
  it('setCaddyBlock replaces its own marked block only', () => {
    const once = setCaddyBlock('a.com {\n}\n', 'p', 'p.com', 'reverse_proxy :1');
    expect(setCaddyBlock(once, 'p', 'p.com', 'reverse_proxy :2')).toBe(once.replace(':1', ':2'));
  });
});
