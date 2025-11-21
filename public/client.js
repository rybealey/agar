const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let socket = null;

let players = {};
let food = {};
let pellets = [];
let map = { width: 2000, height: 2000 };
let me = null;
let gameStarted = false;
let selectedSkin = 'none'; // Track selected skin
let customColor = '#ff6b6b'; // Track custom color selection
let skinImages = {}; // Cache loaded skin images
let preloadedSkins = new Set(); // Track which skins have been preloaded

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

// Load dark mode preference from localStorage
const darkModeCheckbox = document.getElementById('darkModeCheckbox');
const savedDarkMode = localStorage.getItem('darkMode');
if (savedDarkMode === 'true') {
    document.body.classList.add('dark-mode');
    darkModeCheckbox.checked = true;
}

// Save dark mode preference when checkbox changes
darkModeCheckbox.addEventListener('change', (e) => {
    localStorage.setItem('darkMode', e.target.checked);
    if (e.target.checked) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
});

// Handle name input and skin selection
const nameOverlay = document.getElementById('nameOverlay');
const nameInput = document.getElementById('nameInput');
const playButton = document.getElementById('playButton');
const skinOptions = document.getElementById('skinOptions');

// Load saved player name from localStorage
const savedPlayerName = localStorage.getItem('playerName');
if (savedPlayerName) {
    nameInput.value = savedPlayerName;
}

// Preload skin image
function preloadSkinImage(filename) {
    if (!filename || filename === 'none' || preloadedSkins.has(filename)) {
        return;
    }

    const img = new Image();
    img.onload = () => {
        skinImages[filename] = img;
        preloadedSkins.add(filename);
    };
    img.onerror = () => {
        console.error(`Failed to load skin: ${filename}`);
        preloadedSkins.add(filename); // Mark as attempted
    };
    img.src = `/skins/${filename}`;
}

// Load available skins
async function loadAvailableSkins() {
    try {
        const response = await fetch('/api/skins');
        const skins = await response.json();

        const skinLoader = document.getElementById('skinLoader');
        skinLoader.remove();

        skins.forEach(skin => {
            const option = document.createElement('div');
            option.className = 'skin-option';
            option.dataset.skin = skin.filename;

            const preview = document.createElement('div');
            preview.className = 'skin-preview';
            preview.style.backgroundImage = `url('/skins/${skin.filename}')`;

            const label = document.createElement('div');
            label.className = 'skin-label';
            label.textContent = skin.name;

            option.appendChild(preview);
            option.appendChild(label);
            skinOptions.appendChild(option);

            // Preload skin images in background
            preloadSkinImage(skin.filename);
        });

        // Select "Random Color" by default
        document.querySelector('.skin-option[data-skin="none"]').classList.add('selected');
    } catch (error) {
        console.error('Error loading skins:', error);
    }
}

// Handle skin selection
skinOptions.addEventListener('click', (e) => {
    const option = e.target.closest('.skin-option');
    if (!option) return;

    // Remove previous selection
    document.querySelectorAll('.skin-option').forEach(opt => {
        opt.classList.remove('selected');
    });

    // Add selection to clicked option
    option.classList.add('selected');
    selectedSkin = option.dataset.skin;

    // Show/hide color picker for custom color option
    const colorPickerContainer = document.getElementById('colorPickerContainer');
    if (selectedSkin === 'custom') {
        colorPickerContainer.style.display = 'block';
    } else {
        colorPickerContainer.style.display = 'none';
    }
});

// Handle color picker changes
const colorPicker = document.getElementById('colorPicker');
const customColorPreview = document.getElementById('customColorPreview');

colorPicker.addEventListener('input', (e) => {
    customColor = e.target.value;
    customColorPreview.style.background = customColor;
});

// Initialize custom color preview
customColorPreview.style.background = customColor;

// Load skins when page loads
loadAvailableSkins();

function setupSocketListeners() {
    socket.on('init', (data) => {
        players = data.players;
        food = data.food;
        pellets = data.pellets || [];
        map = data.map;
        me = players[socket.id];
    });

    socket.on('update', (data) => {
        players = data.players;
        food = data.food;
        pellets = data.pellets || [];
        if (players[socket.id]) {
            me = players[socket.id];
        }
    });

    socket.on('player-joined', (player) => {
        players[player.id] = player;
    });

    socket.on('player-left', (id) => {
        delete players[id];
    });

    socket.on('player-eaten', ({ eatenId }) => {
        if (eatenId === socket.id) {
            // You were eaten - show countdown and auto-refresh
            showDeathScreen();
        }
    });

    // Handle server announcements
    socket.on('announcement', (announcement) => {
        const announcementDiv = document.getElementById('serverAnnouncement');
        const announcementText = document.getElementById('announcementText');

        if (announcement.enabled && announcement.message) {
            announcementText.textContent = announcement.message;
            announcementDiv.style.display = 'block';
        } else {
            announcementDiv.style.display = 'none';
        }
    });
}

// Death screen with countdown and auto-refresh
function showDeathScreen() {
    const deathOverlay = document.getElementById('deathOverlay');
    const countdownEl = document.getElementById('countdown');

    // Disconnect socket
    if (socket) {
        socket.disconnect();
    }

    // Show death overlay
    deathOverlay.style.display = 'flex';

    // Countdown from 3 to 0
    let countdown = 3;
    countdownEl.textContent = countdown;

    const countdownInterval = setInterval(() => {
        countdown--;
        if (countdown > 0) {
            countdownEl.textContent = countdown;
        } else {
            clearInterval(countdownInterval);
            // Reload the page
            window.location.reload();
        }
    }, 1000);
}

function startGame() {
    const playerName = nameInput.value.trim();

    // Save player name to localStorage
    localStorage.setItem('playerName', playerName);

    // Connect to server
    socket = io();

    // Set up socket event listeners
    setupSocketListeners();

    // Send player name and skin after connection is established
    socket.on('connect', () => {
        socket.emit('set-name', playerName);

        // Send skin and custom color if applicable
        if (selectedSkin === 'custom') {
            socket.emit('set-skin', selectedSkin, customColor);
        } else {
            socket.emit('set-skin', selectedSkin);
        }
    });

    nameOverlay.style.display = 'none';
    gameStarted = true;
}

playButton.addEventListener('click', startGame);
nameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        startGame();
    }
});

// Helper function to darken a color
function darkenColor(color, percent = 0.3) {
    const num = parseInt(color.replace('#', ''), 16);
    const r = Math.max(0, Math.floor((num >> 16) * (1 - percent)));
    const g = Math.max(0, Math.floor(((num >> 8) & 0x00FF) * (1 - percent)));
    const b = Math.max(0, Math.floor((num & 0x0000FF) * (1 - percent)));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function drawPlayer(player) {
    const borderColor = darkenColor(player.color, 0.3);
    const hasSkin = player.skin && player.skin !== 'none';

    // Preload skin if not already loaded
    if (hasSkin && !preloadedSkins.has(player.skin)) {
        preloadSkinImage(player.skin);
    }

    // Draw each blob for this player
    player.blobs.forEach((blob, index) => {
        const borderWidth = Math.max(3, blob.radius * 0.08);

        // Draw border
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, blob.radius, 0, Math.PI * 2);
        ctx.fillStyle = borderColor;
        ctx.fill();
        ctx.closePath();

        if (hasSkin && skinImages[player.skin] && skinImages[player.skin].complete) {
            // Draw image skin - only if preloaded and ready
            const img = skinImages[player.skin];

            // Save context
            ctx.save();

            // Create circular clipping path
            ctx.beginPath();
            ctx.arc(blob.x, blob.y, blob.radius - borderWidth, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();

            // Draw image to fill the circle
            const size = (blob.radius - borderWidth) * 2;
            ctx.drawImage(
                img,
                blob.x - size / 2,
                blob.y - size / 2,
                size,
                size
            );

            // Restore context
            ctx.restore();
        } else {
            // Draw solid color blob (no skin or skin loading)
            ctx.beginPath();
            ctx.arc(blob.x, blob.y, blob.radius - borderWidth, 0, Math.PI * 2);
            ctx.fillStyle = player.color;
            ctx.fill();
            ctx.closePath();
        }

        // Draw player name with white text, black outline, and shadow
        // Show name on all blobs if player has a name
        if (player.name) {
            const fontSize = Math.max(10, Math.min(30, blob.radius * 0.4));
            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Draw subtle shadow backdrop
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;

            // Draw black outline
            ctx.strokeStyle = '#000';
            ctx.lineWidth = Math.max(2, fontSize * 0.15);
            ctx.strokeText(player.name, blob.x, blob.y);

            // Reset shadow for white text
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            // Draw white text
            ctx.fillStyle = '#fff';
            ctx.fillText(player.name, blob.x, blob.y);
        }
    });
}

function drawFood(f) {
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
    ctx.fillStyle = f.color;
    ctx.fill();
    ctx.closePath();
}

function drawPellet(p) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.closePath();
}

// Throttle leaderboard updates
let lastLeaderboardUpdate = 0;
const LEADERBOARD_UPDATE_INTERVAL = 500; // Update every 500ms

function updateLeaderboard() {
    const now = Date.now();
    if (now - lastLeaderboardUpdate < LEADERBOARD_UPDATE_INTERVAL) {
        return;
    }
    lastLeaderboardUpdate = now;

    const leaderboardList = document.getElementById('leaderboardList');

    // Calculate total mass for each player (all their blobs combined)
    const playersWithMass = Object.values(players).map(player => {
        const totalArea = player.blobs.reduce((sum, blob) => sum + Math.PI * blob.radius * blob.radius, 0);
        return { ...player, totalMass: totalArea };
    });

    const sortedPlayers = playersWithMass.sort((a, b) => b.totalMass - a.totalMass).slice(0, 10);

    leaderboardList.innerHTML = sortedPlayers.map((player, index) => {
        const isYou = socket && player.id === socket.id;
        const youFlag = isYou ? ' <strong>(You)</strong>' : '';
        const displayName = player.name || 'Unnamed Player';
        return `<li>${displayName}${youFlag}</li>`;
    }).join('');
}

// Helper to check if object is in viewport
function isInViewport(x, y, radius, viewLeft, viewRight, viewTop, viewBottom) {
    return x + radius >= viewLeft &&
           x - radius <= viewRight &&
           y + radius >= viewTop &&
           y - radius <= viewBottom;
}

function draw() {
    if (!me) {
        requestAnimationFrame(draw);
        return;
    }

    // Calculate center of all player's blobs
    const centerX = me.blobs.reduce((sum, blob) => sum + blob.x, 0) / me.blobs.length;
    const centerY = me.blobs.reduce((sum, blob) => sum + blob.y, 0) / me.blobs.length;

    // Clear and translate canvas
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2 - centerX, canvas.height / 2 - centerY);

    // Calculate visible area in world coordinates with padding
    const padding = 100; // Extra padding to avoid pop-in
    const viewLeft = centerX - canvas.width / 2 - padding;
    const viewRight = centerX + canvas.width / 2 + padding;
    const viewTop = centerY - canvas.height / 2 - padding;
    const viewBottom = centerY + canvas.height / 2 + padding;

    // Draw infinite grid pattern (batched for performance)
    const isDarkMode = document.body.classList.contains('dark-mode');
    ctx.strokeStyle = isDarkMode ? '#333' : '#ddd';
    ctx.lineWidth = 1;

    const gridSize = 50;

    // Calculate grid starting positions (use modulo for infinite tiling)
    const startX = Math.floor(viewLeft / gridSize) * gridSize;
    const startY = Math.floor(viewTop / gridSize) * gridSize;

    // Batch all grid lines into one path for better performance
    ctx.beginPath();

    // Draw vertical lines
    for (let x = startX; x <= viewRight; x += gridSize) {
        ctx.moveTo(x, viewTop);
        ctx.lineTo(x, viewBottom);
    }

    // Draw horizontal lines
    for (let y = startY; y <= viewBottom; y += gridSize) {
        ctx.moveTo(viewLeft, y);
        ctx.lineTo(viewRight, y);
    }

    ctx.stroke();

    // Draw game objects (only if in viewport)
    food.forEach(f => {
        if (isInViewport(f.x, f.y, f.radius, viewLeft, viewRight, viewTop, viewBottom)) {
            drawFood(f);
        }
    });

    pellets.forEach(p => {
        if (isInViewport(p.x, p.y, p.radius, viewLeft, viewRight, viewTop, viewBottom)) {
            drawPellet(p);
        }
    });

    for (const id in players) {
        const player = players[id];
        // Check if any blob is in viewport
        const hasVisibleBlob = player.blobs.some(blob =>
            isInViewport(blob.x, blob.y, blob.radius, viewLeft, viewRight, viewTop, viewBottom)
        );
        if (hasVisibleBlob) {
            drawPlayer(player);
        }
    }

    // Update leaderboard
    updateLeaderboard();

    requestAnimationFrame(draw);
}

draw();

canvas.addEventListener('mousemove', (e) => {
    if (!me || !gameStarted || !socket) return;
    const rect = canvas.getBoundingClientRect();

    // Calculate center of all player's blobs
    const centerX = me.blobs.reduce((sum, blob) => sum + blob.x, 0) / me.blobs.length;
    const centerY = me.blobs.reduce((sum, blob) => sum + blob.y, 0) / me.blobs.length;

    const target = {
        x: e.clientX - rect.left - (canvas.width / 2) + centerX,
        y: e.clientY - rect.top - (canvas.height / 2) + centerY,
    };
    socket.emit('mousemove', target);
});

// Handle keyboard inputs
window.addEventListener('keydown', (e) => {
    if (!me || !gameStarted || !socket) return;

    if (e.key === 'w' || e.key === 'W') {
        socket.emit('eject-mass');
    } else if (e.key === ' ') {
        e.preventDefault(); // Prevent page scroll
        socket.emit('split');
    }
});

// Authentication UI
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/user');
        const data = await response.json();

        const authLinks = document.getElementById('authLinks');
        const userDisplay = document.getElementById('userDisplay');

        if (data.authenticated && data.user) {
            // User is logged in
            authLinks.style.display = 'none';
            userDisplay.style.display = 'block';
            document.getElementById('userEmail').textContent = data.user.email;
            document.getElementById('userCoins').textContent = `${data.user.coins} 🪙`;
        } else {
            // User is not logged in
            authLinks.style.display = 'block';
            userDisplay.style.display = 'none';
        }
    } catch (error) {
        // If error, show login links
        document.getElementById('authLinks').style.display = 'block';
        document.getElementById('userDisplay').style.display = 'none';
    }
}

// Logout handler
const logoutButton = document.getElementById('logoutButton');
if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
        try {
            await fetch('/api/logout', { method: 'POST' });
            window.location.reload();
        } catch (error) {
            console.error('Logout failed:', error);
        }
    });
}

// Check auth status on page load
checkAuthStatus();

// Update coin balance periodically
setInterval(checkAuthStatus, 30000); // Update every 30 seconds
