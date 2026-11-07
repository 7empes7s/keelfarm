// Where a chat link to a console section lands in pocket mode (#151): a floor's team is the Team tab, anything else the
// console. The team's scroll and highlight are one-shot, so later visits to the tab open it as usual. Pure.

export type PocketJump =
  // the tab replaces the console the link opened, so the panel saved to go back to is dropped
  | { to: 'team'; repoId: string; backToChat: boolean; clearBack: true }
  | { to: 'console'; clearBack: false };

/** Where a link asking for the console's `tab` (at `repoId`) goes; `onChat`: it was tapped in the Chat tab. */
export function pocketJump(want: { tab?: string; repoId?: string }, onChat: boolean): PocketJump {
  if (want.tab === 'team' && want.repoId) return { to: 'team', repoId: want.repoId, backToChat: onChat, clearBack: true };
  return { to: 'console', clearBack: false };
}

let landing = false;

/** A link to a team was followed: the Team tab's next landing scrolls there and lights it up. */
export function markTeamLanding() {
  landing = true;
}

/** Whether this landing is a link's (true once per link); a plain visit to the tab is not. */
export function takeTeamLanding(): boolean {
  const was = landing;
  landing = false;
  return was;
}
