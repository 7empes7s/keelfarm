# Deep links

Every page, tab, sheet and 3D place has a link (#413), in pocket mode (`?pocket=1`) and the 3D office (`?pocket=0`).
Open one cold and the office goes straight to it: the 3D office skips the start screen, walks you to the place and
opens its panel. What's open writes itself back to the address, so any screen can be copied as a link. Back still
closes the top panel.

The table is `ROUTES` in `client/src/routes.ts` (pure, tested in `routes.test.ts`); `client/src/routeLink.ts` opens
links and keeps the address up to date.

| Link | Opens | Offices |
| --- | --- | --- |
| `#tab/<company\|chat\|kanban\|team\|approvals>` | pocket mode's tab (`?tab=` works too); the 3D office opens the same thing | both |
| `#<group>/<section>` | a console section, e.g. `#settings/providers`, `#company/ops`; `#console/settings/providers` works too | both |
| `#previews[/<floor>/<main\|pr-N>]` | the Previews page | both |
| `#floor/<N>/kanban`, `#floor/<N>/app` | a floor's Kanban (3D: at its whiteboard), its app preview | both |
| `#floor/<N>/decor` | a floor's decor box | 3D |
| `#agent/<name>/<chat\|terminal\|now\|profile\|setup>` | an agent's window on that tab (3D: at their desk); `ceo` for the CEO | both |
| `#pr/<floor>/<N>`, `#issue/<floor>/<N>` | a PR's or an issue's page | both |
| `#usage`, `#notices`, `#sound` | Mission control at the usage meter, the notification centre, the sound settings | both |
| `#elevator`, `#catalogue`, `#floor-list` | the elevator panel, the lobby's kiosk, this floor as a list | 3D |
| `#phone/<chat\|hires\|company\|games>`, `#help/<office\|controls>` | the phone or help on a tab | 3D |
| `#tour/<step id>` | one tour step on its own (ids in `client/src/ui/tourSteps.ts`) | both |
| `#3d/floor/<N>[/whiteboard]`, `#3d/desk/<name>` | the camera on a floor, at its whiteboard, at an agent's desk | 3D |
| `#3d/<manager\|ceo\|maproom\|lobby\|screens\|it>` | the manager's or CEO's office, the map room, the lobby, the lobby's screens, the IT office's help desk | 3D |

## For QA

- Wait for `html[data-route-ready]` before a screenshot or check (`lab_screenshot`'s `wait_for`, or an
  `expect_visible` step). `"1"`: the routed view is on screen. `"unknown"`: the link names nothing in this office (no
  such floor, agent or step, or a 3D-only link in pocket mode). `"missing"`: its view never showed, which is a bug.
  `data-route` holds the link it opened. With no link it says `"1"` once the snapshot is in.
- `window.__swarmRoutes.links()` in the browser lists a real link for every row, from this office's floors and
  agents. `e2e/deepLinks.spec.ts` opens each one cold.
- Opening another link in the same page only changes the hash, which the office follows too. To load one cold, also
  change the query, e.g. `/?pocket=0&n=2#pr/1/29`.
