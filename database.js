const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const db = new Database(path.join(__dirname, 'game.db'));

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database tables
function initializeDatabase() {
    // Users table
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            coins INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Skin prices table
    db.exec(`
        CREATE TABLE IF NOT EXISTS skin_prices (
            filename TEXT PRIMARY KEY,
            price INTEGER NOT NULL,
            for_sale BOOLEAN DEFAULT 1,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // User skin purchases table
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_skins (
            user_id INTEGER,
            filename TEXT,
            purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, filename),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    console.log('Database initialized successfully');
}

// User management functions
function createUser(email, password) {
    const passwordHash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare('INSERT INTO users (email, password_hash, coins) VALUES (?, ?, 0)');
    const result = stmt.run(email, passwordHash);
    return result.lastInsertRowid;
}

function getUserByEmail(email) {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email);
}

function getUserById(id) {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(id);
}

function verifyPassword(user, password) {
    return bcrypt.compareSync(password, user.password_hash);
}

function updateUserCoins(userId, coins) {
    const stmt = db.prepare('UPDATE users SET coins = ? WHERE id = ?');
    return stmt.run(coins, userId);
}

function addCoinsToUser(userId, amount) {
    const stmt = db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?');
    return stmt.run(amount, userId);
}

// Skin pricing functions
function setSkinPrice(filename, price, forSale = true) {
    const stmt = db.prepare(`
        INSERT INTO skin_prices (filename, price, for_sale, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(filename) DO UPDATE SET
            price = excluded.price,
            for_sale = excluded.for_sale,
            updated_at = CURRENT_TIMESTAMP
    `);
    return stmt.run(filename, price, forSale ? 1 : 0);
}

function getSkinPrice(filename) {
    const stmt = db.prepare('SELECT * FROM skin_prices WHERE filename = ?');
    return stmt.get(filename);
}

function getAllSkinPrices() {
    const stmt = db.prepare('SELECT * FROM skin_prices WHERE for_sale = 1');
    return stmt.all();
}

function removeSkinPrice(filename) {
    const stmt = db.prepare('DELETE FROM skin_prices WHERE filename = ?');
    return stmt.run(filename);
}

// User skin ownership functions
function purchaseSkin(userId, filename, price) {
    const user = getUserById(userId);
    if (!user || user.coins < price) {
        return { success: false, error: 'Insufficient coins' };
    }

    // Check if already owned
    if (userOwnsSkin(userId, filename)) {
        return { success: false, error: 'Skin already owned' };
    }

    try {
        // Start transaction
        const deductCoins = db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?');
        const addSkin = db.prepare('INSERT INTO user_skins (user_id, filename) VALUES (?, ?)');

        const transaction = db.transaction(() => {
            deductCoins.run(price, userId);
            addSkin.run(userId, filename);
        });

        transaction();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function userOwnsSkin(userId, filename) {
    const stmt = db.prepare('SELECT * FROM user_skins WHERE user_id = ? AND filename = ?');
    return !!stmt.get(userId, filename);
}

function getUserSkins(userId) {
    const stmt = db.prepare('SELECT filename FROM user_skins WHERE user_id = ?');
    return stmt.all(userId).map(row => row.filename);
}

function getAllUsers() {
    const stmt = db.prepare('SELECT id, email, coins, created_at FROM users');
    return stmt.all();
}

// Initialize database on module load
initializeDatabase();

module.exports = {
    db,
    createUser,
    getUserByEmail,
    getUserById,
    verifyPassword,
    updateUserCoins,
    addCoinsToUser,
    setSkinPrice,
    getSkinPrice,
    getAllSkinPrices,
    removeSkinPrice,
    purchaseSkin,
    userOwnsSkin,
    getUserSkins,
    getAllUsers
};
