# Multiplayer Agar.io Style Game

A real-time multiplayer web-based game inspired by Agar.io, built with Node.js, Express, Socket.IO, and HTML5 Canvas.

## Features

- Real-time multiplayer gameplay using WebSockets
- Smooth HTML5 Canvas rendering with camera following player
- Collision detection for food and player interactions
- Dynamic player growth mechanics
- Docker containerization for easy deployment
- 60 FPS game loop for smooth gameplay

## Project Structure

```
agar/
├── node_modules/
├── public/
│   ├── index.html      # Main HTML page
│   ├── style.css       # Styling for fullscreen canvas
│   └── client.js       # Client-side game logic and rendering
├── instruct/           # Instruction files
├── package.json        # Node.js dependencies
├── package-lock.json
├── server.js           # Backend server and game logic
├── Dockerfile          # Docker configuration
├── .dockerignore       # Docker ignore file
└── README.md           # This file
```

## Prerequisites

- **Node.js** (v18 or higher)
- **npm** (comes with Node.js)
- **Docker** (optional, for containerized deployment)

## Installation & Running Locally

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Server

```bash
node server.js
```

The server will start on `http://localhost:3000`.

### 3. Play the Game

Open your web browser and navigate to:
```
http://localhost:3000
```

You can open multiple browser tabs or windows to test multiplayer functionality.

## Game Controls

- **Mouse Movement**: Move your mouse to control your player's direction
- **Objective**: Eat food (small colored circles) to grow larger
- **PvP**: Eat smaller players to grow even more (must be 10% larger)
- **Warning**: Larger players can eat you if you're smaller!

## Docker Deployment

### Build the Docker Image

```bash
docker build -t agar-game-image .
```

### Run the Docker Container

```bash
docker run -p 3000:3000 --name agar-game-container agar-game-image
```

The game will be accessible at `http://localhost:3000`.

### Stop the Container

```bash
docker stop agar-game-container
```

### Remove the Container

```bash
docker rm agar-game-container
```

### Run in Detached Mode (Background)

```bash
docker run -d -p 3000:3000 --name agar-game-container agar-game-image
```

## Linux Server Deployment

### 1. Provision a Linux Server

Get a VPS or cloud instance (e.g., AWS EC2, DigitalOcean, Google Cloud) running Ubuntu or similar.

### 2. Install Docker on the Server

```bash
sudo apt-get update
sudo apt-get install -y docker.io
sudo systemctl start docker
sudo systemctl enable docker
```

### 3. Transfer Project Files

Using `scp` or `git`:

```bash
# Using scp
scp -r agar/ user@your-server-ip:/path/to/destination/

# Or using git
git clone your-repo-url
cd agar
```

### 4. Build and Run on Server

```bash
docker build -t agar-game-image .
docker run -d -p 3000:3000 --name agar-game-container agar-game-image
```

### 5. Access the Game

Open browser to:
```
http://your-server-ip:3000
```

## Game Configuration

You can modify game parameters in `server.js`:

```javascript
const PORT = process.env.PORT || 3000;  // Server port
const MAP_WIDTH = 2000;                  // Map width
const MAP_HEIGHT = 2000;                 // Map height
const FOOD_COUNT = 150;                  // Number of food items
const PLAYER_START_RADIUS = 20;          // Starting player size
```

## Technical Details

### Backend (server.js)
- Express web server for serving static files
- Socket.IO for real-time bidirectional communication
- Game loop running at 60 FPS
- Collision detection for food and player interactions
- Player movement based on mouse position

### Frontend (public/)
- HTML5 Canvas for rendering
- Socket.IO client for server communication
- Camera following player with grid background
- Real-time rendering of players and food
- Responsive canvas sizing

## Troubleshooting

### Port Already in Use
If port 3000 is already in use, you can change it:

```bash
PORT=8080 node server.js
```

Or modify the `PORT` constant in `server.js`.

### Docker Container Won't Start
Check if the port is already bound:

```bash
docker ps -a
docker rm agar-game-container
docker run -p 3000:3000 --name agar-game-container agar-game-image
```

### Can't Connect from Other Devices
Make sure your firewall allows incoming connections on port 3000:

```bash
# Ubuntu/Debian
sudo ufw allow 3000

# CentOS/RHEL
sudo firewall-cmd --add-port=3000/tcp --permanent
sudo firewall-cmd --reload
```

## License

ISC

## Author

Created following the Agar.io clone tutorial for multiplayer game development.
