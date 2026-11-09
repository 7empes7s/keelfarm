// Settings → Providers (#362): the connections added on the Providers page and the MCP servers the office gives its
// agents. Claude and Codex accounts, the ElevenLabs key and the Upstash key stay in their own stores (accounts.ts,
// voice.ts, cloud.ts); shared/providers.ts shows them all as one list. Never a key: only its last 4 characters.
import type { UsageWindow } from './usage.ts';

export type ProviderCategory = 'coding' | 'text' | 'audio' | 'video' | 'image' | 'cloud' | 'mcp';
export type ProviderAuth = 'api-key' | 'login' | 'oauth' | 'none';

/** The last test of a connection or MCP server: a cheap read-only call. */
export interface ProviderTest {
  at: number;
  ok: boolean;
  note: string; // "Key works", "Turned away (401)", never the key
  windows?: UsageWindow[]; // what the test call said about usage, where the provider tells (OpenRouter's credit)
  plan?: string;
}

/** A key saved on the Providers page; the key itself is in secrets.json (`provider:<id>`). */
export interface ProviderConnection {
  id: string;
  provider: string; // a catalogue id (shared/providers.ts)
  label: string;
  addedAt: number;
  keyHint: string;
  test: ProviderTest | null;
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
}
