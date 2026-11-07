// Where a chat link to a console section lands in pocket mode (#151): a floor's team is the Team tab, anything else the
// console. The team's scroll and highlight are one-shot, so later visits to the tab open it as usual. Pure.

/** `clearBack`: drop the panel saved to go back to. In pocket mode that's the phone (the Chat tab), which the jump
 *  replaces: closing the overlay would restore it, and the Chat tab would undo the jump. */
export type PocketJump = ({ to: 'team'; repoId: string; backToChat: boolean } | { to: 'console' }) & { clearBack: boolean };

/** Where a link asking for the console's `tab` (at `repoId`) goes; `onChat`: it was tapped in the Chat tab; `back`: the
 *  panel saved to go back to. */
export function pocketJump(want: { tab?: string; repoId?: string }, onChat: boolean, back: { kind: string } | null): PocketJump {
  const clearBack = back?.kind === 'phone';
  if (want.tab === 'team' && want.repoId) return { to: 'team', repoId: want.repoId, backToChat: onChat, clearBack };
  return { to: 'console', clearBack };
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
