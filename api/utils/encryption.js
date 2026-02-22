/**
 * Encryption utility for chat messages.
 * Messages are encrypted with AES-256 before storing in MongoDB,
 * so even a database admin cannot read the raw content.
 *
 * The ENCRYPTION_KEY is stored in .env and NEVER committed to git.
 */

const CryptoJS = require('crypto-js');

// Fallback key (only used if env var is missing — should always be set in production)
const SECRET_KEY = process.env.ENCRYPTION_KEY || 'ChatApp-Logger-Default-Secret-Key-2026';

/**
 * Encrypt plaintext message content.
 * @param {string} plaintext  - The readable message
 * @returns {string}          - AES-256 encrypted ciphertext (Base64)
 */
function encrypt(plaintext) {
    if (!plaintext) return '';
    return CryptoJS.AES.encrypt(plaintext, SECRET_KEY).toString();
}

/**
 * Decrypt ciphertext back to readable message.
 * @param {string} ciphertext - The encrypted string from the database
 * @returns {string}          - Original readable message
 */
function decrypt(ciphertext) {
    if (!ciphertext) return '';
    try {
        const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);
        return decrypted || '[decryption failed]';
    } catch (err) {
        console.error('Decryption error:', err.message);
        return '[decryption failed]';
    }
}

module.exports = { encrypt, decrypt };
