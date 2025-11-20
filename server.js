const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Configure multer for skin uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'public', 'skins');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        // Keep original filename with timestamp prefix to avoid conflicts
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

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

function getRandomFoodSize() {
    // Weighted distribution: 60% small, 30% medium, 10% large
    const rand = Math.random();
    if (rand < 0.6) {
        // Small food: 3-5 radius
        return Math.floor(Math.random() * 3) + 3;
    } else if (rand < 0.9) {
        // Medium food: 6-8 radius
        return Math.floor(Math.random() * 3) + 6;
    } else {
        // Large food: 9-12 radius
        return Math.floor(Math.random() * 4) + 9;
    }
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
        const radius = getRandomFoodSize();
        food.push({
            id: `f${i}`,
            ...getRandomPosition(radius),
            radius: radius,
            color: getRandomColor(),
        });
    }
}

initFood();

// Ensure skins directory exists at startup
const skinsDir = path.join(__dirname, 'public', 'skins');
if (!fs.existsSync(skinsDir)) {
    try {
        fs.mkdirSync(skinsDir, { recursive: true });
        console.log('Created skins directory:', skinsDir);
    } catch (err) {
        console.error('Error creating skins directory:', err);
    }
}

app.use(express.static('public'));
app.use(express.json());

// --- Skin Metadata Management ---
const skinsMetadataPath = path.join(__dirname, 'public', 'skins', 'metadata.json');

function loadSkinsMetadata() {
    try {
        if (fs.existsSync(skinsMetadataPath)) {
            const data = fs.readFileSync(skinsMetadataPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Error loading skins metadata:', err);
    }
    return {};
}

function saveSkinsMetadata(metadata) {
    try {
        const skinsDir = path.join(__dirname, 'public', 'skins');
        if (!fs.existsSync(skinsDir)) {
            fs.mkdirSync(skinsDir, { recursive: true });
        }
        fs.writeFileSync(skinsMetadataPath, JSON.stringify(metadata, null, 2));
    } catch (err) {
        console.error('Error saving skins metadata:', err);
    }
}

// --- Skin Management API Routes ---

// Get list of available skins with names
app.get('/api/skins', (req, res) => {
    const skinsDir = path.join(__dirname, 'public', 'skins');

    if (!fs.existsSync(skinsDir)) {
        return res.json([]);
    }

    fs.readdir(skinsDir, (err, files) => {
        if (err) {
            console.error('Error reading skins directory:', err);
            return res.status(500).json({ error: 'Failed to read skins' });
        }

        // Filter to only image files
        const imageFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
        });

        // Load metadata
        const metadata = loadSkinsMetadata();

        // Map files to skin objects with names
        const skins = imageFiles.map(filename => ({
            filename: filename,
            name: metadata[filename] || filename.replace(/^\d+-/, '').replace(/\.[^.]+$/, '')
        }));

        res.json(skins);
    });
});

// Upload a new skin
app.post('/api/skins/upload', (req, res) => {
    console.log('Received upload request');

    upload.single('skin')(req, res, (err) => {
        if (err) {
            console.error('Upload error:', err);
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
                }
                return res.status(400).json({ error: `Upload error: ${err.message}` });
            }
            return res.status(400).json({ error: err.message || 'Upload failed' });
        }

        if (!req.file) {
            console.error('No file in request');
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log('File uploaded successfully:', req.file.filename);

        try {
            // Save skin name to metadata
            const skinName = req.body.skinName || req.file.originalname.replace(/\.[^.]+$/, '');
            const metadata = loadSkinsMetadata();
            metadata[req.file.filename] = skinName;
            saveSkinsMetadata(metadata);

            res.json({
                message: 'Skin uploaded successfully',
                filename: req.file.filename,
                name: skinName
            });
        } catch (metadataErr) {
            console.error('Error saving metadata:', metadataErr);
            // File was uploaded successfully, just metadata failed
            res.json({
                message: 'Skin uploaded successfully (metadata save failed)',
                filename: req.file.filename,
                name: req.file.originalname.replace(/\.[^.]+$/, '')
            });
        }
    });
});

// Update skin name
app.put('/api/skins/:filename/name', (req, res) => {
    const filename = req.params.filename;
    const newName = req.body.name;

    if (!newName) {
        return res.status(400).json({ error: 'Name is required' });
    }

    // Security check: ensure filename doesn't contain path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }

    const metadata = loadSkinsMetadata();
    metadata[filename] = newName;
    saveSkinsMetadata(metadata);

    res.json({ message: 'Skin name updated successfully', name: newName });
});

// Delete a skin
app.delete('/api/skins/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'public', 'skins', filename);

    // Security check: ensure filename doesn't contain path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }

    fs.unlink(filePath, (err) => {
        if (err) {
            console.error('Error deleting file:', err);
            return res.status(500).json({ error: 'Failed to delete skin' });
        }

        // Remove from metadata
        const metadata = loadSkinsMetadata();
        delete metadata[filename];
        saveSkinsMetadata(metadata);

        res.json({ message: 'Skin deleted successfully' });
    });
});

// --- WebSocket Connection Handling ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Create a new player object with multiple blobs support
    const startPos = getRandomPosition(PLAYER_START_RADIUS);
    players[socket.id] = {
        id: socket.id,
        name: '',
        color: getRandomColor(),
        skin: 'none', // Default to no skin
        blobs: [{
            id: 0,
            x: startPos.x,
            y: startPos.y,
            radius: PLAYER_START_RADIUS,
            speed: Math.max(1.0, 8 - PLAYER_START_RADIUS / 20),
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
        player.name = name || '';
    });

    // Handle player skin selection
    socket.on('set-skin', (skin) => {
        const player = players[socket.id];
        if (!player) return;
        player.skin = skin || 'none';
    });

    // Handle split
    socket.on('split', () => {
        const player = players[socket.id];
        if (!player || player.blobs.length >= 16) return; // Max 16 blobs

        const newBlobs = [];
        const SPLIT_VELOCITY = 20; // Initial split velocity

        player.blobs.forEach(blob => {
            if (blob.radius < 15) return; // Too small to split

            // Calculate new radius (split mass in half)
            const newRadius = blob.radius / Math.sqrt(2);

            // Calculate direction toward target
            const dx = blob.targetX - blob.x;
            const dy = blob.targetY - blob.y;
            const angle = Math.atan2(dy, dx);

            // Create two new blobs with velocity
            const offset = newRadius * 1.5;
            newBlobs.push({
                id: Date.now() + Math.random(),
                x: blob.x + Math.cos(angle) * offset,
                y: blob.y + Math.sin(angle) * offset,
                radius: newRadius,
                speed: Math.max(1.0, 8 - newRadius / 20),
                targetX: blob.targetX,
                targetY: blob.targetY,
                splitVelocityX: Math.cos(angle) * SPLIT_VELOCITY,
                splitVelocityY: Math.sin(angle) * SPLIT_VELOCITY,
            });
            newBlobs.push({
                id: Date.now() + Math.random() + 0.1,
                x: blob.x - Math.cos(angle) * offset,
                y: blob.y - Math.sin(angle) * offset,
                radius: newRadius,
                speed: Math.max(1.0, 8 - newRadius / 20),
                targetX: blob.targetX,
                targetY: blob.targetY,
                splitVelocityX: -Math.cos(angle) * SPLIT_VELOCITY,
                splitVelocityY: -Math.sin(angle) * SPLIT_VELOCITY,
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
            blob.speed = Math.max(1.0, 8 - blob.radius / 20);
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
            // Apply split velocity if present
            if (blob.splitVelocityX !== undefined && blob.splitVelocityY !== undefined) {
                blob.x += blob.splitVelocityX;
                blob.y += blob.splitVelocityY;

                // Decay split velocity
                blob.splitVelocityX *= 0.85;
                blob.splitVelocityY *= 0.85;

                // Remove velocity when it becomes negligible
                if (Math.abs(blob.splitVelocityX) < 0.1 && Math.abs(blob.splitVelocityY) < 0.1) {
                    delete blob.splitVelocityX;
                    delete blob.splitVelocityY;
                }
            }

            // Normal movement toward target
            const dx = blob.targetX - blob.x;
            const dy = blob.targetY - blob.y;
            const dist = Math.hypot(dx, dy);

            if (dist > 1) {
                const angle = Math.atan2(dy, dx);
                blob.x += Math.cos(angle) * blob.speed;
                blob.y += Math.sin(angle) * blob.speed;
            }

            // Clamp position to map boundaries
            blob.x = Math.max(blob.radius, Math.min(MAP_WIDTH - blob.radius, blob.x));
            blob.y = Math.max(blob.radius, Math.min(MAP_HEIGHT - blob.radius, blob.y));
        });

        // Auto-merge after 60 seconds
        if (player.splitTime && Date.now() - player.splitTime > 60000 && player.blobs.length > 1) {
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
                speed: Math.max(1.0, 8 - newRadius / 20),
                targetX: player.blobs[0].targetX,
                targetY: player.blobs[0].targetY,
            }];
            player.splitTime = null;
        }

        // Blob repulsion - prevent same-player blobs from overlapping (except when merging)
        const isMerging = player.splitTime && Date.now() - player.splitTime > 59000; // Last 1 second allows overlap

        if (!isMerging && player.blobs.length > 1) {
            for (let i = 0; i < player.blobs.length; i++) {
                for (let j = i + 1; j < player.blobs.length; j++) {
                    const blob1 = player.blobs[i];
                    const blob2 = player.blobs[j];

                    const dx = blob2.x - blob1.x;
                    const dy = blob2.y - blob1.y;
                    const dist = Math.hypot(dx, dy);
                    const minDist = blob1.radius + blob2.radius;

                    // If overlapping, push them apart
                    if (dist < minDist && dist > 0) {
                        const overlap = minDist - dist;
                        const pushX = (dx / dist) * overlap * 0.5;
                        const pushY = (dy / dist) * overlap * 0.5;

                        blob1.x -= pushX;
                        blob1.y -= pushY;
                        blob2.x += pushX;
                        blob2.y += pushY;

                        // Keep within bounds
                        blob1.x = Math.max(blob1.radius, Math.min(MAP_WIDTH - blob1.radius, blob1.x));
                        blob1.y = Math.max(blob1.radius, Math.min(MAP_HEIGHT - blob1.radius, blob1.y));
                        blob2.x = Math.max(blob2.radius, Math.min(MAP_WIDTH - blob2.radius, blob2.x));
                        blob2.y = Math.max(blob2.radius, Math.min(MAP_HEIGHT - blob2.radius, blob2.y));
                    }
                }
            }
        }
    }

    // Collision detection - check each blob
    for (const player of allPlayers) {
        for (let blobIdx = 0; blobIdx < player.blobs.length; blobIdx++) {
            const blob = player.blobs[blobIdx];
            const blobRadiusSq = blob.radius * blob.radius; // Pre-calculate for performance

            // Food collision - optimized with squared distance
            for (let i = food.length - 1; i >= 0; i--) {
                const f = food[i];
                const dx = blob.x - f.x;
                const dy = blob.y - f.y;
                const distSq = dx * dx + dy * dy;

                if (distSq < blobRadiusSq) {
                    blob.radius = getNewRadius(blob.radius, f.radius);
                    blob.speed = Math.max(1.0, 8 - blob.radius / 20);
                    food.splice(i, 1);
                    // Respawn with random size
                    const newRadius = getRandomFoodSize();
                    food.push({ id: `f${Date.now()}`, ...getRandomPosition(newRadius), radius: newRadius, color: getRandomColor() });
                }
            }

            // Pellet collision - optimized with squared distance
            for (let i = pellets.length - 1; i >= 0; i--) {
                const pellet = pellets[i];
                const dx = blob.x - pellet.x;
                const dy = blob.y - pellet.y;
                const distSq = dx * dx + dy * dy;

                if (distSq < blobRadiusSq) {
                    blob.radius = getNewRadius(blob.radius, pellet.radius);
                    blob.speed = Math.max(1.0, 8 - blob.radius / 20);
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
                    const dx = blob.x - otherBlob.x;
                    const dy = blob.y - otherBlob.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < blob.radius && blob.radius > otherBlob.radius * 1.1) {
                        // This blob eats other blob
                        blob.radius = getNewRadius(blob.radius, otherBlob.radius);
                        blob.speed = Math.max(1.0, 8 - blob.radius / 20);
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
}, 1000 / 30); // 30 FPS server updates (client interpolates)

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
