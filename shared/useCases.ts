// The setup advisor's recommendations (#366): one entry per use case a floor can have, as data (no code branches
// per kind), and the office's guess of a floor's use case from the files at the top of its repo. Pure.
import type { AgentCli, ProviderCategory, UseCase } from './types.ts';

/** Who to put on one kind of job, and why, in plain words. */
interface JobPick {
  cli: AgentCli;
  model: string; // '' = the coding agent's own default
  label: string;
  why: string;
}

export interface UseCaseDef {
  id: UseCase;
  label: string;
  icon: string; // an icon name the client knows (ui/icons.ts)
  /** Software agents build and test; the others are the plan's non-code kinds, with lighter checks. */
  code: boolean;
  blurb: string;
  jobs: { build: JobPick; qa: JobPick; fixes: JobPick; docs: JobPick };
  team: number; // agents to start with
  /** What QA must check on every PR here; `match` (a regex, any case) is how a QA brief shows it covers it. */
  qaChecks: { label: string; match: string }[];
  /** The preview's command ({port} is the floor's port); null: none needed, or the package.json default does. */
  preview: string | null;
  needsPreview: boolean;
  browserLab: boolean; // the Test lab's browser and frame checks for QA
  /** Tools & skills items builders should have on (by name; only checked when installed). */
  skills: string[];
  /** Provider categories the floor's work needs a key for (Settings → Providers). */
  providers: ProviderCategory[];
  why: string;
}

const CLAUDE_BUILD: JobPick = { cli: 'claude', model: 'opus', label: 'Claude Code · Opus', why: 'The strongest builder: plans, edits many files and runs the tests itself.' };
const CODEX_QA: JobPick = { cli: 'codex', model: '', label: 'Codex', why: 'A second opinion: a different model catches what the builder missed.' };
const CLAUDE_QA: JobPick = { cli: 'claude', model: 'sonnet', label: 'Claude Code · Sonnet', why: 'Drives the Test lab browser and reads screenshots well.' };
const CLAUDE_FIX: JobPick = { cli: 'claude', model: 'sonnet', label: 'Claude Code · Sonnet', why: 'Small fixes need speed more than depth.' };
const CLAUDE_DOCS: JobPick = { cli: 'claude', model: 'haiku', label: 'Claude Code · Haiku', why: 'Cheap and quick for docs and copy.' };
const GEMINI_DOCS: JobPick = { cli: 'opencode', model: 'google/gemini-2.5-pro', label: 'OpenCode · Gemini', why: 'A long context for reading research and notes; never the main builder.' };

const code = (jobs: Partial<UseCaseDef['jobs']> = {}): UseCaseDef['jobs'] => ({ build: CLAUDE_BUILD, qa: CODEX_QA, fixes: CLAUDE_FIX, docs: CLAUDE_DOCS, ...jobs });
const check = (label: string, match: string) => ({ label, match });
const UI_CHECKS = [check('Every changed screen at 390 px and on a desktop, nothing cut off', '390|mobile|phone|responsive'), check('No console errors on the pages it touches', 'console')];

export const USE_CASES: UseCaseDef[] = [
  {
    id: 'web-app',
    label: 'Web app',
    icon: 'globe',
    code: true,
    blurb: 'A site people sign in to and use: React, Next.js, Vue, Svelte…',
    jobs: code(),
    team: 4,
    qaChecks: [...UI_CHECKS, check('The flow the issue names works end to end in a real browser', 'browser|end to end|e2e|flow')],
    preview: 'npm run dev -- --port {port}',
    needsPreview: true,
    browserLab: true,
    skills: ['frontend-design'],
    providers: [],
    why: 'Web apps break in the browser, not in the tests: QA needs the preview and a real browser.',
  },
  {
    id: 'api',
    label: 'API',
    icon: 'plug',
    code: true,
    blurb: 'A server other programs call: Express, Fastify, FastAPI, Go, Rust…',
    jobs: code(),
    team: 3,
    qaChecks: [check('Each changed endpoint called for real: status codes and response bodies', 'endpoint|status code|curl|request'), check('Errors and bad input give clear error bodies', 'error|invalid|bad input')],
    preview: null,
    needsPreview: true,
    browserLab: false,
    skills: [],
    providers: [],
    why: 'An API is tested by calling it: QA runs it and sends real requests.',
  },
  {
    id: 'game-3d',
    label: '3D / browser game',
    icon: 'gamepad-2',
    code: true,
    blurb: 'A game in the browser: three.js, React Three Fiber, Phaser, Babylon…',
    jobs: code({ qa: CLAUDE_QA }),
    team: 4,
    qaChecks: [
      check('The canvas renders with no console errors', 'canvas|render'),
      check('Frame rate stays smooth (about 60 fps, no long stalls)', 'fps|frame.?rate|frame time'),
      check('Keyboard, mouse and touch controls respond', 'control|keyboard|input|touch'),
    ],
    preview: 'npm run dev -- --port {port}',
    needsPreview: true,
    browserLab: true,
    skills: ['frontend-design'],
    providers: [],
    why: 'Games fail on feel: QA has to play the preview in the Test lab browser and watch the frame rate.',
  },
  {
    id: 'static-site',
    label: 'Static site',
    icon: 'file-text',
    code: true,
    blurb: 'Pages without a server: a blog, docs, a landing page (Astro, Eleventy, plain HTML)',
    jobs: code({ qa: CLAUDE_QA, build: { ...CLAUDE_BUILD, model: 'sonnet', label: 'Claude Code · Sonnet', why: 'Pages and copy rarely need the biggest model.' } }),
    team: 2,
    qaChecks: [...UI_CHECKS, check('Links work and nothing 404s', 'link|404')],
    preview: 'npx serve -l {port}',
    needsPreview: true,
    browserLab: true,
    skills: ['frontend-design'],
    providers: [],
    why: 'A static site is all looks and links: a preview and a browser check catch nearly everything.',
  },
  {
    id: 'cli-library',
    label: 'CLI or library',
    icon: 'keyboard',
    code: true,
    blurb: 'A command-line tool or a package others import',
    jobs: code(),
    team: 2,
    qaChecks: [check('The changed commands or functions run for real, with their output checked', 'run|output|command|example'), check('Tests cover the change and pass', 'test')],
    preview: null,
    needsPreview: false,
    browserLab: false,
    skills: [],
    providers: [],
    why: 'No screen to look at: QA runs the commands and reads the tests.',
  },
  {
    id: 'mobile',
    label: 'Mobile app',
    icon: 'smartphone',
    code: true,
    blurb: 'An iOS or Android app: React Native, Expo, Flutter, Capacitor',
    jobs: code(),
    team: 3,
    qaChecks: [check('Changed screens checked at phone size in the web build or a simulator', 'phone|390|simulator|mobile'), check('Touch targets are at least 44 px', '44')],
    preview: 'npx expo start --web --port {port}',
    needsPreview: true,
    browserLab: true,
    skills: ['frontend-design'],
    providers: [],
    why: 'Phones are the screen: QA checks at phone size, through the web build where there is one.',
  },
  {
    id: 'design',
    label: 'Design studio',
    icon: 'palette',
    code: false,
    blurb: 'Logos, mockups and images',
    jobs: { build: { ...CLAUDE_BUILD, model: 'sonnet', label: 'Claude Code · Sonnet', why: 'Writes the briefs and drives the image tools.' }, qa: CLAUDE_QA, fixes: CLAUDE_FIX, docs: CLAUDE_DOCS },
    team: 2,
    qaChecks: [check('The images match the brief: size, colours, text', 'brief|size|colou?r')],
    preview: null,
    needsPreview: false,
    browserLab: false,
    skills: ['frontend-design'],
    providers: ['image'],
    why: 'Design work runs on an image model: add an image provider first.',
  },
  {
    id: 'video',
    label: 'Video',
    icon: 'clapperboard',
    code: false,
    blurb: 'Clips, edits and voice-overs',
    jobs: { build: { ...CLAUDE_BUILD, model: 'sonnet', label: 'Claude Code · Sonnet', why: 'Writes scripts and drives the video tools.' }, qa: CLAUDE_QA, fixes: CLAUDE_FIX, docs: CLAUDE_DOCS },
    team: 2,
    qaChecks: [check('The clip plays, with the length and format the brief asks for', 'length|format|plays|duration')],
    preview: null,
    needsPreview: false,
    browserLab: false,
    skills: [],
    providers: ['video', 'audio'],
    why: 'Video needs a video model and a voice: add both providers first.',
  },
  {
    id: 'marketing',
    label: 'Social & marketing',
    icon: 'megaphone',
    code: false,
    blurb: 'Posts, campaigns and copy',
    jobs: { build: { ...CLAUDE_BUILD, model: 'sonnet', label: 'Claude Code · Sonnet', why: 'Good copy, fast.' }, qa: CODEX_QA, fixes: CLAUDE_FIX, docs: CLAUDE_DOCS },
    team: 2,
    qaChecks: [check('Copy is on brand, spelled right and fits each network’s length', 'brand|spell|length|tone')],
    preview: null,
    needsPreview: false,
    browserLab: false,
    skills: [],
    providers: ['image'],
    why: 'Posts need pictures: an image provider makes them.',
  },
  {
    id: 'ops',
    label: 'Ops',
    icon: 'wrench',
    code: true,
    blurb: 'Servers, Docker, Terraform, CI',
    jobs: code(),
    team: 2,
    qaChecks: [check('The change is planned or dry-run first, never applied to live servers by QA', 'dry.?run|plan|staging'), check('Secrets stay out of the repo', 'secret')],
    preview: null,
    needsPreview: false,
    browserLab: false,
    skills: [],
    providers: ['cloud'],
    why: 'Ops work touches real servers: a cloud provider key, and QA that only dry-runs.',
  },
  {
    id: 'research',
    label: 'Research & models',
    icon: 'telescope',
    code: true,
    blurb: 'Notebooks, data and model training',
    jobs: code({ docs: GEMINI_DOCS }),
    team: 2,
    qaChecks: [check('Results are reproduced from the committed code and data', 'reproduc|rerun|seed'), check('Numbers in the write-up match the outputs', 'number|metric|result')],
    preview: null,
    needsPreview: false,
    browserLab: false,
    skills: [],
    providers: ['text'],
    why: 'Research reads a lot: a second text model with a long context helps with the reading.',
  },
];

/** What each coding agent is good at, for the guides. */
export const AGENT_NOTES: { name: string; good: string; use: string }[] = [
  { name: 'Claude Code', good: 'Plans and builds whole features, runs the tests, drives the Test lab browser.', use: 'The main builder everywhere. Opus to build, Sonnet for fixes and QA, Haiku for docs.' },
  { name: 'Codex', good: 'A different model family: a sharp second opinion on code.', use: 'QA on web apps and APIs, so the reviewer is not the builder.' },
  { name: 'Gemini (through OpenCode)', good: 'A very long context: reads big docs and data.', use: 'Research and docs. Never the main builder. Needs a Gemini key in Settings → Providers.' },
  { name: 'OpenCode', good: 'Runs many providers’ models, local ones too.', use: 'Trying another model on a floor without a new login.' },
];

/** A use case's guide on GitHub (docs/guides/). */
export const guideUrl = (id: UseCase) => `https://github.com/7empes7s/keelfarm/blob/main/docs/guides/${id}.md`;

export const USE_CASE_IDS = USE_CASES.map((u) => u.id);
export const caseDef = (id: UseCase): UseCaseDef => USE_CASES.find((u) => u.id === id)!;
export const isUseCase = (v: unknown): v is UseCase => typeof v === 'string' && (USE_CASE_IDS as string[]).includes(v);

/** The QA brief's paragraph for a use case, added under what the floor already has. */
export function qaBriefChecks(def: UseCaseDef, missing = def.qaChecks): string {
  return [`${def.label} checks (setup advisor):`, ...missing.map((c) => `- ${c.label}`)].join('\n');
}

/** The checks a QA brief doesn't cover yet. */
export function missingChecks(def: UseCaseDef, brief: string) {
  return def.qaChecks.filter((c) => !new RegExp(c.match, 'i').test(brief));
}

// ---------- the guess ----------

/** The files the guess reads from the top of the repo, when they exist. */
export const SIGNAL_FILES = ['package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pubspec.yaml', 'index.html', 'Dockerfile', 'docker-compose.yml', 'main.tf'];

type Rule = { useCase: UseCase; npm?: string[]; text?: { file: string; words: string[] } };

/** First match wins: the most telling dependencies first (a three.js app is a game before it's a Vite app). */
const RULES: Rule[] = [
  { useCase: 'game-3d', npm: ['three', '@react-three/fiber', 'phaser', 'pixi.js', '@babylonjs/core', 'babylonjs', 'playcanvas', 'kaboom'] },
  { useCase: 'mobile', npm: ['react-native', 'expo', '@capacitor/core', '@ionic/react', '@ionic/angular'] },
  { useCase: 'static-site', npm: ['astro', 'gatsby', '@11ty/eleventy', 'vitepress', '@docusaurus/core', 'hexo'] },
  { useCase: 'web-app', npm: ['next', 'nuxt', '@remix-run/react', '@sveltejs/kit', 'react', 'vue', 'svelte', 'solid-js', '@angular/core', 'vite'] },
  { useCase: 'api', npm: ['express', 'fastify', 'koa', 'hono', '@nestjs/core', '@hapi/hapi'] },
  { useCase: 'api', text: { file: 'py', words: ['fastapi', 'flask', 'django', 'starlette'] } },
  { useCase: 'web-app', text: { file: 'py', words: ['streamlit', 'gradio'] } },
  { useCase: 'research', text: { file: 'py', words: ['torch', 'tensorflow', 'transformers', 'jupyter', 'scikit-learn', 'pandas'] } },
  { useCase: 'game-3d', text: { file: 'Cargo.toml', words: ['bevy'] } },
  { useCase: 'api', text: { file: 'Cargo.toml', words: ['axum', 'actix-web', 'rocket', 'warp'] } },
  { useCase: 'api', text: { file: 'go.mod', words: ['gin-gonic', 'labstack/echo', 'gofiber', 'go-chi'] } },
  { useCase: 'mobile', text: { file: 'pubspec.yaml', words: ['flutter'] } },
];

/** The office's guess from a repo's top files (name → text), with why in a few words; null: no idea. */
export function detectUseCase(files: Record<string, string>): { useCase: UseCase; why: string } | null {
  let deps: string[] = [];
  let bin = false;
  if (files['package.json']) {
    try {
      const pkg = JSON.parse(files['package.json']) as { dependencies?: object; devDependencies?: object; bin?: unknown };
      deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
      bin = !!pkg.bin;
    } catch {
      // not JSON: read the other files
    }
  }
  const py = `${files['pyproject.toml'] ?? ''}\n${files['requirements.txt'] ?? ''}`.toLowerCase();
  const text = (file: string) => (file === 'py' ? py : (files[file] ?? '').toLowerCase());
  for (const r of RULES) {
    const dep = r.npm?.find((d) => deps.includes(d));
    if (dep) return { useCase: r.useCase, why: `${dep} in package.json` };
    const word = r.text && r.text.words.find((w) => new RegExp(`(^|[^a-z0-9-])${w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z0-9-]|$)`).test(text(r.text!.file)));
    if (word) return { useCase: r.useCase, why: `${word} in ${r.text!.file === 'py' ? (files['pyproject.toml'] ? 'pyproject.toml' : 'requirements.txt') : r.text!.file}` };
  }
  if (bin) return { useCase: 'cli-library', why: 'a bin in package.json' };
  for (const f of ['pyproject.toml', 'Cargo.toml', 'go.mod', 'package.json']) if (files[f]) return { useCase: 'cli-library', why: `a ${f} without a web framework` };
  if (files['index.html']) return { useCase: 'static-site', why: 'an index.html at the top' };
  for (const f of ['Dockerfile', 'docker-compose.yml', 'main.tf']) if (files[f]) return { useCase: 'ops', why: `only a ${f}` };
  return null;
}
