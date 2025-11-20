# Updating Your Deployed Game

This guide covers how to update your game files on the server after making changes locally.

## Method 1: Git (Recommended)

This is the easiest and cleanest method if you're using version control.

### Initial Setup (One-Time)

On your local machine, push your code to a Git repository (GitHub, GitLab, etc.):

```bash
# Initialize git repo (if not already done)
cd /path/to/agar
git init
git add .
git commit -m "Initial commit"

# Add remote repository
git remote add origin https://github.com/yourusername/agar-game.git
git branch -M main
git push -u origin main
```

On your server, clone the repository instead of uploading files:

```bash
# First time only
cd ~
git clone https://github.com/yourusername/agar-game.git
cd agar-game
bash setup.sh
```

### Updating (Every Time)

**On your local machine:**
```bash
# Make your changes, then commit
git add .
git commit -m "Description of changes"
git push
```

**On your server:**
```bash
# Pull latest changes
cd ~/agar-game
git pull

# Install any new dependencies
npm install

# Restart the application
pm2 restart agar

# Or if not using PM2:
# pkill node
# npm start
```

---

## Method 2: SCP (Secure Copy)

Use this if you're not using Git. Updates specific files or the entire directory.

### Update Specific Files

```bash
# From your local machine:
scp /path/to/agar/server.js username@your-server-ip:~/agar/
scp /path/to/agar/public/client.js username@your-server-ip:~/agar/public/

# Then SSH in and restart:
ssh username@your-server-ip
pm2 restart agar
```

### Update Entire Directory

```bash
# From your local machine:
scp -r /path/to/agar/* username@your-server-ip:~/agar/

# Then SSH in and restart:
ssh username@your-server-ip
cd ~/agar
npm install
pm2 restart agar
```

---

## Method 3: Rsync (Most Efficient)

Rsync only transfers changed files, making it faster than SCP for large projects.

```bash
# From your local machine:
rsync -avz --exclude 'node_modules' --exclude '.git' \
  /path/to/agar/ username@your-server-ip:~/agar/

# Then SSH in and restart:
ssh username@your-server-ip
cd ~/agar
npm install
pm2 restart agar
```

**Rsync flags explained:**
- `-a`: Archive mode (preserves permissions, timestamps)
- `-v`: Verbose (shows what's being transferred)
- `-z`: Compress during transfer
- `--exclude`: Skip these directories

---

## Method 4: Using a Deploy Script (Automated)

Create a local script to automate the update process.

Create `deploy.sh` in your local project:

```bash
#!/bin/bash

SERVER_USER="username"
SERVER_IP="your-server-ip"
SERVER_PATH="~/agar"

echo "📦 Deploying to $SERVER_IP..."

# Upload files using rsync
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'instruct' \
  ./ $SERVER_USER@$SERVER_IP:$SERVER_PATH/

# Run commands on server
ssh $SERVER_USER@$SERVER_IP << 'EOF'
cd ~/agar
echo "📦 Installing dependencies..."
npm install --production
echo "🔄 Restarting application..."
pm2 restart agar
echo "✅ Deployment complete!"
pm2 status
EOF

echo "✅ Done! Your game is updated."
```

Make it executable and use it:

```bash
chmod +x deploy.sh
./deploy.sh
```

---

## Quick Update Commands Cheat Sheet

### Using PM2 (Production)

```bash
# Restart application
pm2 restart agar

# View logs
pm2 logs agar

# Check status
pm2 status

# Stop application
pm2 stop agar

# Start application
pm2 start agar
```

### Without PM2

```bash
# Find and kill Node process
ps aux | grep node
kill <PID>

# Or kill all node processes
pkill node

# Start server
cd ~/agar
npm start &
```

### After Updating Code

```bash
# Always run after updating files:
cd ~/agar
npm install              # Install new dependencies
pm2 restart agar         # Restart the app
```

---

## Common Update Scenarios

### 1. Changed Game Mechanics (server.js)

```bash
# Local: Push changes
git push

# Server: Pull and restart
ssh username@your-server-ip
cd ~/agar
git pull
pm2 restart agar
```

### 2. Updated Client UI (public/ files)

```bash
# Local: Push changes
git push

# Server: Pull (no restart needed if using nginx for static files)
ssh username@your-server-ip
cd ~/agar
git pull
# Changes will be reflected immediately for new page loads
```

### 3. Added New NPM Packages

```bash
# Local: Push changes including package.json
git push

# Server: Pull, install, restart
ssh username@your-server-ip
cd ~/agar
git pull
npm install
pm2 restart agar
```

### 4. Changed Configuration (ports, settings)

```bash
# Local: Push changes
git push

# Server: Pull and restart
ssh username@your-server-ip
cd ~/agar
git pull
pm2 restart agar
```

---

## Rollback to Previous Version

If an update breaks something:

### Using Git

```bash
# On server:
cd ~/agar
git log --oneline          # See recent commits
git checkout <commit-hash> # Go back to working version
pm2 restart agar
```

### Manual Backup Method

Before updating, create a backup:

```bash
# On server:
cd ~
cp -r agar agar-backup-$(date +%Y%m%d)

# If update breaks, restore:
rm -rf agar
cp -r agar-backup-20250120 agar
pm2 restart agar
```

---

## Automated Updates with GitHub Webhooks (Advanced)

For automatic deployment when you push to GitHub:

1. Install webhook handler on server:
```bash
npm install -g webhook
```

2. Create webhook script `/home/username/update-agar.sh`:
```bash
#!/bin/bash
cd /home/username/agar
git pull
npm install
pm2 restart agar
```

3. Configure webhook to trigger on push events

---

## Best Practices

1. **Test locally first**: Always test changes on your local machine before deploying
2. **Use version control**: Git makes updates safer and easier to rollback
3. **Backup before major updates**: Create a backup before significant changes
4. **Check logs after updates**: Run `pm2 logs agar` to ensure no errors
5. **Update during low traffic**: Deploy during times when fewer players are online
6. **Keep dependencies updated**: Run `npm update` occasionally to update packages

---

## Troubleshooting Updates

### Update doesn't seem to take effect

```bash
# Hard restart PM2
pm2 delete agar
pm2 start server.js --name agar
pm2 save

# Clear browser cache on client side
# Press Ctrl+Shift+R or Cmd+Shift+R
```

### Git pull fails with conflicts

```bash
# Stash local changes and pull
git stash
git pull
git stash pop

# Or force pull (careful - overwrites local changes)
git fetch --all
git reset --hard origin/main
```

### New dependencies not working

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
pm2 restart agar
```

---

## Quick SSH Aliases (Optional)

Add to your local `~/.ssh/config`:

```
Host agar-server
    HostName your-server-ip
    User username
    IdentityFile ~/.ssh/id_rsa
```

Then you can use:
```bash
ssh agar-server
scp file.js agar-server:~/agar/
```

Much shorter than typing the full address each time!
