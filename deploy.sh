#!/bin/bash

##############################################
# Agar Chungus - Quick Deploy Script
# Run this from your LOCAL machine to update the server
##############################################

# CONFIGURATION - Edit these values
SERVER_USER="your-username"
SERVER_IP="your-server-ip"
SERVER_PATH="~/agar"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=========================================="
echo -e "  Agar Chungus - Deploy Script"
echo -e "==========================================${NC}"
echo ""

# Check if configuration is set
if [ "$SERVER_USER" = "your-username" ] || [ "$SERVER_IP" = "your-server-ip" ]; then
    echo -e "${RED}✗ Error: Please edit deploy.sh and set SERVER_USER and SERVER_IP${NC}"
    echo ""
    echo "Edit lines 9-10 in deploy.sh:"
    echo "  SERVER_USER=\"your-actual-username\""
    echo "  SERVER_IP=\"your-actual-server-ip\""
    exit 1
fi

# Confirm deployment
echo -e "${YELLOW}Deploying to: ${SERVER_USER}@${SERVER_IP}${NC}"
echo ""
read -p "Continue? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Deployment cancelled."
    exit 0
fi
echo ""

# Check if rsync is available
if ! command -v rsync &> /dev/null; then
    echo -e "${YELLOW}⚠ rsync not found, using scp instead (slower)${NC}"
    USE_SCP=true
else
    USE_SCP=false
fi

echo -e "${GREEN}📦 Uploading files...${NC}"
if [ "$USE_SCP" = true ]; then
    # Use SCP if rsync not available
    scp -r ./* $SERVER_USER@$SERVER_IP:$SERVER_PATH/
else
    # Use rsync (faster, only uploads changed files)
    rsync -avz --progress \
        --exclude 'node_modules' \
        --exclude '.git' \
        --exclude 'instruct' \
        --exclude '*.md' \
        ./ $SERVER_USER@$SERVER_IP:$SERVER_PATH/
fi

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ File upload failed${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Files uploaded successfully${NC}"
echo ""

# Run deployment commands on server
echo -e "${GREEN}🔧 Installing dependencies and restarting...${NC}"
ssh $SERVER_USER@$SERVER_IP << 'ENDSSH'
cd ~/agar

# Install dependencies
echo "Installing dependencies..."
npm install --production

# Check if PM2 is installed and being used
if command -v pm2 &> /dev/null && pm2 list | grep -q "agar"; then
    echo "Restarting with PM2..."
    pm2 restart agar
    echo ""
    pm2 status
else
    echo "PM2 not detected. Please restart manually:"
    echo "  pkill node"
    echo "  npm start &"
fi
ENDSSH

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Deployment commands failed${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}=========================================="
echo -e "  ✅ Deployment Complete!"
echo -e "==========================================${NC}"
echo ""
echo -e "Your game has been updated on the server."
echo -e "Access it at: ${BLUE}http://${SERVER_IP}${NC}"
echo ""
