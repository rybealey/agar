# Agar Chungus - Deployment Guide

This guide will help you deploy Agar Chungus on a virtual machine (VM).

## Quick Start

### 1. Upload Files to Your VM

Transfer all game files to your VM using one of these methods:

**Option A: Using SCP**
```bash
# On your local machine
scp -r /path/to/agar username@your-server-ip:/home/username/
```

**Option B: Using Git**
```bash
# On your VM
git clone <your-repository-url>
cd agar
```

**Option C: Using SFTP**
Use an FTP client like FileZilla to upload the files.

### 2. Run the Setup Script

```bash
# SSH into your VM
ssh username@your-server-ip

# Navigate to the project directory
cd agar

# Make the script executable (if not already)
chmod +x setup.sh

# Run the setup script
./setup.sh
```

The script will guide you through:
- Installing Node.js
- Installing dependencies
- Setting up PM2 for production (optional)
- Configuring Nginx reverse proxy (optional)
- Setting up firewall rules (optional)

### 3. Access Your Game

- **With Nginx**: `http://your-domain.com` or `http://your-server-ip`
- **Without Nginx**: `http://your-server-ip:3000`

## Manual Setup

If you prefer to set up manually without the script:

### Prerequisites

1. **Ubuntu/Debian VM** (18.04 LTS or newer recommended)
2. **Sudo privileges**
3. **Node.js 16+ and npm**

### Installation Steps

#### 1. Install Node.js

```bash
# Install Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

#### 2. Install Dependencies

```bash
cd /path/to/agar
npm install
```

#### 3. Start the Server

**Option A: Simple Start (Development)**
```bash
npm start
# or
node server.js
```

**Option B: Production with PM2**
```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the application
pm2 start server.js --name agar

# Save PM2 process list
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the command it provides

# View logs
pm2 logs agar

# Other PM2 commands
pm2 status        # Check status
pm2 restart agar  # Restart app
pm2 stop agar     # Stop app
```

#### 4. Configure Nginx (Optional)

```bash
# Install Nginx
sudo apt-get install -y nginx

# Create Nginx configuration
sudo nano /etc/nginx/sites-available/agar
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/agar /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
```

#### 5. Configure Firewall

```bash
# Install UFW if not already installed
sudo apt-get install -y ufw

# Allow SSH (IMPORTANT!)
sudo ufw allow ssh

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow Node.js port (if not using Nginx)
sudo ufw allow 3000/tcp

# Enable firewall
sudo ufw enable
```

## SSL Certificate (HTTPS)

For production, you should use HTTPS:

```bash
# Install Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Get SSL certificate (with Nginx)
sudo certbot --nginx -d your-domain.com

# Auto-renewal is set up automatically
# Test renewal with:
sudo certbot renew --dry-run
```

## Environment Variables

To change the port, create a `.env` file or set environment variables:

```bash
# In your VM
export PORT=3000
npm start
```

Or modify `server.js` directly:
```javascript
const PORT = process.env.PORT || 3000;
```

## Monitoring and Maintenance

### Check Application Status

```bash
# If using PM2
pm2 status
pm2 logs agar --lines 100

# Check Node.js process
ps aux | grep node

# Check port usage
sudo lsof -i :3000
```

### Restart Application

```bash
# PM2
pm2 restart agar

# Manual
# Find the process ID
ps aux | grep node
# Kill and restart
sudo kill <PID>
npm start
```

### View Logs

```bash
# PM2 logs
pm2 logs agar

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

## Troubleshooting

### Port Already in Use

```bash
# Find what's using port 3000
sudo lsof -i :3000

# Kill the process
sudo kill <PID>
```

### Cannot Connect to Game

1. Check if the server is running:
   ```bash
   pm2 status
   # or
   ps aux | grep node
   ```

2. Check firewall rules:
   ```bash
   sudo ufw status
   ```

3. Check if port is listening:
   ```bash
   sudo netstat -tulpn | grep 3000
   ```

4. Check Nginx status (if using):
   ```bash
   sudo systemctl status nginx
   ```

### WebSocket Connection Issues

Make sure your Nginx configuration includes:
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection 'upgrade';
```

## Performance Optimization

### For Large Player Counts

1. **Increase Node.js memory limit:**
   ```bash
   pm2 start server.js --name agar --node-args="--max-old-space-size=4096"
   ```

2. **Enable Nginx caching** for static files

3. **Use a CDN** for static assets

4. **Consider clustering:**
   - Modify `server.js` to use Node.js cluster module
   - Or use PM2 cluster mode: `pm2 start server.js -i max`

## Game Configuration

You can modify game parameters in `server.js`:

```javascript
const MAP_WIDTH = 2000;      // Map width
const MAP_HEIGHT = 2000;     // Map height
const FOOD_COUNT = 150;      // Number of food pellets
const PLAYER_START_RADIUS = 20;  // Starting size
```

## Updating the Game

```bash
# Pull latest changes (if using git)
git pull

# Install any new dependencies
npm install

# Restart the application
pm2 restart agar
```

## Security Recommendations

1. **Keep system updated:**
   ```bash
   sudo apt-get update && sudo apt-get upgrade
   ```

2. **Use SSH keys** instead of passwords

3. **Change default SSH port** (optional)

4. **Set up fail2ban** to prevent brute force attacks:
   ```bash
   sudo apt-get install fail2ban
   ```

5. **Use HTTPS** with Let's Encrypt

6. **Regular backups** of your server

## Support

For issues or questions:
- Check the troubleshooting section above
- Review logs: `pm2 logs agar`
- Check server resources: `htop` or `top`

## Game Controls

- **Mouse**: Move your blob
- **Spacebar**: Split into smaller blobs
- **W**: Eject mass

Enjoy your game!
