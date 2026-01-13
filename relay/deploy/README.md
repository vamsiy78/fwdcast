# Deploying fwdcast Relay to GCP e2-micro

## Quick Start

### 1. Copy files to your VM

```bash
# From your local machine, in the fwdcast directory
gcloud compute scp --recurse relay YOUR_VM_NAME:~/fwdcast-relay --zone=YOUR_ZONE
gcloud compute scp relay/deploy/setup.sh YOUR_VM_NAME:~ --zone=YOUR_ZONE
```

### 2. SSH and run setup

```bash
gcloud compute ssh YOUR_VM_NAME --zone=YOUR_ZONE

# On the VM:
chmod +x setup.sh
./setup.sh
```

The script will:
- Install Go
- Build the relay server
- Create a systemd service
- (Optional) Set up HTTPS with Caddy if you provide a domain

### 3. Open firewall

```bash
# From your local machine
gcloud compute firewall-rules create allow-fwdcast \
  --allow tcp:8080,tcp:80,tcp:443 \
  --target-tags=fwdcast \
  --description="Allow fwdcast relay traffic"

gcloud compute instances add-tags YOUR_VM_NAME \
  --zone=YOUR_ZONE \
  --tags=fwdcast
```

### 4. Use it

```bash
fwdcast . --relay ws://YOUR_VM_IP:8080/ws

# Or with HTTPS:
fwdcast . --relay wss://your-domain.com/ws
```

## Manual Setup

If you prefer to set things up manually:

### Build

```bash
sudo apt-get update
sudo apt-get install -y golang-go

cd ~/fwdcast-relay
go build -o fwdcast-relay .
```

### Run

```bash
# Get your external IP
EXTERNAL_IP=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)

# Run
RELAY_HOST=$EXTERNAL_IP:8080 ./fwdcast-relay
```

### Run as Service

Create `/etc/systemd/system/fwdcast-relay.service`:

```ini
[Unit]
Description=fwdcast Relay Server
After=network.target

[Service]
Type=simple
Environment=RELAY_HOST=YOUR_IP:8080
ExecStart=/home/YOUR_USER/fwdcast-relay/fwdcast-relay
Restart=always

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable fwdcast-relay
sudo systemctl start fwdcast-relay
```

## Adding HTTPS

### Option 1: Caddy (recommended)

```bash
sudo apt-get install -y caddy

# Edit /etc/caddy/Caddyfile:
your-domain.com {
    reverse_proxy localhost:8080
}

sudo systemctl restart caddy
```

Caddy automatically obtains and renews SSL certificates.

### Option 2: nginx + certbot

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Configure nginx
sudo tee /etc/nginx/sites-available/fwdcast <<EOF
server {
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/fwdcast /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com
```

## Monitoring

```bash
# Check status
sudo systemctl status fwdcast-relay

# View logs
sudo journalctl -u fwdcast-relay -f

# Check memory usage (should be ~10-20MB)
ps aux | grep fwdcast
```

## Resource Usage

The relay server is designed for e2-micro (1 vCPU, 1GB RAM):

- Memory: ~10-20 MB base
- CPU: Minimal (just forwarding bytes)
- Disk: ~10 MB for binary
- Network: Depends on usage

## Troubleshooting

### Connection refused

1. Check service is running: `sudo systemctl status fwdcast-relay`
2. Check firewall: `gcloud compute firewall-rules list`
3. Check port is listening: `sudo netstat -tlnp | grep 8080`

### WebSocket upgrade failed

If using a reverse proxy, ensure WebSocket headers are forwarded:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

### Session URLs not working

Check `RELAY_HOST` is set correctly to your public IP/domain:

```bash
sudo systemctl show fwdcast-relay | grep Environment
```
