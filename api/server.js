require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const Chat = require('./models/Message');
const User = require('./models/User');
const { encrypt, decrypt } = require('./utils/encryption');

const app = express();
const PORT = process.env.PORT || 8080;
const MAX_QUEUE_SIZE = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'chatapp-jwt-fallback-secret-2026';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Middleware
app.use(cors());
app.use(express.json());

// Required for Google Identity Services popup flow
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// Connect to MongoDB (database: ChatLogger)
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI && MONGODB_URI !== 'your_mongodb_atlas_uri_here') {
    mongoose.connect(MONGODB_URI, { dbName: 'ChatLogger' })
        .then(async () => {
            console.log('✅ Connected to MongoDB Atlas (ChatLogger)');

            // Drop legacy indexes from old schema (username_1 etc.)
            try {
                const usersCollection = mongoose.connection.db.collection('Users');
                const indexes = await usersCollection.indexes();
                const legacyIndexes = indexes.filter(idx =>
                    idx.key && idx.key.username !== undefined && idx.name !== '_id_'
                );
                for (const idx of legacyIndexes) {
                    await usersCollection.dropIndex(idx.name);
                    console.log(`🧹 Dropped legacy index: ${idx.name}`);
                }
            } catch (e) {
                // Index might not exist, that's fine
                if (!e.message.includes('not found')) {
                    console.log('Index cleanup note:', e.message);
                }
            }
        })
        .catch(err => {
            console.error('❌ MongoDB connection error:', err.message);
        });
} else {
    console.log('⚠️  MONGODB_URI not set');
}

// ─── Auth Middleware ──────────────────────────────────────
function auth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    try {
        const token = header.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// Expose Google Client ID to frontend
app.get('/api/config', (req, res) => {
    res.json({ googleClientId: GOOGLE_CLIENT_ID || '' });
});

// ─── Google Auth ──────────────────────────────────────────
app.post('/api/auth/google', async (req, res) => {
    try {
        const { credential } = req.body;
        if (!credential) {
            console.error('Auth: No credential in request body');
            return res.status(400).json({ error: 'Missing credential' });
        }

        if (!GOOGLE_CLIENT_ID) {
            console.error('Auth: GOOGLE_CLIENT_ID env var is not set');
            return res.status(500).json({ error: 'Server misconfigured: missing GOOGLE_CLIENT_ID' });
        }

        console.log('Auth: Verifying Google token (audience:', GOOGLE_CLIENT_ID.slice(0, 15) + '...)');

        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        console.log('Auth: Token verified for', payload.email);

        // Upsert user
        const user = await User.findOneAndUpdate(
            { googleId: payload.sub },
            {
                googleId: payload.sub,
                email: payload.email,
                name: payload.name,
                avatar: payload.picture || '',
                lastActive: new Date(),
            },
            { upsert: true, new: true }
        );

        // Create session JWT
        const token = jwt.sign(
            {
                userId: user._id.toString(),
                email: user.email,
                name: user.name,
                avatar: user.avatar,
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: {
                email: user.email,
                name: user.name,
                avatar: user.avatar,
            },
        });
    } catch (error) {
        console.error('Google auth error:', error.message);
        console.error('Full error:', error);
        res.status(401).json({ error: 'Google authentication failed: ' + error.message });
    }
});

// ─── Users ────────────────────────────────────────────────
app.get('/api/users', auth, async (req, res) => {
    try {
        const users = await User.find({}, 'email name avatar lastActive').lean();
        res.json({ users });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// ─── Messages ─────────────────────────────────────────────

// GET /api/messages?chatType=global|private&with=email&since=timestamp
app.get('/api/messages', auth, async (req, res) => {
    try {
        const { chatType = 'global', with: withUser, since } = req.query;
        const userEmail = req.user.email;

        let query = {};

        if (chatType === 'global') {
            query.chatType = 'global';
        } else if (chatType === 'private' && withUser) {
            query.chatType = 'private';
            query.$or = [
                { from: userEmail, to: withUser },
                { from: withUser, to: userEmail },
            ];
        } else {
            return res.json({ messages: [] });
        }

        if (since) {
            query.timestamp = { $gt: new Date(parseInt(since)) };
        }

        const chats = await Chat.find(query)
            .sort({ timestamp: 1 })
            .lean();

        const messages = chats.map(chat => ({
            _id: chat._id,
            from: chat.from,
            fromName: chat.fromName,
            fromAvatar: chat.fromAvatar,
            to: chat.to,
            toName: chat.toName,
            content: decrypt(chat.content),
            chatType: chat.chatType,
            timestamp: chat.timestamp.getTime(),
        }));

        res.json({ messages });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// POST /api/send
app.post('/api/send', auth, async (req, res) => {
    try {
        const { message, to, chatType = 'global' } = req.body;
        const userEmail = req.user.email;
        const userName = req.user.name;
        const userAvatar = req.user.avatar || '';

        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message is empty' });
        }

        const encryptedContent = encrypt(message.trim());

        let toName = '';
        let toField = 'global';

        if (chatType === 'private' && to) {
            const recipient = await User.findOne({ email: to });
            toName = recipient ? recipient.name : to;
            toField = to;
        }

        const newChat = await Chat.create({
            from: userEmail,
            fromName: userName,
            fromAvatar: userAvatar,
            to: toField,
            toName,
            content: encryptedContent,
            chatType,
        });

        // ── FIFO Queue: keep last MAX_QUEUE_SIZE per conversation ──
        let countQuery;
        if (chatType === 'global') {
            countQuery = { chatType: 'global' };
        } else {
            countQuery = {
                chatType: 'private',
                $or: [
                    { from: userEmail, to: toField },
                    { from: toField, to: userEmail },
                ],
            };
        }

        const count = await Chat.countDocuments(countQuery);
        if (count > MAX_QUEUE_SIZE) {
            const excess = count - MAX_QUEUE_SIZE;
            const oldest = await Chat.find(countQuery)
                .sort({ timestamp: 1 })
                .limit(excess)
                .select('_id');
            await Chat.deleteMany({ _id: { $in: oldest.map(m => m._id) } });
        }

        res.json({
            success: true,
            message: {
                _id: newChat._id,
                from: userEmail,
                fromName: userName,
                fromAvatar: userAvatar,
                to: toField,
                toName,
                content: message.trim(),
                chatType,
                timestamp: newChat.timestamp.getTime(),
            },
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// POST /api/clear
app.post('/api/clear', auth, async (req, res) => {
    try {
        const { chatType = 'global', with: withUser } = req.body;
        const userEmail = req.user.email;

        let query;
        if (chatType === 'global') {
            query = { chatType: 'global' };
        } else if (chatType === 'private' && withUser) {
            query = {
                chatType: 'private',
                $or: [
                    { from: userEmail, to: withUser },
                    { from: withUser, to: userEmail },
                ],
            };
        } else {
            return res.status(400).json({ error: 'Invalid clear request' });
        }

        await Chat.deleteMany(query);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to clear' });
    }
});

// GET /api/stats
app.get('/api/stats', auth, async (req, res) => {
    try {
        const totalMessages = await Chat.countDocuments();
        const userCount = await User.countDocuments();
        const globalCount = await Chat.countDocuments({ chatType: 'global' });

        res.json({
            totalMessages,
            totalUsers: userCount,
            globalMessages: globalCount,
            maxQueueSize: MAX_QUEUE_SIZE,
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ─── Download Endpoints ───────────────────────────────────

// Download current chat as readable .txt
app.get('/api/download', auth, async (req, res) => {
    try {
        const { chatType = 'global', with: withUser } = req.query;
        const userEmail = req.user.email;

        let query = {};
        let chatLabel = 'Global Chat';

        if (chatType === 'global') {
            query.chatType = 'global';
        } else if (chatType === 'private' && withUser) {
            query.chatType = 'private';
            query.$or = [
                { from: userEmail, to: withUser },
                { from: withUser, to: userEmail },
            ];
            chatLabel = `DM with ${withUser}`;
        }

        const chats = await Chat.find(query).sort({ timestamp: 1 }).lean();

        if (chats.length === 0) {
            return res.status(404).json({ error: 'No messages to download' });
        }

        let text = `${'═'.repeat(50)}\n`;
        text += `  ChatApp Logger — ${chatLabel}\n`;
        text += `  Downloaded: ${new Date().toLocaleString()}\n`;
        text += `  Messages: ${chats.length} (max ${MAX_QUEUE_SIZE} in queue)\n`;
        text += `  Encryption: AES-256 (decrypted for download)\n`;
        text += `${'═'.repeat(50)}\n\n`;

        chats.forEach(chat => {
            const time = new Date(chat.timestamp).toLocaleString();
            const content = decrypt(chat.content);
            text += `[${time}] ${chat.fromName}:\n`;
            text += `  ${content}\n\n`;
        });

        text += `${'═'.repeat(50)}\n`;
        text += `  End of Chat Log\n`;
        text += `${'═'.repeat(50)}\n`;

        const filename = chatType === 'global'
            ? `global_chat_${new Date().toISOString().slice(0, 10)}.txt`
            : `dm_${withUser}_${new Date().toISOString().slice(0, 10)}.txt`;

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(text);
    } catch (error) {
        res.status(500).json({ error: 'Download failed' });
    }
});

// ─── Serve Frontend ───────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────
if (process.env.VERCEL !== '1') {
    app.listen(PORT, () => {
        console.log(`\n🚀 Chat App Logger v2.0`);
        console.log(`🌐 http://localhost:${PORT}`);
        console.log(`📦 Database: ChatLogger (MongoDB Atlas)`);
        console.log(`🔒 Encryption: AES-256`);
        console.log(`🔑 Auth: Google OAuth 2.0`);
        console.log(`📨 Queue: ${MAX_QUEUE_SIZE} msgs/conversation`);
        console.log(`⚡ Press Ctrl+C to stop\n`);
    });
}

module.exports = app;
