const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let socket = null;

let players = {};
let food = {};
let pellets = [];
let coinDrops = [];
let map = { width: 2000, height: 2000 };
let me = null;
let gameStarted = false;
let selectedSkin = 'none'; // Track selected skin
let customColor = '#ff6b6b'; // Track custom color selection
let skinImages = {}; // Cache loaded skin images
let preloadedSkins = new Set(); // Track which skins have been preloaded
let isUserAuthenticated = false; // Track authentication state for toast notifications

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
        // Check authentication status
        let userAuthenticated = false;
        let ownedSkins = new Set();

        try {
            const userResponse = await fetch('/api/user');
            const userData = await userResponse.json();

            if (userData.authenticated && userData.user) {
                userAuthenticated = true;

                // Fetch owned skins
                const skinsResponse = await fetch('/api/user/skins');
                const skinsData = await skinsResponse.json();
                ownedSkins = new Set(skinsData.skins);
            }
        } catch (error) {
            // User not authenticated, continue as guest
            userAuthenticated = false;
        }

        const skinLoader = document.getElementById('skinLoader');
        skinLoader.remove();

        // Show/hide account promo based on authentication
        const accountPromo = document.getElementById('accountPromo');
        if (accountPromo) {
            if (userAuthenticated) {
                accountPromo.style.display = 'none';
            } else {
                accountPromo.style.display = 'block';
            }
        }

        // For guests: remove custom color option, only allow random color
        if (!userAuthenticated) {
            const customColorOption = document.querySelector('.skin-option[data-skin="custom"]');
            if (customColorOption) {
                customColorOption.remove();
            }
        }

        // Only load skins if user is authenticated
        if (userAuthenticated) {
            const response = await fetch('/api/skins');
            const skins = await response.json();

            // Only show skins that the user owns
            skins.forEach(skin => {
                if (ownedSkins.has(skin.filename)) {
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
                }
            });
        }

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
        coinDrops = data.coinDrops || [];
        map = data.map;
        me = players[socket.id];
    });

    socket.on('update', (data) => {
        players = data.players;
        food = data.food;
        pellets = data.pellets || [];
        coinDrops = data.coinDrops || [];
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

    // Handle coin collection with animation
    socket.on('coin-collected', ({ amount }) => {
        const userCoinsEl = document.getElementById('userCoins');
        if (userCoinsEl) {
            // Parse current coin amount
            const currentText = userCoinsEl.textContent;
            const currentCoins = parseInt(currentText.match(/\d+/)?.[0] || '0');
            const newCoins = currentCoins + amount;

            // Update the coin display
            userCoinsEl.textContent = `${newCoins} 🪙`;

            // Add animation class
            userCoinsEl.classList.add('coin-increase');

            // Create floating +amount indicator
            const indicator = document.createElement('div');
            indicator.className = 'coin-indicator';
            indicator.textContent = `+${amount}`;
            userCoinsEl.parentElement.appendChild(indicator);

            // Remove animation class after animation completes
            setTimeout(() => {
                userCoinsEl.classList.remove('coin-increase');
            }, 500);

            // Remove floating indicator after animation
            setTimeout(() => {
                indicator.remove();
            }, 1000);
        }
    });

    // Handle coin collection for non-authenticated users
    socket.on('coin-collected-guest', ({ amount }) => {
        showGuestCoinToast(amount);
    });

    // Handle chat messages
    socket.on('chat-message', ({ username, message, isSystem }) => {
        addChatMessage(username, message, isSystem);
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
    
    // Focus chat input when game starts
    setTimeout(() => {
        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
            chatInput.focus();
        }
    }, 200);
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

function drawCoinDrop(coin) {
    // Draw 💰 emoji
    const fontSize = coin.radius * 2.5;
    ctx.font = `${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💰', coin.x, coin.y);
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

    coinDrops.forEach(coin => {
        if (isInViewport(coin.x, coin.y, coin.radius, viewLeft, viewRight, viewTop, viewBottom)) {
            drawCoinDrop(coin);
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

// Throttle mousemove events for smoother performance
let lastMouseUpdate = 0;
const MOUSE_UPDATE_INTERVAL = 16; // ~60 FPS max (16ms between updates)
let pendingMouseTarget = null;
let mouseUpdateTimeout = null;

function calculateMouseTarget(e) {
    const rect = canvas.getBoundingClientRect();
    
    // Use the latest player data from the players object (more reliable than 'me')
    const currentPlayer = players[socket.id];
    if (!currentPlayer || !currentPlayer.blobs || currentPlayer.blobs.length === 0) {
        // Fallback to 'me' if players object doesn't have our data yet
        if (!me || !me.blobs || me.blobs.length === 0) return null;
        const centerX = me.blobs.reduce((sum, blob) => sum + blob.x, 0) / me.blobs.length;
        const centerY = me.blobs.reduce((sum, blob) => sum + blob.y, 0) / me.blobs.length;
        return {
            x: e.clientX - rect.left - (canvas.width / 2) + centerX,
            y: e.clientY - rect.top - (canvas.height / 2) + centerY,
        };
    }
    
    // Calculate center of all player's blobs using latest data
    const centerX = currentPlayer.blobs.reduce((sum, blob) => sum + blob.x, 0) / currentPlayer.blobs.length;
    const centerY = currentPlayer.blobs.reduce((sum, blob) => sum + blob.y, 0) / currentPlayer.blobs.length;

    return {
        x: e.clientX - rect.left - (canvas.width / 2) + centerX,
        y: e.clientY - rect.top - (canvas.height / 2) + centerY,
    };
}

function sendPendingMouseUpdate() {
    if (pendingMouseTarget && socket && gameStarted) {
        socket.emit('mousemove', pendingMouseTarget);
        pendingMouseTarget = null;
    }
    mouseUpdateTimeout = null;
}

canvas.addEventListener('mousemove', (e) => {
    if (!me || !gameStarted || !socket) return;
    
    const target = calculateMouseTarget(e);
    if (!target) return;
    
    const now = Date.now();
    
    // Always update pending target with latest position
    pendingMouseTarget = target;
    
    // Send immediately if enough time has passed
    if (now - lastMouseUpdate >= MOUSE_UPDATE_INTERVAL) {
        lastMouseUpdate = now;
        sendPendingMouseUpdate();
    } else {
        // Schedule a delayed send if not already scheduled
        if (!mouseUpdateTimeout) {
            const delay = MOUSE_UPDATE_INTERVAL - (now - lastMouseUpdate);
            mouseUpdateTimeout = setTimeout(sendPendingMouseUpdate, delay);
        }
    }
});

// Handle keyboard inputs
window.addEventListener('keydown', (e) => {
    if (!me || !gameStarted || !socket) return;

    const chatInput = document.getElementById('chatInput');
    
    // Escape key toggles chat mode
    if (e.key === 'Escape') {
        if (chatMode) {
            // Exit chat mode - clear input and return to game mode
            chatMode = false;
            if (chatInput) {
                chatInput.value = '';
                updateChatModeIndicator();
            }
        } else {
            // Enter chat mode
            chatMode = true;
            if (chatInput) {
                chatInput.focus();
                updateChatModeIndicator();
            }
        }
        e.preventDefault();
        return;
    }
    
    // In chat mode: Space and W are for typing
    // In game mode: Space and W are for game controls
    if (!chatMode) {
        // Game mode - handle game controls
        if (e.key === 'w' || e.key === 'W') {
            socket.emit('eject-mass');
        } else if (e.key === ' ') {
            e.preventDefault(); // Prevent page scroll
            socket.emit('split');
        }
    }
    // If in chat mode, let the input handle Space and W normally
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
            isUserAuthenticated = true;
            authLinks.style.display = 'none';
            userDisplay.style.display = 'block';
            document.getElementById('userEmail').textContent = data.user.email;
            document.getElementById('userCoins').textContent = `${data.user.coins} 🪙`;
        } else {
            // User is not logged in
            isUserAuthenticated = false;
            authLinks.style.display = 'block';
            userDisplay.style.display = 'none';
        }
    } catch (error) {
        // If error, assume not authenticated
        isUserAuthenticated = false;
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

// Chat System
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const chatMessages = document.getElementById('chatMessages');
const chatToggle = document.getElementById('chatToggle');
const chat = document.getElementById('chat');

let chatCollapsed = false;
let chatMode = false; // Track if player is in chat typing mode
const MAX_CHAT_MESSAGES = 50;

// Toggle chat collapse
if (chatToggle) {
    chatToggle.addEventListener('click', () => {
        chatCollapsed = !chatCollapsed;
        if (chatCollapsed) {
            chat.classList.add('collapsed');
            chatToggle.textContent = '+';
            chatMode = false;
            updateChatModeIndicator();
        } else {
            chat.classList.remove('collapsed');
            chatToggle.textContent = '−';
            // Don't auto-focus - let user press Escape to enter chat mode
        }
    });
}

// Send chat message
function sendChatMessage() {
    if (!socket || !gameStarted) return;
    
    const message = chatInput.value.trim();
    if (!message) return;
    
    // Limit message length
    if (message.length > 100) {
        chatInput.value = message.substring(0, 100);
        return;
    }
    
    // Send message to server
    socket.emit('chat-message', { message });
    
    // Clear input and exit chat mode
    chatInput.value = '';
    chatMode = false;
    updateChatModeIndicator();
}

// Add chat message to display
function addChatMessage(username, message, isSystem = false) {
    if (!chatMessages) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    
    if (isSystem) {
        messageDiv.className += ' chat-message-system';
        messageDiv.textContent = message;
    } else {
        const usernameSpan = document.createElement('span');
        usernameSpan.className = 'chat-message-username';
        usernameSpan.textContent = username + ':';
        
        const textSpan = document.createElement('span');
        textSpan.className = 'chat-message-text';
        textSpan.textContent = ' ' + message;
        
        messageDiv.appendChild(usernameSpan);
        messageDiv.appendChild(textSpan);
    }
    
    chatMessages.appendChild(messageDiv);
    
    // Limit number of messages
    while (chatMessages.children.length > MAX_CHAT_MESSAGES) {
        chatMessages.removeChild(chatMessages.firstChild);
    }
    
    // Auto-scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Update chat mode indicator
function updateChatModeIndicator() {
    const chatHeader = document.getElementById('chatHeader');
    if (!chatHeader) return;
    
    let indicator = document.getElementById('chatModeIndicator');
    if (!indicator) {
        indicator = document.createElement('span');
        indicator.id = 'chatModeIndicator';
        indicator.style.cssText = 'font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: normal; flex-shrink: 0;';
        // Insert before the toggle button
        const toggle = document.getElementById('chatToggle');
        if (toggle && toggle.parentNode) {
            toggle.parentNode.insertBefore(indicator, toggle);
        } else {
            chatHeader.appendChild(indicator);
        }
    }
    
    if (chatMode) {
        indicator.textContent = 'CHAT MODE';
        indicator.style.backgroundColor = '#4CAF50';
        indicator.style.color = 'white';
        if (chatInput) {
            chatInput.style.borderColor = '#4CAF50';
            chatInput.style.boxShadow = '0 0 0 2px rgba(76, 175, 80, 0.2)';
        }
    } else {
        indicator.textContent = 'GAME MODE';
        indicator.style.backgroundColor = '#999';
        indicator.style.color = 'white';
        if (chatInput) {
            chatInput.style.borderColor = '#ddd';
            chatInput.style.boxShadow = 'none';
        }
    }
}

// Chat input handlers
if (chatInput && chatSend) {
    // Don't auto-focus - let players toggle with Escape
    // Only focus when explicitly entering chat mode
    
    // Track when user starts typing to automatically enter chat mode
    chatInput.addEventListener('input', (e) => {
        if (e.target.value.length > 0 && !chatMode) {
            chatMode = true;
            updateChatModeIndicator();
        } else if (e.target.value.length === 0 && chatMode) {
            // Auto-exit chat mode when input is cleared
            chatMode = false;
            updateChatModeIndicator();
        }
    });
    
    // Focus chat input when entering chat mode
    function focusChatIfInMode() {
        if (chatMode && chatInput && gameStarted && !chatCollapsed) {
            if (document.activeElement !== chatInput) {
                chatInput.focus();
            }
        }
    }
    
    // Periodically check if we should focus (only in chat mode)
    setInterval(focusChatIfInMode, 500);
    
    // Re-focus after sending a message (only if in chat mode)
    chatSend.addEventListener('click', () => {
        sendChatMessage();
        if (chatMode) {
            setTimeout(() => {
                if (chatInput) chatInput.focus();
            }, 10);
        }
    });
    
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage();
            // After sending, stay in chat mode if user wants to type more
            if (chatMode) {
                setTimeout(() => {
                    if (chatInput) chatInput.focus();
                }, 10);
            }
        }
    });
    
    // Handle Escape key in chat input
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            chatMode = false;
            chatInput.value = '';
            updateChatModeIndicator();
            e.preventDefault();
            e.stopPropagation();
        } else if (e.key === 'Enter') {
            e.stopPropagation(); // Prevent game from handling Enter
        }
    });
    
    // Initialize chat mode indicator
    updateChatModeIndicator();
}

// Show toast notification for guest users who collect coins
function showGuestCoinToast(amount) {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) {
        return;
    }

    // Double-check authentication status before showing toast
    const userDisplay = document.getElementById('userDisplay');
    const authLinks = document.getElementById('authLinks');
    
    // If userDisplay is visible, user is authenticated - don't show toast
    if (userDisplay && userDisplay.style.display !== 'none' && userDisplay.style.display !== '') {
        return;
    }
    
    // Also check the isUserAuthenticated flag
    if (isUserAuthenticated) {
        return;
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <div class="toast-icon">💰</div>
        <div class="toast-content">
            <div class="toast-title">Coin Collected!</div>
            <div class="toast-message">
                You collected ${amount} coins, but you're not logged in. Create a free account to keep your coins and buy skins!
            </div>
            <div class="toast-actions">
                <a href="/register.html" class="toast-button">Create Free Account</a>
                <a href="/login.html" class="toast-button">Login</a>
            </div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;

    // Add to container
    toastContainer.appendChild(toast);

    // Auto-remove after 8 seconds
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 300);
    }, 8000);
}
