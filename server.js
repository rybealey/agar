const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const db = require('./database');

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
let MAP_WIDTH = 2000;
let MAP_HEIGHT = 2000;
let FOOD_COUNT = 150;
const PLAYER_START_RADIUS = 20;
const SPIKE_COUNT = 15;
const SPIKE_RADIUS = 40;

// Server start time for uptime tracking
const serverStartTime = Date.now();

let players = {};
let food = [];
let pellets = [];
let pelletIdCounter = 0;
let spikes = [];
let coinDrops = [];
let coinDropIdCounter = 0;

// Server announcement
let serverAnnouncement = {
    message: '',
    enabled: false,
    updatedAt: null,
    updatedBy: null
};

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

function initSpikes() {
    for (let i = 0; i < SPIKE_COUNT; i++) {
        spikes.push({
            id: `s${i}`,
            ...getRandomPosition(SPIKE_RADIUS),
            radius: SPIKE_RADIUS,
            mass: Math.PI * SPIKE_RADIUS * SPIKE_RADIUS, // Mass based on area
        });
    }
}

initFood();
initSpikes();

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

// Session configuration
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'agar-admin-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
});

app.use(sessionMiddleware);

// Share session with socket.io
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

app.use(express.static('public'));
app.use(express.json());

// --- Admin Authentication ---
const adminsFilePath = path.join(__dirname, 'admins.json');

// Initialize admin credentials file if it doesn't exist
function initAdminsFile() {
    if (!fs.existsSync(adminsFilePath)) {
        // Create default admin account (username: admin, password: admin123)
        // IMPORTANT: Change this password immediately after first login!
        const defaultPassword = 'admin123';
        const hashedPassword = bcrypt.hashSync(defaultPassword, 10);

        const defaultAdmins = {
            'admin': {
                username: 'admin',
                passwordHash: hashedPassword,
                createdAt: new Date().toISOString()
            }
        };

        fs.writeFileSync(adminsFilePath, JSON.stringify(defaultAdmins, null, 2));
        console.log('Created default admin account (username: admin, password: admin123)');
        console.log('IMPORTANT: Change the default password immediately!');
    }
}

initAdminsFile();

function loadAdmins() {
    try {
        if (fs.existsSync(adminsFilePath)) {
            const data = fs.readFileSync(adminsFilePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Error loading admins:', err);
    }
    return {};
}

function saveAdmins(admins) {
    try {
        fs.writeFileSync(adminsFilePath, JSON.stringify(admins, null, 2));
    } catch (err) {
        console.error('Error saving admins:', err);
    }
}

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.adminUsername) {
        return next();
    }
    return res.status(401).json({ error: 'Unauthorized. Please login.' });
}

// --- Authentication Routes ---

// Check authentication status
app.get('/api/auth/status', (req, res) => {
    if (req.session && req.session.adminUsername) {
        res.json({ authenticated: true, username: req.session.adminUsername });
    } else {
        res.json({ authenticated: false });
    }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const admins = loadAdmins();
    const admin = admins[username];

    if (!admin) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    try {
        const passwordMatch = await bcrypt.compare(password, admin.passwordHash);

        if (passwordMatch) {
            req.session.adminUsername = username;
            res.json({ success: true, username: username });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ success: true });
    });
});

// Change password endpoint (requires authentication)
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password required' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const username = req.session.adminUsername;
    const admins = loadAdmins();
    const admin = admins[username];

    try {
        const passwordMatch = await bcrypt.compare(currentPassword, admin.passwordHash);

        if (!passwordMatch) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        admins[username].passwordHash = hashedPassword;
        admins[username].lastPasswordChange = new Date().toISOString();
        saveAdmins(admins);

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        console.error('Password change error:', err);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// --- User Authentication Routes ---

// User registration
app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    try {
        // Check if user already exists
        const existingUser = db.getUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Create new user with 100 starting coins
        const userId = db.createUser(email, password);
        db.updateUserCoins(userId, 100); // Welcome bonus

        res.json({ success: true, message: 'Registration successful', userId });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// User login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const user = db.getUserByEmail(email);

        if (!user || !db.verifyPassword(user, password)) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Store user ID in session
        req.session.userId = user.id;
        req.session.userEmail = user.email;

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                coins: user.coins
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// User logout
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Get current user info
app.get('/api/user', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ authenticated: false });
    }

    const user = db.getUserById(req.session.userId);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json({
        authenticated: true,
        user: {
            id: user.id,
            email: user.email,
            coins: user.coins
        }
    });
});

// Get user's owned skins
app.get('/api/user/skins', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const ownedSkins = db.getUserSkins(req.session.userId);
    res.json({ skins: ownedSkins });
});

// Purchase a skin
app.post('/api/skins/purchase', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const { filename } = req.body;

    if (!filename) {
        return res.status(400).json({ error: 'Filename is required' });
    }

    const skinPrice = db.getSkinPrice(filename);
    if (!skinPrice || !skinPrice.for_sale) {
        return res.status(400).json({ error: 'Skin not available for purchase' });
    }

    const result = db.purchaseSkin(req.session.userId, filename, skinPrice.price);

    if (result.success) {
        const user = db.getUserById(req.session.userId);
        res.json({
            success: true,
            message: 'Skin purchased successfully',
            remainingCoins: user.coins
        });
    } else {
        res.status(400).json({ error: result.error });
    }
});

// --- Admin Management Routes ---

// List all admin accounts (protected)
app.get('/api/admins', requireAuth, (req, res) => {
    const admins = loadAdmins();
    const adminList = Object.values(admins).map(admin => ({
        username: admin.username,
        createdAt: admin.createdAt,
        lastPasswordChange: admin.lastPasswordChange
    }));
    res.json(adminList);
});

// Add new admin account (protected)
app.post('/api/admins', requireAuth, async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    if (username.length < 3) {
        return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const admins = loadAdmins();

    if (admins[username]) {
        return res.status(400).json({ error: 'Username already exists' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        admins[username] = {
            username: username,
            passwordHash: hashedPassword,
            createdAt: new Date().toISOString()
        };
        saveAdmins(admins);

        res.json({ success: true, message: 'Admin account created successfully' });
    } catch (err) {
        console.error('Error creating admin:', err);
        res.status(500).json({ error: 'Failed to create admin account' });
    }
});

// Delete admin account (protected)
app.delete('/api/admins/:username', requireAuth, (req, res) => {
    const usernameToDelete = req.params.username;
    const currentUsername = req.session.adminUsername;

    // Prevent deleting your own account
    if (usernameToDelete === currentUsername) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const admins = loadAdmins();

    if (!admins[usernameToDelete]) {
        return res.status(404).json({ error: 'Admin account not found' });
    }

    delete admins[usernameToDelete];
    saveAdmins(admins);

    res.json({ success: true, message: 'Admin account deleted successfully' });
});

// --- Server Statistics Routes ---

// Get server statistics (protected)
app.get('/api/stats', requireAuth, (req, res) => {
    const uptime = Date.now() - serverStartTime;
    const activePlayers = Object.keys(players).length;

    // Count total skins
    const skinsDir = path.join(__dirname, 'public', 'skins');
    let totalSkins = 0;
    if (fs.existsSync(skinsDir)) {
        const files = fs.readdirSync(skinsDir);
        totalSkins = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
        }).length;
    }

    res.json({
        uptime: uptime,
        uptimeFormatted: formatUptime(uptime),
        activePlayers: activePlayers,
        totalSkins: totalSkins,
        totalFood: food.length,
        totalPellets: pellets.length,
        mapWidth: MAP_WIDTH,
        mapHeight: MAP_HEIGHT,
        configuredFoodCount: FOOD_COUNT
    });
});

// Get active players list (protected)
app.get('/api/players', requireAuth, (req, res) => {
    const playersList = Object.values(players).map(player => ({
        id: player.id,
        name: player.name || 'Anonymous',
        blobCount: player.blobs.length,
        totalMass: player.blobs.reduce((sum, blob) => sum + (Math.PI * blob.radius * blob.radius), 0),
        skin: player.skin
    })).sort((a, b) => b.totalMass - a.totalMass);

    res.json(playersList);
});

// --- Game Configuration Routes ---

// Get game configuration (protected)
app.get('/api/config', requireAuth, (req, res) => {
    res.json({
        mapWidth: MAP_WIDTH,
        mapHeight: MAP_HEIGHT,
        foodCount: FOOD_COUNT
    });
});

// Update game configuration (protected)
app.put('/api/config', requireAuth, (req, res) => {
    const { mapWidth, mapHeight, foodCount } = req.body;

    if (mapWidth !== undefined) {
        if (mapWidth < 1000 || mapWidth > 10000) {
            return res.status(400).json({ error: 'Map width must be between 1000 and 10000' });
        }
        MAP_WIDTH = parseInt(mapWidth);
    }

    if (mapHeight !== undefined) {
        if (mapHeight < 1000 || mapHeight > 10000) {
            return res.status(400).json({ error: 'Map height must be between 1000 and 10000' });
        }
        MAP_HEIGHT = parseInt(mapHeight);
    }

    if (foodCount !== undefined) {
        if (foodCount < 50 || foodCount > 1000) {
            return res.status(400).json({ error: 'Food count must be between 50 and 1000' });
        }
        FOOD_COUNT = parseInt(foodCount);

        // Adjust current food
        while (food.length < FOOD_COUNT) {
            const radius = getRandomFoodSize();
            food.push({ id: `f${Date.now()}${Math.random()}`, ...getRandomPosition(radius), radius: radius, color: getRandomColor() });
        }
        while (food.length > FOOD_COUNT) {
            food.pop();
        }
    }

    res.json({
        success: true,
        message: 'Configuration updated successfully',
        config: {
            mapWidth: MAP_WIDTH,
            mapHeight: MAP_HEIGHT,
            foodCount: FOOD_COUNT
        }
    });
});

// --- Skin Pricing Management (Admin) ---

// Get all skin prices
app.get('/api/skin-prices', requireAuth, (req, res) => {
    const prices = db.getAllSkinPrices();
    res.json({ prices });
});

// Set skin price (admin only)
app.post('/api/skin-prices', requireAuth, (req, res) => {
    const { filename, price, forSale } = req.body;

    if (!filename || price === undefined) {
        return res.status(400).json({ error: 'Filename and price are required' });
    }

    if (price < 0) {
        return res.status(400).json({ error: 'Price must be non-negative' });
    }

    try {
        db.setSkinPrice(filename, price, forSale !== false);
        res.json({ success: true, message: 'Skin price updated successfully' });
    } catch (error) {
        console.error('Error setting skin price:', error);
        res.status(500).json({ error: 'Failed to set skin price' });
    }
});

// Remove skin from sale
app.delete('/api/skin-prices/:filename', requireAuth, (req, res) => {
    const filename = req.params.filename;

    try {
        db.removeSkinPrice(filename);
        res.json({ success: true, message: 'Skin removed from sale' });
    } catch (error) {
        console.error('Error removing skin price:', error);
        res.status(500).json({ error: 'Failed to remove skin price' });
    }
});

// Get all users (admin only)
app.get('/api/users', requireAuth, (req, res) => {
    try {
        const users = db.getAllUsers();
        res.json({ users });
    } catch (error) {
        console.error('Error getting users:', error);
        res.status(500).json({ error: 'Failed to get users' });
    }
});

// Update user coins (admin only)
app.put('/api/users/:userId/coins', requireAuth, (req, res) => {
    const userId = parseInt(req.params.userId);
    const { coins } = req.body;

    if (isNaN(userId) || coins === undefined) {
        return res.status(400).json({ error: 'Invalid user ID or coins value' });
    }

    if (coins < 0) {
        return res.status(400).json({ error: 'Coins must be non-negative' });
    }

    try {
        db.updateUserCoins(userId, coins);
        res.json({ success: true, message: 'User coins updated successfully' });
    } catch (error) {
        console.error('Error updating user coins:', error);
        res.status(500).json({ error: 'Failed to update user coins' });
    }
});

// Helper function to format uptime
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

// --- Server Announcement Routes ---

// Get current announcement (public - no auth required)
app.get('/api/announcement', (req, res) => {
    res.json(serverAnnouncement);
});

// Set announcement (protected)
app.post('/api/announcement', requireAuth, (req, res) => {
    const { message, enabled } = req.body;

    if (message !== undefined) {
        serverAnnouncement.message = message.trim();
    }

    if (enabled !== undefined) {
        serverAnnouncement.enabled = Boolean(enabled);
    }

    serverAnnouncement.updatedAt = new Date().toISOString();
    serverAnnouncement.updatedBy = req.session.adminUsername;

    // Broadcast announcement to all connected clients
    io.emit('announcement', serverAnnouncement);

    res.json({
        success: true,
        message: 'Announcement updated successfully',
        announcement: serverAnnouncement
    });
});

// Clear announcement (protected)
app.delete('/api/announcement', requireAuth, (req, res) => {
    serverAnnouncement.message = '';
    serverAnnouncement.enabled = false;
    serverAnnouncement.updatedAt = new Date().toISOString();
    serverAnnouncement.updatedBy = req.session.adminUsername;

    // Broadcast cleared announcement to all connected clients
    io.emit('announcement', serverAnnouncement);

    res.json({
        success: true,
        message: 'Announcement cleared successfully'
    });
});

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
        const skins = imageFiles.map(filename => {
            return {
                filename: filename,
                name: metadata[filename] || filename.replace(/^\d+-/, '').replace(/\.[^.]+$/, '')
            };
        });

        res.json(skins);
    });
});

// Upload a new skin (protected)
app.post('/api/skins/upload', requireAuth, (req, res) => {
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

// Update skin name (protected)
app.put('/api/skins/:filename/name', requireAuth, (req, res) => {
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

// Delete a skin (protected)
app.delete('/api/skins/:filename', requireAuth, (req, res) => {
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
    const userId = socket.request?.session?.userId; // Get userId from session if authenticated
    players[socket.id] = {
        id: socket.id,
        userId: userId || null, // Store userId for coin collection
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
        spikes,
        coinDrops,
        map: { width: MAP_WIDTH, height: MAP_HEIGHT }
    });

    // Send current announcement to the new player
    socket.emit('announcement', serverAnnouncement);

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
    socket.on('set-skin', async (skin, customColor) => {
        const player = players[socket.id];
        if (!player) return;

        const userId = socket.request.session?.userId;

        // Validate skin selection based on authentication and ownership
        if (skin === 'none' || !skin) {
            // Random color - always allowed
            player.skin = 'none';
        } else if (skin === 'custom') {
            // Custom color - only allowed if authenticated
            if (userId) {
                player.skin = 'custom';
                if (customColor) {
                    player.color = customColor;
                }
            } else {
                // Guest trying to use custom color - force to random
                player.skin = 'none';
            }
        } else {
            // Custom skin file - must be owned by user
            if (userId && db.userOwnsSkin(userId, skin)) {
                player.skin = skin;
            } else {
                // User doesn't own this skin or not authenticated - force to random
                player.skin = 'none';
            }
        }
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

            // Spike collision
            for (const spike of spikes) {
                const dx = blob.x - spike.x;
                const dy = blob.y - spike.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Check if blob is touching spike
                if (dist < blob.radius + spike.radius) {
                    const blobMass = Math.PI * blob.radius * blob.radius;

                    // If blob is bigger than spike, it bursts into pieces
                    if (blobMass > spike.mass) {
                        // Blob gains some mass from spike
                        const newBlobMass = blobMass + spike.mass * 0.2; // Gain 20% of spike mass
                        const newRadius = Math.sqrt(newBlobMass / Math.PI);

                        // Split the blob into multiple pieces (similar to space bar split)
                        const numPieces = 8; // Split into 8 pieces
                        const pieceArea = (Math.PI * newRadius * newRadius) / numPieces;
                        const pieceRadius = Math.sqrt(pieceArea / Math.PI);

                        // Remove the original blob
                        player.blobs.splice(blobIdx, 1);
                        blobIdx--; // Adjust index since we removed current blob

                        // Create new blob pieces radiating outward
                        for (let i = 0; i < numPieces; i++) {
                            const angle = (Math.PI * 2 * i) / numPieces;
                            const splitDistance = 15;

                            player.blobs.push({
                                id: player.blobs.length,
                                x: blob.x + Math.cos(angle) * splitDistance,
                                y: blob.y + Math.sin(angle) * splitDistance,
                                radius: pieceRadius,
                                speed: Math.max(1.0, 8 - pieceRadius / 20),
                                targetX: blob.targetX,
                                targetY: blob.targetY,
                                splitVelocityX: Math.cos(angle) * 12,
                                splitVelocityY: Math.sin(angle) * 12,
                            });
                        }

                        // Set split time
                        player.splitTime = Date.now();

                        break; // Stop checking other spikes for this blob (it's gone)
                    }
                    // If blob is smaller, it can hide under the spike (no collision effect)
                }
            }

            // Coin drop collision - only for authenticated users
            for (let i = coinDrops.length - 1; i >= 0; i--) {
                const coin = coinDrops[i];
                const dx = blob.x - coin.x;
                const dy = blob.y - coin.y;
                const distSq = dx * dx + dy * dy;

                if (distSq < blobRadiusSq) {
                    // Check if player is authenticated
                    if (player.userId) {
                        // Give coins to the player
                        db.addCoinsToUser(player.userId, coin.value);
                    }
                    // Remove the coin drop (anyone can collect, but only logged-in users get coins)
                    coinDrops.splice(i, 1);
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
    io.emit('update', { players, food, pellets, spikes, coinDrops });
}, 1000 / 30); // 30 FPS server updates (client interpolates)

// Spawn coin drops periodically
setInterval(() => {
    const coinRadius = 15;
    coinDrops.push({
        id: `coin${coinDropIdCounter++}`,
        ...getRandomPosition(coinRadius),
        radius: coinRadius,
        value: 50, // 50 coins
    });
}, 30000); // Spawn a coin every 30 seconds

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
