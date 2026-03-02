---
phase: quick-12
plan: 01
subsystem: docs
tags: [deployment, documentation, docker, nginx, digitalocean]
dependency_graph:
  requires: []
  provides: [docs/DEPLOY-DIGITALOCEAN.md]
  affects: []
tech_stack:
  added: []
  patterns: [docker-compose, systemd, nginx-reverse-proxy, certbot-letsencrypt, ufw]
key_files:
  created:
    - docs/DEPLOY-DIGITALOCEAN.md
  modified: []
decisions:
  - "Docker Compose is presented as the recommended deployment method because the named volume handles SQLite WAL persistence automatically"
  - "nginx config includes proxy_buffering off and proxy_read_timeout 300s to support SSE streaming"
  - "Guide uses the official Docker apt repository (not snap) due to known bind mount permission issues with snap Docker"
  - "systemd ExecStart uses full binary path with note for nvm users who need which 429chain"
metrics:
  duration: "2 minutes 18 seconds"
  completed_date: "2026-03-03"
  tasks_completed: 1
  files_created: 1
---

# Quick Task 12: Write a Document Outlining How to Deploy — Summary

**One-liner:** Comprehensive Digital Ocean deployment guide covering Docker Compose and Node.js/systemd paths with nginx reverse proxy, HTTPS, UFW firewall, and production operational runbook.

## What Was Built

`docs/DEPLOY-DIGITALOCEAN.md` — 903-line deployment guide for running 429chain on a Digital Ocean droplet.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write Digital Ocean deployment guide | 1a7f6f6 | docs/DEPLOY-DIGITALOCEAN.md |

## Sections Covered

1. **Prerequisites** — Droplet sizing recommendations (Ubuntu 24.04, 1GB min), domain DNS setup, SSH access
2. **Initial Server Setup** — Non-root deploy user, UFW with OpenSSH, system package updates
3. **Option A: Docker Deployment (Recommended)** — Official Docker apt repo install, config setup, `docker compose up -d`, health check verification, SQLite named volume persistence
4. **Option B: Direct Node.js Deployment** — NodeSource Node.js 20 install, npm global install, systemd unit file with Restart=on-failure and LimitNOFILE, enable/start commands
5. **Reverse Proxy with Nginx** — Full nginx site config with proxy_buffering off, proxy_read_timeout 300s for SSE, Upgrade/Connection headers for WebSocket, sites-enabled symlink, UFW Nginx Full rule
6. **HTTPS with Let's Encrypt** — certbot --nginx certificate issuance, HTTP-to-HTTPS redirect, dry-run renewal verification
7. **Firewall Rules** — Production UFW summary: OpenSSH + Nginx Full only, port 3429 not directly exposed
8. **Updating 429chain** — Docker: git pull + docker compose up --build --force-recreate; Node.js: npm install -g 429chain@latest + systemctl restart
9. **Backup and Restore** — Docker: --volumes-from busybox tar pattern; Node.js: cp data/ directory; config.yaml backup note
10. **Monitoring** — Health endpoint polling, cron-based health check script, web dashboard URL, docker compose logs and journalctl commands
11. **Troubleshooting** — Port conflicts, data directory permissions, config not found, nginx 502 Bad Gateway, SSE buffering, certbot renewal failures

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- [x] `docs/DEPLOY-DIGITALOCEAN.md` exists: FOUND
- [x] Line count 903 >= 200: PASSED
- [x] All 11 sections present: PASSED
- [x] `proxy_buffering off` present: PASSED (3 occurrences)
- [x] systemd service file complete: PASSED
- [x] No placeholder/TODO text: PASSED
- [x] Commit 1a7f6f6 exists: PASSED
