#!/bin/bash
#
# fwdcast Relay Server Setup Script for GCP e2-micro
# 
# Usage:
#   1. Copy this script to your VM: gcloud compute scp setup.sh YOUR_VM:~
#   2. SSH into VM: gcloud compute ssh YOUR_VM
#   3. Run: chmod +x setup.sh && ./setup.sh
#

set -e

echo "=========================================="
echo "  fwdcast Relay Server Setup"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get external IP
EXTERNAL_IP=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null || echo "")

if [ -z "$EXTERNAL_IP" ]; then
    echo -e "${YELLOW}Could not auto-detect external IP.${NC}"
    read -p "Enter your VM's external IP: " EXTERNAL_IP
fi

echo -e "External IP: ${GREEN}$EXTERNAL_IP${NC}"
echo ""

# Ask for domain (optional)
read -p "Do you have a domain to use? (leave blank for IP only): " DOMAIN

if [ -n "$DOMAIN" ]; then
    RELAY_HOST="$DOMAIN"
    PUBLIC_BASE_URL="https://$DOMAIN"
    USE_HTTPS=true
    echo -e "Domain: ${GREEN}$DOMAIN${NC}"
else
    RELAY_HOST="$EXTERNAL_IP:8080"
    PUBLIC_BASE_URL="http://$EXTERNAL_IP:8080"
    USE_HTTPS=false
fi

echo ""
echo "Installing dependencies..."
echo ""

# Update system
sudo apt-get update -qq

# Install Go
if ! command -v go &> /dev/null; then
    echo "Installing Go..."
    sudo apt-get install -y golang-go
else
    echo "Go already installed: $(go version)"
fi

# Install Git
if ! command -v git &> /dev/null; then
    echo "Installing Git..."
    sudo apt-get install -y git
else
    echo "Git already installed"
fi

# Create app directory
APP_DIR="/opt/fwdcast"
sudo mkdir -p $APP_DIR
sudo chown $USER:$USER $APP_DIR

echo ""
echo "Building relay server..."
echo ""

# Copy relay source or clone
if [ -d "./relay" ]; then
    cp -r ./relay/* $APP_DIR/
elif [ -d "../relay" ]; then
    cp -r ../relay/* $APP_DIR/
else
    echo "Relay source not found locally."
    read -p "Enter git repo URL (or press Enter to skip): " REPO_URL
    if [ -n "$REPO_URL" ]; then
        git clone $REPO_URL /tmp/fwdcast-repo
        cp -r /tmp/fwdcast-repo/relay/* $APP_DIR/
        rm -rf /tmp/fwdcast-repo
    else
        echo -e "${RED}No source available. Please copy relay/ folder to this directory and re-run.${NC}"
        exit 1
    fi
fi

# Build
cd $APP_DIR
go build -ldflags="-s -w" -o fwdcast-relay .

echo -e "${GREEN}Build complete!${NC}"

# Create systemd service
echo ""
echo "Creating systemd service..."
echo ""

sudo tee /etc/systemd/system/fwdcast-relay.service > /dev/null <<EOF
[Unit]
Description=fwdcast Relay Server
After=network.target

[Service]
Type=simple
User=$USER
Environment=RELAY_HOST=$RELAY_HOST
Environment=PUBLIC_BASE_URL=$PUBLIC_BASE_URL
ExecStart=$APP_DIR/fwdcast-relay
Restart=always
RestartSec=5

# Logging
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF

# Reload and start service
sudo systemctl daemon-reload
sudo systemctl enable fwdcast-relay
sudo systemctl start fwdcast-relay

echo -e "${GREEN}Service started!${NC}"

# Setup HTTPS with Caddy if domain provided
if [ "$USE_HTTPS" = true ]; then
    echo ""
    echo "Setting up HTTPS with Caddy..."
    echo ""
    
    # Install Caddy
    sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
    sudo apt-get update -qq
    sudo apt-get install -y caddy
    
    # Configure Caddy
    sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
$DOMAIN {
    reverse_proxy localhost:8080
}
EOF
    
    sudo systemctl restart caddy
    
    echo -e "${GREEN}HTTPS configured!${NC}"
    
    WS_URL="wss://$DOMAIN/ws"
    PUBLIC_URL="https://$DOMAIN"
else
    WS_URL="ws://$EXTERNAL_IP:8080/ws"
    PUBLIC_URL="http://$EXTERNAL_IP:8080"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}  Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "Relay server is running at: $PUBLIC_URL"
echo ""
echo "To use fwdcast with this relay:"
echo ""
echo -e "  ${YELLOW}fwdcast . --relay $WS_URL${NC}"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status fwdcast-relay   # Check status"
echo "  sudo journalctl -u fwdcast-relay -f   # View logs"
echo "  sudo systemctl restart fwdcast-relay  # Restart"
echo ""

# Verify it's running
sleep 2
if sudo systemctl is-active --quiet fwdcast-relay; then
    echo -e "${GREEN}✓ Service is running${NC}"
else
    echo -e "${RED}✗ Service failed to start. Check logs with: sudo journalctl -u fwdcast-relay${NC}"
fi



