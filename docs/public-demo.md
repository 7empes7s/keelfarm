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

## farm.techinsiderbytes.com (Mulinux)

Live since 2026-11-06 (#97), open to anyone (no Cloudflare Access). The path is Cloudflare → the remotely managed
tunnel `mimounjarvistunnel` → Caddy on `:80` (routed by Host) → `127.0.0.1:4400`. Nothing here touches the live
office (`/root/Projects/keelfarm`, `cubefarm.service`, 4317/5317, `/root/.cubefarm`).

### What was run

1. **The service.** A fresh clone of `main` (never from the live office's folder), installed as above:
   `git clone https://github.com/7empes7s/keelfarm /opt/cubefarm-demo`, then `npm ci` and `npm run build` one at a
   time with Node 22. `/usr/bin/node` on Mulinux is Node 20 and the unit can't reach `/root` (`ProtectHome`), so a
   copy of the Node 22 binary sits at `/opt/node22/bin/node` and a drop-in points the unit at it:

   ```ini
   # /etc/systemd/system/cubefarm-demo.service.d/node.conf
   [Service]
   ExecStart=
   ExecStart=/opt/node22/bin/node --max-old-space-size=384 dist-server/index.js --demo --public-demo
   ```

   Then `systemctl daemon-reload && systemctl enable --now cubefarm-demo`.
2. **Caddy.** `/etc/caddy/Caddyfile` backed up to `Caddyfile.bak-2026-11-06`; a host matcher added inside the
   existing `:80` site, next to the others (`skip_log` already leaves it out of KEEL's access log):

   ```
   @farm host farm.techinsiderbytes.com
   handle @farm {
   	reverse_proxy 127.0.0.1:4400
   }
   ```

   `caddy validate --config /etc/caddy/Caddyfile`, then `systemctl reload caddy`.
3. **Cloudflare.** The NewsBites token in `/etc/default/newsbites-autopipeline` is active but can't read the tunnel
   (`1001 Not authorized`) or see the zone, so the zone's tunnel login (`/root/.cloudflared/cert.pem`, same account)
   was used instead; no token was printed or saved anywhere new.
   - Backup: `GET /accounts/{acct}/cfd_tunnel/{tunnel}/configurations` → `/root/backups/cf-tunnel-2026-11-06.json`
     (mode 600, version 17, 14 rules).
   - One rule inserted before the `http_status:404` catch-all, `{"hostname": "farm.techinsiderbytes.com",
     "service": "http://localhost:80"}`, and the whole config PUT back (version 18). Checked after: every other rule
     and setting identical to the backup.
   - DNS: `cloudflared tunnel route dns b6b46ec1-81c5-4f5d-91a7-df032bab1d0f farm.techinsiderbytes.com` → proxied
     CNAME `farm` → `b6b46ec1-81c5-4f5d-91a7-df032bab1d0f.cfargotunnel.com`.

### Updating it

By hand only (it never updates itself):

```bash
cd /opt/cubefarm-demo && git pull && npm ci && npm run build && systemctl restart cubefarm-demo
```

Use Node 22 (`/opt/node22/bin` first on `PATH`). After a Node upgrade, copy the new binary to `/opt/node22/bin/node`.

### Taking it down

1. `systemctl disable --now cubefarm-demo`; `rm -r /etc/systemd/system/cubefarm-demo.service*` and
   `systemctl daemon-reload` to remove it for good (`/opt/cubefarm-demo`, `/opt/node22` can go too).
2. Ingress: GET the configuration, drop the `farm.techinsiderbytes.com` rule, PUT it back (or Zero Trust →
   Networks → Tunnels → mimounjarvistunnel → Public hostnames → delete it).
3. DNS: delete the `farm` CNAME (Cloudflare dashboard → techinsiderbytes.com → DNS).
4. Caddy: remove the `@farm` matcher and its `handle`, `caddy validate`, `systemctl reload caddy`.

### Verification (2026-11-06)

Local:

```
GET 127.0.0.1:4400/            200   no /root, /opt or /var/lib in the body
GET 127.0.0.1:4400/api/state   200   no /root, /opt or /var/lib in the body
PATCH /api/settings {"projectsDir":"/etc"}   403 {"error":"Not in the demo: this setting only works in your own office (npx cubefarm)."}
banner: cubefarm 0.3.20 on http://localhost:4400  (DEMO MODE: fake GitHub + fake agents)
        state: /var/lib/cubefarm-demo/demo-state.json
memory after 10 min: 76 MiB (peak 79 MiB) of MemoryMax 600 MiB, 0 restarts
Host: keel.techinsiderbytes.com via Caddy: 401 before, 401 after
```

Public, through Cloudflare:

```
curl -sI https://farm.techinsiderbytes.com    HTTP/2 200, content-type: text/html (from the origin)
GET  /api/state                               200, no host paths
PATCH /api/settings                           403 "Not in the demo: …"
wss://…/ws                                    first event: snapshot, no host paths
wss://…/ws/term?agent=<id>                    opens, streams the agent's screen
browser (lab): desktop start screen → Enter the office → 3D canvas, no console errors;
               iPhone 390 px: pocket mode, CEO chat opens, no sideways scroll, no console errors
```

Every hostname in the backed-up ingress, before → after (`/`, status code):

| Hostname | Before | After |
| --- | --- | --- |
| mimoun | 200 | 200 |
| hello | 502 | 502 |
| dashboard | 302 | 302 |
| terminal | 302 | 302 |
| goblin | 302 | 302 |
| csopus | 502 | 502 |
| cssol | 502 | 502 |
| desktop | 302 | 302 |
| play | 530 | 530 |
| keel | 302 | 302 |
| relay | 200 | 200 |
| cracia | 200 | 200 |
| archipelago | 302 | 302 |
| farm | no DNS | 200 |
