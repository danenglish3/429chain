# Deploying 429chain on Digital Ocean

This guide walks through deploying 429chain on a fresh Digital Ocean droplet. Two deployment methods are covered: Docker Compose (recommended) and direct Node.js with systemd.

By the end, you will have 429chain running in production behind nginx with HTTPS.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Initial Server Setup](#2-initial-server-setup)
3. [Option A: Docker Deployment (Recommended)](#3-option-a-docker-deployment-recommended)
4. [Option B: Direct Node.js Deployment](#4-option-b-direct-nodejs-deployment)
5. [Reverse Proxy with Nginx](#5-reverse-proxy-with-nginx)
6. [Firewall Rules](#6-firewall-rules)
7. [Updating 429chain](#7-updating-429chain)
8. [Backup and Restore](#8-backup-and-restore)
9. [Monitoring](#9-monitoring)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

**Digital Ocean account**
Sign up at [digitalocean.com](https://digitalocean.com). A credit card or PayPal is required.

**Droplet**
Create a new droplet with the following specifications:

- **Image:** Ubuntu 24.04 LTS
- **Size:** Minimum 1 GB RAM / 1 vCPU ($6/month Basic droplet). Use 2 GB RAM if you plan to run other services alongside 429chain.
- **Region:** Choose the region closest to your users
- **Authentication:** SSH key (recommended over password)

**Domain name**
A domain on Cloudflare pointing to your droplet's IP address. In Cloudflare DNS, add a proxied A record:

```
A  proxy.everydaychef.io  →  your-droplet-ip  (Proxied ☁️)
```

Cloudflare handles SSL termination — no certificates are needed on the server. Set the SSL/TLS mode to **Full** in Cloudflare (not "Full (strict)" since there's no origin cert).

**SSH access**
You should be able to connect to your droplet:

```bash
ssh root@your-droplet-ip
```

---

## 2. Initial Server Setup

SSH into your droplet as root and complete these steps before deploying.

### Update system packages

```bash
apt update && apt upgrade -y
```

### Create a non-root user

Running services as root is a security risk. Create a dedicated user:

```bash
# Create user (you will be prompted to set a password)
adduser deploy

# Grant sudo privileges
usermod -aG sudo deploy
```

Copy your SSH key to the new user so you can log in directly:

```bash
# While still logged in as root
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

From now on, use `ssh deploy@your-droplet-ip` to connect.

### Configure UFW firewall

UFW (Uncomplicated Firewall) is pre-installed on Ubuntu. Allow SSH before enabling:

```bash
ufw allow OpenSSH
ufw enable
# Output: Firewall is active and enabled on system startup
```

Verify the status:

```bash
ufw status
# Status: active
# To                         Action      From
# --                         ------      ----
# OpenSSH                    ALLOW       Anywhere
# OpenSSH (v6)               ALLOW       Anywhere (v6)
```

---

## 3. Option A: Docker Deployment (Recommended)

Docker Compose is the recommended deployment method. It handles SQLite persistence via a named volume, health checks, and automatic restarts.

### Install Docker Engine

Use the official Docker apt repository. Do not use the snap package — it has known permission issues with bind mounts.

```bash
# Install prerequisites
apt install -y ca-certificates curl

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Add the Docker apt repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine and the Compose plugin
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Verify the installation:

```bash
docker --version
# Docker version 27.x.x, build ...

docker compose version
# Docker Compose version v2.x.x
```

Add your deploy user to the docker group so they can run Docker without sudo:

```bash
usermod -aG docker deploy
# Log out and back in for the group change to take effect
```

### Set up the project

Clone the repository (or create the directory manually if deploying from a build):

```bash
cd /home/deploy
git clone https://github.com/danenglish3/429chain.git
cd 429chain
```

### Configure 429chain

Copy the example config and edit it with your API keys:

```bash
cp config/config.example.yaml config/config.yaml
nano config/config.yaml
```

At minimum, set a strong proxy API key and add your provider API keys:

```yaml
settings:
  port: 3429
  apiKeys:
    - "replace-with-a-strong-random-key"  # Clients use this to authenticate
  defaultChain: "default"

providers:
  - id: openrouter
    name: OpenRouter
    type: openrouter
    apiKey: "sk-or-v1-your-actual-key"

  - id: groq
    name: Groq
    type: groq
    apiKey: "gsk_your-actual-key"
    timeout: 10000
    rateLimits:
      requestsPerMinute: 30
      tokensPerMinute: 15000

chains:
  - name: default
    entries:
      - provider: openrouter
        model: "meta-llama/llama-3.1-8b-instruct:free"
      - provider: groq
        model: "llama-3.1-8b-instant"
```

Generate a strong API key with:

```bash
openssl rand -hex 32
```

### Start 429chain

```bash
docker compose up -d
```

Docker pulls the base image, builds the 429chain image, and starts the container in the background. The first build takes 1-3 minutes.

Verify it is running:

```bash
docker compose ps
# NAME              IMAGE           COMMAND                  SERVICE   CREATED         STATUS                   PORTS
# 429chain-proxy    429chain:latest "node dist/index.mjs"    proxy     2 minutes ago   Up 2 minutes (healthy)   0.0.0.0:3429->3429/tcp
```

Check the health endpoint:

```bash
curl http://localhost:3429/health
# {"status":"ok","version":"0.1.0","uptime":12.3,"providers":2,"chains":1}
```

### SQLite persistence

The Docker Compose file mounts a named volume at `/app/data` inside the container. This volume persists across container restarts and `docker compose down`. Your request logs and rate limit data are stored there.

```bash
# View the volume
docker volume ls | grep 429chain
# local     429chain_data
```

---

## 4. Option B: Direct Node.js Deployment

Use this method if you prefer not to run Docker, or if you are running 429chain alongside other Node.js services on the same server.

### Install Node.js 20+

Use NodeSource for the official Node.js 20.x LTS packages:

```bash
# Download and run the NodeSource setup script
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -

# Install Node.js
apt install -y nodejs

# Verify
node --version
# v20.x.x

npm --version
# 10.x.x
```

Alternatively, use nvm if you need to manage multiple Node.js versions:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

### Install 429chain

Install 429chain globally from npm:

```bash
npm install -g 429chain
```

Verify the installation:

```bash
429chain --help
```

### Set up the working directory

Create a directory for 429chain to store its config and data:

```bash
mkdir -p /home/deploy/429chain
cd /home/deploy/429chain
```

Initialize the config file:

```bash
429chain --init
# Created config/config.yaml
```

Edit the config with your API keys:

```bash
nano config/config.yaml
```

Set a strong proxy API key and add your provider API keys (same as the Docker config example above).

### Create a systemd service

Create a service unit file so 429chain starts automatically and restarts on failure:

```bash
nano /etc/systemd/system/429chain.service
```

Paste the following (replace `deploy` with your username if different):

```ini
[Unit]
Description=429chain LLM proxy
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/429chain
ExecStart=/usr/bin/429chain
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=5
# Increase file descriptor limit for concurrent connections
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

If you installed 429chain via nvm, the `ExecStart` path will differ. Find the correct path with `which 429chain` while logged in as the `deploy` user.

Enable and start the service:

```bash
# Reload systemd to pick up the new unit file
systemctl daemon-reload

# Enable the service to start on boot
systemctl enable 429chain

# Start the service now
systemctl start 429chain
```

Verify it is running:

```bash
systemctl status 429chain
# ● 429chain.service - 429chain LLM proxy
#      Loaded: loaded (/etc/systemd/system/429chain.service; enabled; preset: enabled)
#      Active: active (running) since ...
#    Main PID: 12345 (node)
#       Tasks: 11 (limit: 1137)
#      Memory: 45.2M
#         CPU: 234ms
#      CGroup: /system.slice/429chain.service
#              └─12345 node /usr/lib/node_modules/429chain/dist/cli.mjs
```

Check the health endpoint:

```bash
curl http://localhost:3429/health
# {"status":"ok","version":"0.1.0","uptime":8.1,"providers":2,"chains":1}
```

View live logs:

```bash
journalctl -u 429chain -f
```

---

## 5. Reverse Proxy with Nginx

Nginx sits in front of 429chain and handles incoming HTTP traffic. Cloudflare terminates SSL at the edge, so nginx only needs to listen on port 80.

If you are using the Docker deployment (Option A), nginx is included in `docker-compose.prod.yml` — skip to section 6.

For the Node.js deployment (Option B), install nginx on the host:

### Install nginx

```bash
apt install -y nginx
```

### Create the 429chain site configuration

```bash
nano /etc/nginx/sites-available/429chain
```

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name proxy.everydaychef.io;

    # Trust Cloudflare headers for real client IP
    set_real_ip_from 173.245.48.0/20;
    set_real_ip_from 103.21.244.0/22;
    set_real_ip_from 103.22.200.0/22;
    set_real_ip_from 103.31.4.0/22;
    set_real_ip_from 141.101.64.0/18;
    set_real_ip_from 108.162.192.0/18;
    set_real_ip_from 190.93.240.0/20;
    set_real_ip_from 188.114.96.0/20;
    set_real_ip_from 197.234.240.0/22;
    set_real_ip_from 198.41.128.0/17;
    set_real_ip_from 162.158.0.0/15;
    set_real_ip_from 104.16.0.0/13;
    set_real_ip_from 104.24.0.0/14;
    set_real_ip_from 172.64.0.0/13;
    set_real_ip_from 131.0.72.0/22;
    real_ip_header CF-Connecting-IP;

    # SSE and proxy settings
    location / {
        proxy_pass http://127.0.0.1:3429;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE streaming: disable buffering so chunks reach the client immediately
        proxy_buffering off;
        proxy_cache off;

        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

The `proxy_buffering off` directive is important. Without it, nginx buffers SSE responses and your clients will not receive streaming tokens in real time.

### Enable the site

```bash
ln -s /etc/nginx/sites-available/429chain /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

### Open the firewall for nginx

```bash
ufw allow 'Nginx HTTP'
```

Verify nginx is serving traffic:

```bash
curl http://localhost/health
# {"status":"ok","version":"0.1.0","uptime":120.5,"providers":2,"chains":1}
```

---

## 6. Firewall Rules

With nginx in place, port 3429 should not be directly accessible from the internet. Cloudflare connects to nginx on port 80, and nginx proxies to 429chain internally.

### Production UFW configuration

```bash
# Allow SSH (already set up in Step 2)
ufw allow OpenSSH

# Allow nginx HTTP (Cloudflare connects on port 80)
ufw allow 'Nginx HTTP'

# If port 3429 was previously opened directly, remove it
# ufw delete allow 3429

# Ensure UFW is active
ufw enable
```

Review the final rules:

```bash
ufw status numbered
# Status: active
#
#      To                         Action      From
#      --                         ------      ----
# [ 1] OpenSSH                    ALLOW IN    Anywhere
# [ 2] Nginx HTTP                 ALLOW IN    Anywhere
# [ 3] OpenSSH (v6)               ALLOW IN    Anywhere (v6)
# [ 4] Nginx HTTP (v6)            ALLOW IN    Anywhere (v6)
```

Port 3429 is not listed, which means it is only accessible from localhost (via nginx's `proxy_pass`). Port 443 is not needed since Cloudflare handles HTTPS.

---

## 7. Updating 429chain

### Docker method

Pull the latest code and rebuild the image:

```bash
cd /home/deploy/429chain

# Pull latest code
git pull

# Rebuild and restart with zero downtime
docker compose up -d --build --force-recreate
```

The `--force-recreate` flag replaces the running container with the new build. SQLite data persists in the named volume and is unaffected.

Check that the new version is running:

```bash
curl http://localhost:3429/health
# {"status":"ok","version":"0.2.0",...}
```

### Node.js method

```bash
# Install the latest version
npm install -g 429chain@latest

# Restart the service
systemctl restart 429chain

# Verify
systemctl status 429chain
```

SQLite data is stored in `/home/deploy/429chain/data/` and is not affected by updating the npm package.

### Config changes

After editing `config/config.yaml`, restart to apply changes:

```bash
# Docker
docker compose restart

# Node.js
systemctl restart 429chain
```

---

## 8. Backup and Restore

### Docker method

Back up the SQLite database from the named Docker volume:

```bash
# Create a compressed archive of the data volume
docker run --rm \
  --volumes-from 429chain-proxy \
  -v $(pwd):/backup \
  busybox tar cvf /backup/data-backup-$(date +%Y%m%d).tar /app/data
```

This creates a `data-backup-YYYYMMDD.tar` file in the current directory.

Restore from backup:

```bash
# Stop the container first
docker compose stop

# Restore the backup
docker run --rm \
  --volumes-from 429chain-proxy \
  -v $(pwd):/backup \
  busybox tar xvf /backup/data-backup-YYYYMMDD.tar

# Start the container
docker compose start
```

### Node.js method

The SQLite database is stored in `data/` relative to the working directory:

```bash
# Back up the data directory
cp -r /home/deploy/429chain/data /home/deploy/429chain-backup-$(date +%Y%m%d)

# Or create an archive
tar czf /home/deploy/data-backup-$(date +%Y%m%d).tar.gz -C /home/deploy/429chain data/
```

Restore by stopping the service, replacing the `data/` directory, and restarting:

```bash
systemctl stop 429chain
rm -rf /home/deploy/429chain/data
cp -r /home/deploy/429chain-backup-YYYYMMDD /home/deploy/429chain/data
systemctl start 429chain
```

### Config backup

Always back up `config/config.yaml`. It contains your provider API keys.

```bash
cp /home/deploy/429chain/config/config.yaml /home/deploy/config-backup-$(date +%Y%m%d).yaml
```

Store config backups securely — they contain API keys.

---

## 9. Monitoring

### Health check endpoint

The `/health` endpoint returns the proxy status and is safe to poll without authentication:

```bash
curl https://proxy.everydaychef.io/health
# {"status":"ok","version":"0.1.0","uptime":86400.0,"providers":3,"chains":2}
```

### Automated health check

Set up a cron job to alert you if 429chain goes down. Create a monitoring script:

```bash
nano /home/deploy/check-429chain.sh
```

```bash
#!/bin/bash
HEALTH_URL="https://proxy.everydaychef.io/health"
NOTIFY_EMAIL="you@example.com"

RESPONSE=$(curl -sf --max-time 5 "$HEALTH_URL" 2>/dev/null)
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo "429chain health check FAILED at $(date)" | mail -s "429chain DOWN" "$NOTIFY_EMAIL"
fi
```

```bash
chmod +x /home/deploy/check-429chain.sh
```

Add to crontab (runs every 5 minutes):

```bash
crontab -e
# Add this line:
*/5 * * * * /home/deploy/check-429chain.sh
```

Note: the `mail` command requires a mail transfer agent. For simple alerting without email, consider writing a failure flag file and checking it, or use a third-party uptime monitoring service.

### Web dashboard

429chain includes a built-in web dashboard for visual monitoring. Access it at:

```
https://proxy.everydaychef.io
```

The dashboard provides:
- Live rate limit status for all providers
- Request log with per-request details
- Usage statistics by provider and chain
- Chain testing interface to verify provider connectivity

### Logs

**Docker method:**
```bash
# Follow live logs
docker compose logs -f

# Show last 100 lines
docker compose logs --tail=100
```

**Node.js method:**
```bash
# Follow live logs
journalctl -u 429chain -f

# Show logs from the last hour
journalctl -u 429chain --since "1 hour ago"

# Show only errors
journalctl -u 429chain -p err
```

---

## 10. Troubleshooting

### Port already in use

If 429chain fails to start because port 3429 is in use:

```bash
# Find what is using port 3429
ss -tlnp | grep 3429

# Or
lsof -i :3429
```

Change the port in `config/config.yaml`:

```yaml
settings:
  port: 3430  # Use a different port
```

Update the nginx `proxy_pass` to match:

```nginx
proxy_pass http://127.0.0.1:3430;
```

### Permission denied on data directory

If 429chain cannot write to the data directory (Node.js method):

```bash
# Check ownership
ls -la /home/deploy/429chain/

# Fix ownership (replace 'deploy' with your service user)
chown -R deploy:deploy /home/deploy/429chain/data
```

For Docker, this is handled automatically — the container runs as the `node` user which owns `/app/data`.

### Config not found

If 429chain reports it cannot find the config file:

```bash
# Check if the file exists
ls -la /home/deploy/429chain/config/config.yaml

# The config must exist before starting — copy from the example
cp /home/deploy/429chain/config/config.example.yaml /home/deploy/429chain/config/config.yaml
```

You can also specify the config path explicitly:

```bash
429chain --config /path/to/config.yaml
```

For Docker, verify the bind mount in `docker-compose.yml`:

```yaml
volumes:
  - ./config/config.yaml:/app/config/config.yaml
```

The file must exist on the host before running `docker compose up`.

### Connection refused through nginx

If requests to nginx return a `502 Bad Gateway` error:

```bash
# Verify 429chain is running and listening
curl http://localhost:3429/health

# Check nginx error logs
tail -50 /var/log/nginx/error.log

# Verify the proxy_pass address matches where 429chain is listening
grep proxy_pass /etc/nginx/sites-available/429chain
```

If 429chain is not running, start it:

```bash
# Docker
docker compose up -d

# Node.js
systemctl start 429chain
```

### SSE streaming not working through nginx

If streaming responses are not being delivered in real time (tokens arrive all at once at the end), verify the nginx config includes:

```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 300s;
```

Test nginx config and reload:

```bash
nginx -t && systemctl reload nginx
```

### Viewing the container logs (Docker)

If `docker compose ps` shows the container as unhealthy:

```bash
# View logs for the proxy service
docker compose logs proxy

# Follow logs in real time
docker compose logs -f proxy

# View the last 50 lines
docker compose logs --tail=50 proxy
```

