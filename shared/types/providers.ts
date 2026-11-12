// Settings → Providers (#362): the connections added on the Providers page and the MCP servers the office gives its
// agents. Claude and Codex accounts, the ElevenLabs key and the Upstash key stay in their own stores (accounts.ts,
// voice.ts, cloud.ts); shared/providers.ts shows them all as one list. Never a key: only its last 4 characters.
import type { UsageWindow } from './usage.ts';

export type ProviderCategory = 'coding' | 'text' | 'audio' | 'video' | 'image' | 'cloud' | 'signin' | 'mcp';
/** What the office asks a provider for (#533): floors and the CEO ask for one of these, never a provider. */
export type Capability = 'text' | 'image' | 'video' | 'audio' | 'operations' | 'publishing';
/** A capability's default and fallback, as card keys ('connection:<id>', 'voice'…); unset = the office picks. */
export interface CapabilityChoice {
  primary?: string;
  fallback?: string;
}
export type ProviderAuth = 'api-key' | 'login' | 'oauth' | 'none';
/** What a key is for (#523): AI models (text, images, video, voice), operations (DNS, tunnels, hosting, GitHub…), or both. */
export type ProviderUse = 'inference' | 'operations' | 'both';

/** The last test of a connection or MCP server: a cheap read-only call. */
export interface ProviderTest {
  at: number;
  ok: boolean;
  note: string; // "Key works", "Turned away (401)", never the key
  windows?: UsageWindow[]; // what the test call said about usage, where the provider tells (OpenRouter's credit)
  plan?: string;
  result?: KeyCheck; // live, dead or no credit (#523); older tests have only ok
  missing?: string[]; // permissions the key lacks (#533): "Zone DNS edit", "Pull requests (read)"
}

/** A key saved on the Providers page; the key itself is in secrets.json (`provider:<id>`). */
export interface ProviderConnection {
  id: string;
  provider: string; // a catalogue id (shared/providers.ts)
  label: string;
  addedAt: number;
  keyHint: string;
  test: ProviderTest | null;
  tags: string[]; // the manager's own (#523)
  usedFor: ProviderUse; // from its catalogue category until the manager picks
  source?: string; // where an imported key came from: "CEREBRAS_API_KEY_PAID · LiteLLM litellm.env"
  named?: boolean; // the manager named it: nothing renames it again
  accountId?: string; // Cloudflare's Account ID, for its account permission checks (#533); not a secret
  scopes?: string[]; // a company sign-in's granted scopes (#533); its tokens stay in secrets.json
  expiresAt?: number; // when a sign-in's access token runs out; refreshed on the server
}

/** An MCP server the office adds to its agents' sessions (their own mcp.json, never ~/.claude). */
export interface McpServerConfig {
  id: string;
  name: string; // the server's name in the session: its tools are mcp__<name>__*
  command?: string; // a local server: the command and its arguments…
  args?: string[];
  url?: string; // …or a remote one over HTTP
  /** Names of its secrets (values in secrets.json): environment variables for a command, headers for a URL. */
  envKeys: string[];
  on: boolean;
  agents: string[]; // ids of the agents who get it; [] = every agent
  test: ProviderTest | null;
}

export interface ProvidersView {
  connections: ProviderConnection[];
  mcp: McpServerConfig[];
  defaults?: Partial<Record<Capability, CapabilityChoice>>; // the manager's picks per capability (#533)
  clients?: string[]; // companies whose OAuth client is saved (#533): their sign-in needs no setup
}

/** Keys found on this computer (#367): what a key's authenticated test said. */
export type KeyCheck = 'live' | 'dead' | 'no-credit' | 'unknown';

/** One key the scan found, without its value (kept in the server's memory until imported or dismissed). */
export interface FoundKeyView {
  id: string;
  provider: string; // a catalogue id, or 'other' for an unknown *_API_KEY / *_TOKEN
  variable: string; // GEMINI_API_KEY
  sources: string[]; // "LiteLLM litellm.env", every file it was in
  keyHint: string; // its last 4 characters
  check: { result: KeyCheck; note: string } | null;
  savedAs?: string; // the connection it already is (saved before, or imported)
  importable: boolean; // a catalogue provider the Providers page saves
}

export interface KeyScanView {
  state: 'idle' | 'scanning' | 'done' | 'failed';
  at: number | null;
  keys: FoundKeyView[];
  note?: string; // why it failed
}
