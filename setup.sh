#!/bin/bash

##############################################
# Agar Chungus - VM Deployment Script
# This script sets up the game on a fresh VM
##############################################

set -e  # Exit on error

echo "=========================================="
echo "  Agar Chungus - Deployment Script"
echo "=========================================="
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}→ $1${NC}"
}

# Function to wait for dpkg lock to be released
wait_for_apt() {
    local i=0
    while sudo fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 ; do
        if [ $i -eq 0 ]; then
            print_info "Waiting for other software managers to finish..."
        fi
        sleep 1
        i=$((i+1))
        if [ $i -gt 300 ]; then
            print_error "Timeout waiting for package manager lock. Please try again later."
            exit 1
        fi
    done
    if [ $i -gt 0 ]; then
        print_success "Package manager is now available"
    fi
}

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    print_error "Please do not run this script as root. Run as a normal user with sudo privileges."
    exit 1
fi

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "Working directory: $SCRIPT_DIR"
echo ""

# Step 1: Update system packages
print_info "Updating system packages..."
wait_for_apt
sudo apt-get update -y
print_success "System packages updated"
echo ""

# Step 2: Install Node.js if not present
if ! command -v node &> /dev/null; then
    print_info "Node.js not found. Installing Node.js 20.x LTS..."
    wait_for_apt
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    wait_for_apt
    sudo apt-get install -y nodejs
    print_success "Node.js installed: $(node --version)"
else
    print_success "Node.js already installed: $(node --version)"
fi
echo ""

# Step 3: Install npm dependencies
print_info "Installing npm dependencies..."
npm install
print_success "Dependencies installed"
echo ""

# Step 4: Ask about PM2 installation
echo "=========================================="
echo "  Production Setup (Optional)"
echo "=========================================="
echo ""

read -p "Do you want to install PM2 for production deployment? (y/n): " REPLY
echo ""

if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
    # Install PM2 globally
    print_info "Installing PM2..."
    sudo npm install -g pm2
    print_success "PM2 installed"

    # Start the application with PM2
    print_info "Starting application with PM2..."
    pm2 delete agar 2>/dev/null || true  # Delete existing process if any
    pm2 start server.js --name agar
    pm2 save

    # Setup PM2 startup script
    print_info "Setting up PM2 to start on boot..."
    sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME

    print_success "Application running with PM2"
    echo ""
    echo "PM2 Commands:"
    echo "  pm2 status        - View application status"
    echo "  pm2 logs agar     - View application logs"
    echo "  pm2 restart agar  - Restart application"
    echo "  pm2 stop agar     - Stop application"
    echo ""
else
    print_info "Skipping PM2 installation"
fi
echo ""

# Step 5: Ask about Nginx setup
read -p "Do you want to install and configure Nginx as a reverse proxy? (y/n): " REPLY
echo ""

if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
    # Install Nginx
    print_info "Installing Nginx..."
    wait_for_apt
    sudo apt-get install -y nginx

    # Get server IP or domain
    read -p "Enter your domain name or server IP: " SERVER_NAME

    # Create Nginx configuration
    print_info "Creating Nginx configuration..."
    sudo tee /etc/nginx/sites-available/agar > /dev/null <<EOF
server {
    listen 80;
    server_name $SERVER_NAME;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF

    # Enable the site
    sudo ln -sf /etc/nginx/sites-available/agar /etc/nginx/sites-enabled/

    # Test Nginx configuration
    sudo nginx -t

    # Restart Nginx
    sudo systemctl restart nginx
    sudo systemctl enable nginx

    print_success "Nginx configured and running"
    echo ""
    echo "Your game is now accessible at: http://$SERVER_NAME"
    echo ""
else
    print_info "Skipping Nginx installation"
    echo ""
    echo "Your game will be accessible at: http://YOUR_SERVER_IP:3000"
    echo ""
fi

# Step 6: Configure firewall
read -p "Do you want to configure UFW firewall? (y/n): " REPLY
echo ""

if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
    print_info "Configuring UFW firewall..."
    wait_for_apt
    sudo apt-get install -y ufw
    sudo ufw allow ssh
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    sudo ufw allow 3000/tcp
    sudo ufw --force enable
    print_success "Firewall configured"
    echo ""
else
    print_info "Skipping firewall configuration"
    echo ""
fi

# Final summary
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
print_success "Agar Chungus is now set up!"
echo ""
echo "Next steps:"
echo "  1. If you didn't use PM2, start the server manually:"
echo "     npm start"
echo ""
echo "  2. Access your game:"
if [ -n "$SERVER_NAME" ]; then
    echo "     http://$SERVER_NAME"
else
    echo "     http://YOUR_SERVER_IP:3000"
fi
echo ""
echo "  3. Optional - Set up SSL with Let's Encrypt:"
echo "     sudo apt-get install certbot python3-certbot-nginx"
echo "     sudo certbot --nginx -d YOUR_DOMAIN"
echo ""
echo "Game Controls:"
echo "  • Mouse: Move your blob"
echo "  • Space: Split into smaller blobs"
echo "  • W: Eject mass"
echo ""
print_success "Happy gaming!"
echo ""
