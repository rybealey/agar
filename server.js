const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;
const FOOD_COUNT = 150;
const PLAYER_START_RADIUS = 20;

let players = {};
let food = [];
let pellets = [];
let pelletIdCounter = 0;

// --- Game Helper Functions ---
function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function getRandomPosition(radius) {
    return {
        x: Math.floor(Math.random() * (MAP_WIDTH - radius * 2) + radius),
        y: Math.floor(Math.random() * (MAP_HEIGHT - radius * 2) + radius),
    };
}

function getNewRadius(oldRadius, eatenRadius) {
    const oldArea = Math.PI * oldRadius * oldRadius;
    const eatenArea = Math.PI * eatenRadius * eatenRadius;
    const newArea = oldArea + eatenArea;
    return Math.sqrt(newArea / Math.PI);
}

function getRadiusAfterEjection(currentRadius, massPercent) {
    const currentArea = Math.PI * currentRadius * currentRadius;
    const newArea = currentArea * (1 - massPercent);
    return Math.sqrt(newArea / Math.PI);
}

function getEjectedPelletRadius(currentRadius, massPercent) {
    const currentArea = Math.PI * currentRadius * currentRadius;
    const pelletArea = currentArea * massPercent;
    return Math.sqrt(pelletArea / Math.PI);
}

// --- Game Initialization ---
function initFood() {
    for (let i = 0; i < FOOD_COUNT; i++) {
        food.push({
            id: `f${i}`,
            ...getRandomPosition(5),
            radius: 5,
            color: getRandomColor(),
        });
    }
}

initFood();
app.use(express.static('public'));

// --- WebSocket Connection Handling ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Create a new player object with multiple blobs support
    const startPos = getRandomPosition(PLAYER_START_RADIUS);
    players[socket.id] = {
        id: socket.id,
        name: 'Anonymous',
        color: getRandomColor(),
        blobs: [{
            id: 0,
            x: startPos.x,
            y: startPos.y,
            radius: PLAYER_START_RADIUS,
            speed: 4,
            targetX: startPos.x,
            targetY: startPos.y,
        }],
        splitTime: null, // When the split happened
    };

    // Send initial game state to the new player
    socket.emit('init', {
        players,
        food,
        pellets,
        map: { width: MAP_WIDTH, height: MAP_HEIGHT }
    });

    // Broadcast new player to all other players
    socket.broadcast.emit('player-joined', players[socket.id]);

    // Handle player movement
    socket.on('mousemove', (target) => {
        const player = players[socket.id];
        if (!player) return;

        // Set target for all blobs
        player.blobs.forEach(blob => {
            blob.targetX = target.x;
            blob.targetY = target.y;
        });
    });

    // Handle player name
    socket.on('set-name', (name) => {
        const player = players[socket.id];
        if (!player) return;
        player.name = name || 'Anonymous';
    });

    // Handle split
    socket.on('split', () => {
        const player = players[socket.id];
        if (!player || player.blobs.length >= 16) return; // Max 16 blobs

        const newBlobs = [];
        player.blobs.forEach(blob => {
            if (blob.radius < 15) return; // Too small to split

            // Calculate new radius (split mass in half)
            const newRadius = blob.radius / Math.sqrt(2);

            // Calculate direction toward target
            const dx = blob.targetX - blob.x;
            const dy = blob.targetY - blob.y;
            const angle = Math.atan2(dy, dx);

            // Create two new blobs
            const offset = newRadius * 1.5;
            newBlobs.push({
                id: Date.now() + Math.random(),
                x: blob.x + Math.cos(angle) * offset,
                y: blob.y + Math.sin(angle) * offset,
                radius: newRadius,
                speed: Math.max(1, 4 - newRadius / 100),
                targetX: blob.targetX,
                targetY: blob.targetY,
            });
            newBlobs.push({
                id: Date.now() + Math.random() + 0.1,
                x: blob.x - Math.cos(angle) * offset,
                y: blob.y - Math.sin(angle) * offset,
                radius: newRadius,
                speed: Math.max(1, 4 - newRadius / 100),
                targetX: blob.targetX,
                targetY: blob.targetY,
            });
        });

        if (newBlobs.length > 0) {
            player.blobs = newBlobs;
            player.splitTime = Date.now();
        }
    });

    // Handle mass ejection
    socket.on('eject-mass', () => {
        const player = players[socket.id];
        if (!player) return;

        // Only allow ejection if player has enough mass
        const MASS_PERCENT = 0.03;
        const MIN_RADIUS = 15; // Minimum radius to allow ejection

        // Eject from each blob
        player.blobs.forEach(blob => {
            if (blob.radius < MIN_RADIUS) return;

            // Calculate direction blob is moving
            const dx = blob.targetX - blob.x;
            const dy = blob.targetY - blob.y;
            const angle = Math.atan2(dy, dx);

            // Calculate pellet properties
            const pelletRadius = getEjectedPelletRadius(blob.radius, MASS_PERCENT);
            const pelletSpeed = 15;

            // Create pellet
            const pellet = {
                id: `pellet_${pelletIdCounter++}`,
                x: blob.x + Math.cos(angle) * (blob.radius + pelletRadius),
                y: blob.y + Math.sin(angle) * (blob.radius + pelletRadius),
                radius: pelletRadius,
                color: player.color,
                vx: Math.cos(angle) * pelletSpeed,
                vy: Math.sin(angle) * pelletSpeed,
                createdAt: Date.now(),
            };

            pellets.push(pellet);

            // Reduce blob size
            blob.radius = getRadiusAfterEjection(blob.radius, MASS_PERCENT);
            blob.speed = Math.max(1, 4 - blob.radius / 100);
        });
    });

    // Handle player disconnection
    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
        delete players[socket.id];
        io.emit('player-left', socket.id);
    });
});

// --- Game Loop ---
setInterval(() => {
    const allPlayers = Object.values(players);

    // Move and clean up pellets
    for (let i = pellets.length - 1; i >= 0; i--) {
        const pellet = pellets[i];
        pellet.x += pellet.vx;
        pellet.y += pellet.vy;
        pellet.vx *= 0.95;
        pellet.vy *= 0.95;

        const outOfBounds = pellet.x < 0 || pellet.x > MAP_WIDTH || pellet.y < 0 || pellet.y > MAP_HEIGHT;
        const tooOld = Date.now() - pellet.createdAt > 30000;
        if (outOfBounds || tooOld) {
            pellets.splice(i, 1);
        }
    }

    // Move all blobs toward their targets
    for (const player of allPlayers) {
        player.blobs.forEach(blob => {
            const dx = blob.targetX - blob.x;
            const dy = blob.targetY - blob.y;
            const dist = Math.hypot(dx, dy);

            if (dist > 1) {
                const angle = Math.atan2(dy, dx);
                blob.x += Math.cos(angle) * blob.speed;
                blob.y += Math.sin(angle) * blob.speed;

                // Clamp position to map boundaries
                blob.x = Math.max(blob.radius, Math.min(MAP_WIDTH - blob.radius, blob.x));
                blob.y = Math.max(blob.radius, Math.min(MAP_HEIGHT - blob.radius, blob.y));
            }
        });

        // Auto-merge after 90 seconds
        if (player.splitTime && Date.now() - player.splitTime > 90000 && player.blobs.length > 1) {
            // Calculate total mass
            const totalArea = player.blobs.reduce((sum, blob) => sum + Math.PI * blob.radius * blob.radius, 0);
            const newRadius = Math.sqrt(totalArea / Math.PI);

            // Calculate center position
            const centerX = player.blobs.reduce((sum, blob) => sum + blob.x, 0) / player.blobs.length;
            const centerY = player.blobs.reduce((sum, blob) => sum + blob.y, 0) / player.blobs.length;

            // Merge into single blob
            player.blobs = [{
                id: 0,
                x: centerX,
                y: centerY,
                radius: newRadius,
                speed: Math.max(1, 4 - newRadius / 100),
                targetX: player.blobs[0].targetX,
                targetY: player.blobs[0].targetY,
            }];
            player.splitTime = null;
        }
    }

    // Collision detection - check each blob
    for (const player of allPlayers) {
        for (let blobIdx = 0; blobIdx < player.blobs.length; blobIdx++) {
            const blob = player.blobs[blobIdx];

            // Food collision
            for (let i = food.length - 1; i >= 0; i--) {
                const f = food[i];
                const dist = Math.hypot(blob.x - f.x, blob.y - f.y);
                if (dist < blob.radius) {
                    blob.radius = getNewRadius(blob.radius, f.radius);
                    blob.speed = Math.max(1, 4 - blob.radius / 100);
                    food.splice(i, 1);
                    food.push({ id: `f${Date.now()}`, ...getRandomPosition(5), radius: 5, color: getRandomColor() });
                }
            }

            // Pellet collision
            for (let i = pellets.length - 1; i >= 0; i--) {
                const pellet = pellets[i];
                const dist = Math.hypot(blob.x - pellet.x, blob.y - pellet.y);
                if (dist < blob.radius) {
                    blob.radius = getNewRadius(blob.radius, pellet.radius);
                    blob.speed = Math.max(1, 4 - blob.radius / 100);
                    pellets.splice(i, 1);
                }
            }
        }

        // Player blob collision with other players' blobs
        for (let blobIdx = player.blobs.length - 1; blobIdx >= 0; blobIdx--) {
            const blob = player.blobs[blobIdx];

            for (const otherPlayer of allPlayers) {
                if (player.id === otherPlayer.id) continue;

                for (let otherBlobIdx = otherPlayer.blobs.length - 1; otherBlobIdx >= 0; otherBlobIdx--) {
                    const otherBlob = otherPlayer.blobs[otherBlobIdx];
                    const dist = Math.hypot(blob.x - otherBlob.x, blob.y - otherBlob.y);

                    if (dist < blob.radius && blob.radius > otherBlob.radius * 1.1) {
                        // This blob eats other blob
                        blob.radius = getNewRadius(blob.radius, otherBlob.radius);
                        blob.speed = Math.max(1, 4 - blob.radius / 100);
                        otherPlayer.blobs.splice(otherBlobIdx, 1);

                        // If other player has no blobs left, they're eliminated
                        if (otherPlayer.blobs.length === 0) {
                            io.emit('player-eaten', { eatenId: otherPlayer.id, eaterId: player.id });
                            delete players[otherPlayer.id];
                        }
                    }
                }
            }
        }
    }

    // Broadcast game state to all clients
    io.emit('update', { players, food, pellets });
}, 1000 / 60); // 60 FPS

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
