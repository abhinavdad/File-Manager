const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'users.txt');
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, '');
}

function logUser(userId) {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    const users = data.split(',').map(u => u.trim()).filter(u => u);
    if (!users.includes(userId.toString())) {
        users.push(userId.toString());
        fs.writeFileSync(USERS_FILE, users.join(','));
        return true;
    }
    return false;
}

/**
 * Encrypt a set of IDs using Bitmask to handle concurrent public usage safely
 * @param {number[]} ids - List of message IDs
 * @param {string} passcode - 4 digit passcode
 * @param {string} secretKey - Secret phrase
 */
function encryptPayload(ids, passcode, secretKey) {
    const key = crypto.createHash('sha256').update(secretKey).digest();
    const iv = crypto.randomBytes(16);
    
    const pc = parseInt(passcode || '0000');
    const baseId = Math.min(...ids);
    
    // We use a 64-bit mask (BigInt in JS) to represent which IDs are present
    // relative to the baseID.
    let mask = 0n;
    for (const id of ids) {
        const offset = BigInt(id - baseId);
        if (offset < 64n) {
            mask |= (1n << offset);
        }
    }

    // Payload: [passcode (2), baseId (4), mask (8)] = 14 bytes
    const payload = Buffer.alloc(14);
    payload.writeUInt16BE(pc, 0);
    payload.writeUInt32BE(baseId, 2);
    payload.writeBigUInt64BE(mask, 6);

    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
    
    return Buffer.concat([iv, encrypted]).toString('base64url');
}

/**
 * Decrypt bitmask back to specific IDs
 */
function decryptPayload(data, secretKey) {
    try {
        const key = crypto.createHash('sha256').update(secretKey).digest();
        const buffer = Buffer.from(data, 'base64url');
        
        const iv = buffer.slice(0, 16);
        const encrypted = buffer.slice(16);
        
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        
        const passcode = decrypted.readUInt16BE(0).toString().padStart(4, '0');
        const baseId = decrypted.readUInt32BE(2);
        const mask = decrypted.readBigUInt64BE(6);
        
        const ids = [];
        for (let i = 0; i < 64; i++) {
            if ((mask & (1n << BigInt(i))) !== 0n) {
                ids.push(baseId + i);
            }
        }
        
        return { ids, passcode: passcode === '0000' ? null : passcode };
    } catch (e) {
        return null;
    }
}

module.exports = { logUser, encryptPayload, decryptPayload };
