const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let socket = null;

let players = {};
let food = {};
let pellets = [];
let map = { width: 2000, height: 2000 };
let me = null;
let gameStarted = false;

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

// Handle name input
const nameOverlay = document.getElementById('nameOverlay');
const nameInput = document.getElementById('nameInput');
const playButton = document.getElementById('playButton');

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
            // You were eaten
            alert("You were eaten!");
            socket.disconnect();
            document.body.innerHTML = '<h1>Game Over. Refresh to play again.</h1>';
        }
    });
}

function startGame() {
    const playerName = nameInput.value.trim() || 'Anonymous';

    // Connect to server
    socket = io();

    // Set up socket event listeners
    setupSocketListeners();

    // Send player name after connection is established
    socket.on('connect', () => {
        socket.emit('set-name', playerName);
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

    // Draw each blob for this player
    player.blobs.forEach((blob, index) => {
        const borderWidth = Math.max(3, blob.radius * 0.08);

        // Draw border
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, blob.radius, 0, Math.PI * 2);
        ctx.fillStyle = borderColor;
        ctx.fill();
        ctx.closePath();

        // Draw main blob (slightly smaller to show border)
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, blob.radius - borderWidth, 0, Math.PI * 2);
        ctx.fillStyle = player.color;
        ctx.fill();
        ctx.closePath();

        // Draw player name with white text, black outline, and shadow
        // Only show name on the first/largest blob
        if (index === 0 && player.name) {
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

function updateLeaderboard() {
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
        return `<li>${player.name}${youFlag}</li>`;
    }).join('');
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

    // Draw grid
    ctx.strokeStyle = '#ddd';
    for (let x = 0; x <= map.width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, map.height);
        ctx.stroke();
    }
    for (let y = 0; y <= map.height; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(map.width, y);
        ctx.stroke();
    }

    // Draw game objects
    food.forEach(drawFood);
    pellets.forEach(drawPellet);
    for (const id in players) {
        drawPlayer(players[id]);
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
