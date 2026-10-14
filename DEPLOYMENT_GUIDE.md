# 🚀 Tau ERP — Production Deployment Guide (Hostinger VPS)

**Audience:** Anyone deploying Tau ERP to a Hostinger VPS (or any Ubuntu 22.04/24.04 server).
**Time required:** ~15 minutes first time, ~1 minute for subsequent updates.
**Result:** Your own `https://erp.yourcompany.com` with automatic SSL, auto-restart on crashes/reboots, and nightly database backups.

---

## What you need before starting

| # | Item | Where to get it |
|---|---|---|
| 1 | Hostinger VPS plan **KVM1 or higher** (4 GB RAM recommended) | hpanel.hostinger.com → VPS |
| 2 | OS template **Ubuntu 24.04** (or 22.04) installed on the VPS | hPanel → VPS → Settings → OS |
| 3 | VPS **root password** (mailed to you after OS install) | hPanel → VPS → Overview |
| 4 | VPS **public IP** (e.g. `203.0.113.10`) | hPanel → VPS → Overview |
| 5 | *(Optional but recommended)* A domain, e.g. `yourcompany.com` | Any registrar (Hostinger Domains, GoDaddy, Cloudflare…) |

> 💡 **No domain yet?** The app works fine over `http://SERVER_IP`. You can add the domain later and re-run the deploy script.

---

## Step 1 — Get the Tau ERP code onto your VPS

Choose **one** of the two options below. Option A (GitHub) is recommended — it makes future updates one command.

### Option A — via GitHub (recommended)

**A1. Push the project to a private GitHub repo** (from the machine where you have the project, e.g. this sandbox or your PC):

```bash
cd tau-erp
gh repo create tau-erp --private --source=. --push        # if you have GitHub CLI
# — or manually —
git init && git add -A && git commit -m "Tau ERP v1.0"
git remote add origin git@github.com:YOURUSER/tau-erp.git
git push -u origin main
```

> ✅ The repo is deploy-ready as-is: `node_modules`, `.next`, `.env` and logs are git-ignored; the seeded SQLite demo database (`db/custom.db`) **is** included so the app ships with realistic synthetic data.

**A2. Clone it on the VPS:**

```bash
ssh root@203.0.113.10          # your VPS IP; accept the fingerprint, enter root password
apt update && apt install -y git
git clone https://github.com/YOURUSER/tau-erp.git /root/tau-erp
cd /root/tau-erp
```

*(Private repo? GitHub will ask for a token — create one at github.com → Settings → Developer settings → Personal access tokens.)*

### Option B — upload a zip from your computer

1. Download the project folder as a zip from your file manager / IDE.
2. Upload and unzip on the VPS:

```bash
ssh root@203.0.113.10
apt update && apt install -y unzip
# then upload with scp from YOUR computer:
#   scp -r tau-erp.zip root@203.0.113.10:/root/
cd /root && unzip tau-erp.zip
```

---

## Step 2 — Run the one-command deployer

```bash
cd /root/tau-erp
sudo bash deploy/deploy.sh erp.yourcompany.com
```

*(Replace `erp.yourcompany.com` with your real domain — or omit it entirely to deploy on the bare IP first.)*

The script is **fully automatic** and does all of this for you:

1. ✔ Installs system packages, the **Bun** runtime and **Caddy** web server
2. ✔ Creates a 2 GB swapfile if the VPS RAM is small (protects the build step)
3. ✔ Copies the app to `/opt/tau-erp`, owned by a dedicated non-root `tau` user
4. ✔ Generates `.env` with a fresh `NEXTAUTH_SECRET` and correct `NEXTAUTH_URL`
5. ✔ Builds the optimized Next.js standalone production bundle
6. ✔ Seeds the SQLite database on first deploy (synthetic India-GST demo data)
7. ✔ Registers a **systemd service** `tau-erp` — auto-restarts on crash, auto-starts on reboot, timezone `Asia/Kolkata`
8. ✔ Configures the **firewall** (only 22/80/443 open)
9. ✔ Configures **Caddy** — automatic Let's Encrypt HTTPS, HTTP→HTTPS redirect, gzip, static-asset caching, security headers
10. ✔ Waits for a health check (HTTP 200) and prints your URLs

**Expected output:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✔ Tau ERP deployed successfully
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  URL:  https://erp.yourcompany.com
  URL:  http://203.0.113.10
  Logs:   journalctl -u tau-erp -f
  ...
```

---

## Step 3 — Point your custom domain (DNS)

If you deployed **with a domain**, add one DNS record at your registrar:

| Type | Name | Value | TTL |
|---|---|---|---|
| **A** | `erp` (or `@` for root domain) | `203.0.113.10` ← your VPS IP | 3600 |

- **Hostinger-registered domains:** hPanel → Domains → *yourdomain* → DNS / Nameservers → add the A record.
- **Cloudflare-managed:** set the record to **DNS-only (grey cloud)** initially — Caddy must talk to Let's Encrypt directly. You can re-enable the orange cloud afterwards.
- Propagation is usually 5–30 minutes. Caddy detects the DNS change and **automatically issues and renews your SSL certificate** — no certbot, no manual renewals, ever.
- Check from the VPS: `dig +short erp.yourcompany.com` → should print your VPS IP.

> 🔁 Deployed **without** a domain first and got one later? Just re-run:
> `sudo bash deploy/deploy.sh erp.yourcompany.com`
> It keeps your existing database and .env, and only adds the HTTPS domain config.

---

## Step 4 — Verify

```bash
# 1. Service status (should say "active (running)")
systemctl status tau-erp

# 2. Local health
curl -I http://127.0.0.1:3000            # → HTTP/1.1 200 OK

# 3. Live logs (Ctrl+C to exit)
journalctl -u tau-erp -f

# 4. Public site
curl -I https://erp.yourcompany.com       # → HTTP/2 200 + valid TLS
```

Then open `https://erp.yourcompany.com` in a browser — you should see the Tau ERP dashboard with the **SYNTHETIC DATA** banner. Done 🎉

---

## Day-2 operations

### Updating the app (new code version)

```bash
cd /opt/tau-erp && sudo bash deploy/update.sh
```

The update script **backs up the database first**, pulls/rebuilds, restarts, and health-checks. Downtime ≈ 5 seconds.

> Your workflow from the sandbox: commit + push → run `update.sh` on the VPS.

### Backups (recommended: nightly cron)

```bash
# Install sqlite CLI once:  apt install -y sqlite3
crontab -e
# add this line — safe hot backup at 02:30 IST every night, keep 30 copies:
30 2 * * * mkdir -p /opt/tau-erp/backups && sqlite3 /opt/tau-erp/db/custom.db ".backup '/opt/tau-erp/backups/custom-$(date +\%Y\%m\%d).db'" && ls -1t /opt/tau-erp/backups/custom-*.db | tail -n +31 | xargs -r rm -f
```

**Restore:** `systemctl stop tau-erp && cp backups/custom-YYYYMMDD.db db/custom.db && systemctl start tau-erp`

**Optional — continuous offsite backup:** [Litestream](https://litestream.io) streams the SQLite file to S3/Cloudflare R2 in real time.

### Useful commands

| Task | Command |
|---|---|
| App logs | `journalctl -u tau-erp -f` |
| Restart app | `systemctl restart tau-erp` |
| Re-deploy same server | `sudo bash deploy/deploy.sh erp.yourcompany.com` |
| Update to latest code | `sudo bash deploy/update.sh` |
| Web-server (Caddy) logs | `journalctl -u caddy -f` |
| Disk space | `df -h` |
| Memory | `free -h` |

---

## Alternative: Docker deployment

If you prefer containers (skip Steps 2 and the Caddy section — install Docker instead: `curl -fsSL https://get.docker.com | sh`):

```bash
cd tau-erp
NEXTAUTH_URL=https://erp.yourcompany.com \
NEXTAUTH_SECRET=$(openssl rand -base64 32) \
docker compose -f deploy/docker-compose.yml up -d --build
```

- Data persists in the `tau-db` volume; the container restarts automatically.
- Put Caddy/Nginx/Traefik in front for SSL, or run Caddy on the host pointing at `127.0.0.1:3000` (config in `deploy/Caddyfile.production`).

---

## Option C — Cloudflare Workers + D1 (fully serverless)

> ⚠️ **Read first:** Cloudflare Workers has **no filesystem**, so the SQLite file database cannot be used there. This kit migrates the data layer to **Cloudflare D1** (Cloudflare's serverless SQLite — same engine, different storage). `src/lib/db.ts` auto-detects the runtime: **Workers → D1 binding, Node → local SQLite file. Local dev and VPS deployment are completely unaffected.**

Repository already contains everything needed:

| File | Purpose |
|---|---|
| `wrangler.toml` | Cloudflare config (Worker + D1 binding + assets) |
| `open-next.config.ts` | OpenNext adapter config |
| `src/lib/db.ts` | Runtime detection: D1 (Workers) / SQLite (Node) |
| `scripts/export-d1-dump.ts` | Dumps the seeded DB to `d1-seed.sql` for D1 import |
| `bun run cf:build` / `cf:deploy` / `cf:seed` | One-command build / deploy / seed |

### Steps

```bash
# 1. Authenticate (once)
npx wrangler login

# 2. Create the D1 database (once) — copy the printed database_id into wrangler.toml
npx wrangler d1 create tau-erp

# 3. Export the seeded demo dataset and import it into D1 (once)
bun run db:d1:dump                                              # → d1-seed.sql (54 tables, 453 rows)
npx wrangler d1 execute tau-erp --remote --file=d1-seed.sql

# 4. Set the auth secret (once)
npx wrangler secret put NEXTAUTH_SECRET        # paste an openssl rand -base64 32 value

# 5. Build & deploy (every release)
bun run cf:build
bun run cf:deploy
```

### Custom domain on Cloudflare

Easiest of all three options: add your domain to Cloudflare (free plan), then Dashboard → **Workers & Pages → tau-erp → Settings → Domains & Routes → Add → Custom domain** → `erp.yourcompany.com`. SSL is automatic (Cloudflare universal certificate) — no Caddy, no certbot, no DNS juggling.

Also update `wrangler.toml` → `[vars] NEXTAUTH_URL` to `https://erp.yourcompany.com` before deploying.

### Option C notes & troubleshooting

- **Next.js version support:** `@opennextjs/cloudflare` tracks Next.js releases closely, but Next 16 is very new — if `bun run cf:build` fails with an adapter compatibility error, check the adapter's [supported versions](https://opennext.js.org/cloudflare) and/or use Option A (VPS) meanwhile.
- **Prisma on Workers** uses the WASM query-compiler via the D1 driver adapter (`@prisma/adapter-d1@6.19.2`, matching `@prisma/client@6.19.2` — keep both at the same version when upgrading).
- **Re-seeding later:** re-run steps 3 (dump + execute). Wipe first with `npx wrangler d1 execute tau-erp --remote --command "DROP TABLE ..."` or create a fresh database.
- **Local dev stays on SQLite** — no wrangler needed to develop.


---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `deploy.sh` stops at "Build failed" | Almost always RAM. Ensure the swapfile step ran: `free -h`. Re-run the script; it resumes safely. |
| Site unreachable on https | DNS not pointing at the VPS yet → `dig +short erp.yourdomain.com`. Caddy retries automatically once it matches. |
| `systemctl status tau-erp` = failed | `journalctl -u tau-erp -n 50` — typically a wrong `DATABASE_URL` in `/opt/tau-erp/.env`. |
| Port 80 busy (some OS templates pre-install Apache) | `apt remove -y apache2 && systemctl restart caddy` |
| Want to re-seed fresh demo data | `systemctl stop tau-erp && rm /opt/tau-erp/db/custom.db && sudo -u tau bash -lc 'cd /opt/tau-erp && bunx prisma db push && bun scripts/seed-runner.ts' && systemctl start tau-erp` |
| Forgot NEXTAUTH_SECRET / want rotation | Edit `/opt/tau-erp/.env`, then `systemctl restart tau-erp` |
| Firewall locked me out | Never happens with this script (SSH is allowed before `ufw enable`). Emergency: Hostinger hPanel has an Emergency/VNC console. |

---

## Security posture (already applied by deploy.sh)

- ✅ App runs as a **non-root system user** (`tau`) with systemd hardening (`ProtectSystem=full`, `PrivateTmp`, `NoNewPrivileges`)
- ✅ App binds to **127.0.0.1** only — the public can only reach Caddy on 80/443
- ✅ Firewall: only 22/80/443
- ✅ `NEXTAUTH_SECRET` auto-generated, `.env` permission `600`
- ✅ Automatic HTTPS + HSTS + `X-Content-Type-Options` + `X-Frame-Options` + `Referrer-Policy` headers
- 🔲 Recommended extras: SSH key login + disable password auth, `fail2ban`, Hostinger weekly backups toggle in hPanel

---

*tau-erp deploy kit rev A — files: `deploy/deploy.sh`, `deploy/update.sh`, `deploy/tau-erp.service`, `deploy/Caddyfile.production`, `deploy/nginx-tau-erp.conf`, `deploy/.env.production.example`, `deploy/Dockerfile`, `deploy/docker-compose.yml`*
