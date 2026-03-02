---
phase: quick-12
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - docs/DEPLOY-DIGITALOCEAN.md
autonomous: true
requirements: ["QUICK-12"]

must_haves:
  truths:
    - "A user can follow the guide to deploy 429chain on a fresh Digital Ocean droplet from scratch"
    - "The guide covers both Docker and direct Node.js deployment methods"
    - "The guide addresses production concerns: reverse proxy, HTTPS, firewall, persistence, and updates"
  artifacts:
    - path: "docs/DEPLOY-DIGITALOCEAN.md"
      provides: "Complete Digital Ocean deployment guide"
      min_lines: 200
  key_links: []
---

<objective>
Create a comprehensive deployment guide for running 429chain on a Digital Ocean droplet.

Purpose: Users need clear, step-by-step instructions to deploy 429chain to production on a Digital Ocean droplet, covering both Docker Compose (recommended) and direct Node.js approaches, plus production hardening (nginx reverse proxy, HTTPS via Let's Encrypt, UFW firewall, systemd service management).

Output: `docs/DEPLOY-DIGITALOCEAN.md`
</objective>

<execution_context>
@/Users/dan/.claude/get-shit-done/workflows/execute-plan.md
@/Users/dan/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@docs/USAGE.md
@docker-compose.yml
@Dockerfile
@config/config.example.yaml
@README.md
@package.json
@src/index.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write Digital Ocean deployment guide</name>
  <files>docs/DEPLOY-DIGITALOCEAN.md</files>
  <action>
Create `docs/DEPLOY-DIGITALOCEAN.md` covering the following sections in order:

**1. Prerequisites**
- Digital Ocean account
- A droplet: recommend Ubuntu 24.04, minimum 1GB RAM / 1 vCPU ($6/mo droplet), 2GB+ recommended if running other services
- A domain name (optional but recommended for HTTPS)
- SSH access to the droplet

**2. Initial Server Setup**
- SSH into droplet
- Create a non-root user with sudo access (adduser, usermod -aG sudo)
- Set up UFW firewall: allow OpenSSH, enable UFW
- Update system packages (apt update && apt upgrade -y)

**3. Option A: Docker Deployment (Recommended)**
- Install Docker Engine (official Docker apt repo method for Ubuntu — NOT snap)
- Install Docker Compose plugin (comes with Docker Engine package now)
- Clone the repo or create project directory
- Copy config.example.yaml to config/config.yaml and edit with actual API keys
- Set a strong proxy API key in settings.apiKeys
- Run `docker compose up -d`
- Verify with `curl http://localhost:3429/health`
- Note: Docker named volume handles SQLite persistence automatically

**4. Option B: Direct Node.js Deployment**
- Install Node.js 20+ via NodeSource or nvm
- Install 429chain globally: `npm install -g 429chain`
- Initialize config: `429chain --init`, edit config/config.yaml
- Create a systemd service unit file at /etc/systemd/system/429chain.service:
  - User=the non-root user created earlier
  - WorkingDirectory=/home/{user}/429chain (or wherever config lives)
  - ExecStart with full path to 429chain binary or `node dist/index.mjs`
  - Environment=NODE_ENV=production
  - Restart=on-failure
  - RestartSec=5
- Enable and start: systemctl enable --now 429chain
- Check status: systemctl status 429chain, journalctl -u 429chain -f

**5. Reverse Proxy with Nginx**
- Install nginx (apt install nginx)
- Create /etc/nginx/sites-available/429chain with proxy_pass config:
  - proxy_pass http://127.0.0.1:3429
  - proxy_http_version 1.1
  - proxy_set_header Upgrade $http_upgrade (for potential WebSocket)
  - proxy_set_header Connection 'upgrade'
  - proxy_set_header Host $host
  - proxy_set_header X-Real-IP $remote_addr
  - proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for
  - proxy_set_header X-Forwarded-Proto $scheme
  - SSE-specific: proxy_buffering off, proxy_cache off, proxy_read_timeout 300s (for long-running streaming requests)
- Symlink to sites-enabled, remove default, test and reload nginx
- Update UFW: allow 'Nginx Full', optionally remove direct 3429 access

**6. HTTPS with Let's Encrypt**
- Install certbot: apt install certbot python3-certbot-nginx
- Obtain certificate: certbot --nginx -d yourdomain.com
- Verify auto-renewal: certbot renew --dry-run
- Note: certbot automatically configures nginx SSL blocks

**7. Firewall Rules**
- Summary of UFW rules for production:
  - Allow OpenSSH (22)
  - Allow Nginx Full (80, 443)
  - Deny everything else (port 3429 should NOT be open directly in production)
- Show ufw status numbered

**8. Updating 429chain**
- Docker method: git pull, docker compose build, docker compose up -d (zero-downtime with --force-recreate)
- Node.js method: npm install -g 429chain@latest, systemctl restart 429chain
- Note: SQLite data persists across updates (Docker: named volume, Node.js: data/ directory)

**9. Backup and Restore**
- Docker: backup command using --volumes-from (already documented in USAGE.md, include here for completeness)
- Node.js: simply copy the data/ directory
- Config: back up config/config.yaml (contains API keys — keep secure)

**10. Monitoring**
- Health check endpoint: curl https://yourdomain.com/health
- Simple cron-based health check script example (curl + notify on failure)
- Mention the web dashboard at https://yourdomain.com for visual monitoring
- journalctl -u 429chain -f for live logs (Node.js method)
- docker compose logs -f (Docker method)

**11. Troubleshooting**
- Port already in use: change PORT in .env or config
- Permission denied on data directory: check ownership matches running user
- Config not found: verify CONFIG_PATH or working directory
- Connection refused through nginx: check proxy_pass URL, verify 429chain is running on expected port
- SSE streaming not working through nginx: verify proxy_buffering off is set

**Style guidelines:**
- Use fenced code blocks for all commands
- Use comments in code blocks to explain each step
- Keep language direct and practical — no fluff
- Use the same tone as existing docs (USAGE.md)
- Do NOT use emojis
- Include the application name "429chain" consistently
- Show expected output where helpful (e.g., health check response)
  </action>
  <verify>
Verify the file exists and has substantive content:
- File exists at docs/DEPLOY-DIGITALOCEAN.md
- Contains all major sections: Prerequisites, Docker, Node.js, Nginx, HTTPS, Firewall, Updating, Backup, Monitoring, Troubleshooting
- All code blocks use proper fenced markdown syntax
- No placeholder text or TODO markers remain
  </verify>
  <done>
A complete, self-contained deployment guide exists at docs/DEPLOY-DIGITALOCEAN.md that a user can follow from a fresh Digital Ocean droplet to a production 429chain deployment with HTTPS, covering both Docker and direct Node.js methods.
  </done>
</task>

</tasks>

<verification>
- docs/DEPLOY-DIGITALOCEAN.md exists with 200+ lines of content
- All 11 sections are present and substantive
- Code examples are syntactically correct shell commands
- nginx config includes SSE-specific directives (proxy_buffering off)
- systemd service file is complete and correct
- No broken markdown formatting
</verification>

<success_criteria>
- A user with a fresh Digital Ocean droplet and this guide can deploy 429chain to production
- Both Docker and Node.js deployment paths are fully documented
- Production hardening (HTTPS, firewall, reverse proxy) is covered
- The guide is consistent in tone and quality with existing docs/USAGE.md
</success_criteria>

<output>
After completion, create `.planning/quick/12-write-a-document-outlining-how-to-deploy/12-SUMMARY.md`
</output>
