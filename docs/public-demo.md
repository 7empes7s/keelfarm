# The public demo

`--demo --public-demo` (or `SWARM_PUBLIC_DEMO=1`) is an office for visitors: the whole app (3D office, pocket mode, the
CEO chat, agents, the Kanban, terminals) over fake GitHub and fake agents, safe to put behind a public hostname.

What it changes on top of `--demo`:

- **Nothing that matters can be changed.** Settings for models, CLIs, folders, the daily log, notifications and
  tools, every key or token, notification setup (`/api/notify/*`, apart from the demo's own Telegram scene) and the
  office's update answer 403 with "Not in the demo: …", shown as a toast. Looks and behaviour (company name, weather,
  themes, the CEO's settings…) and everything kept in the browser (accessibility, the camera) stay open. The folder
  picker only shows the pretend `/demo/projects` folders.
- **Uploads are capped:** images, PDFs and text files only, 5 MB each, 50 MB in all (the oldest go first).
- **No host paths:** every answer, `/ws` message and terminal shows `~/demo/…` in place of this machine's folders.
- **Rate limits per visitor** on `/api` and `/ws` (by `CF-Connecting-IP` when the request comes through the local
  tunnel, else the socket's address).
- **It resets itself** every 6 hours (`SWARM_PUBLIC_DEMO_RESET_H`) and 30 minutes after the last visitor leaves: it
  quits after emptying its `SWARM_HOME`, and the service manager starts it fresh. The header and the start screen
  say "Demo office · resets every 6 h".
- **It only starts safely:** with `--demo`, on loopback (`SWARM_HOST` unset or 127.0.0.1) and with a `SWARM_HOME` of
  its own (never `~/.cubefarm`), since it wipes that folder.

## Install (Linux, systemd)

A checkout of its own, never the live office's folder:

```bash
sudo git clone https://github.com/7empes7s/keelfarm /opt/cubefarm-demo
cd /opt/cubefarm-demo && sudo npm ci && sudo npm run build
sudo cp ops/cubefarm-demo.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now cubefarm-demo
curl -s localhost:4400/api/state | head -c 200   # the demo answers
```

The unit runs as a throwaway user (`DynamicUser`), on port 4400 (never 4317/5317, and not 4399, which a test office
uses), with its state in `/var/lib/cubefarm-demo`, at most 600 MB of memory, and restarts on exit. To update it:
`git pull`, `npm ci`, `npm run build` in `/opt/cubefarm-demo`, then `sudo systemctl restart cubefarm-demo`.

## The public hostname (Cloudflare)

The office listens on 127.0.0.1 only; cloudflared on the same machine connects to it. In the Zero Trust dashboard:
**Networks → Tunnels →** your tunnel **→ Public hostname → Add**: hostname `farm.techinsiderbytes.com`, service
`HTTP`, URL `localhost:4400`. WebSockets pass through by default. Check it from a phone on mobile data: the start
screen says "Demo office · resets every 6 h".
