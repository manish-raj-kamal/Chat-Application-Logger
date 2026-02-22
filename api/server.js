require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const Chat = require('./models/Message');
const User = require('./models/User');
const { encrypt, decrypt } = require('./utils/encryption');

const app = express();
const PORT = process.env.PORT || 8080;
const MAX_QUEUE_SIZE = 10; // FIFO queue: keep last 10 messages per user

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Connect to MongoDB (database: ChatLogger)
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI && MONGODB_URI !== 'your_mongodb_atlas_uri_here') {
    mongoose.connect(MONGODB_URI, { dbName: 'ChatLogger' })
        .then(() => console.log('✅ Connected to MongoDB Atlas (ChatLogger)'))
        .catch(err => {
            console.error('❌ MongoDB connection error:', err.message);
            console.log('💡 Check your MONGODB_URI in .env file');
        });
} else {
    console.log('⚠️  MONGODB_URI not set — add it to your .env file');
    console.log('💡 The app will start but messages won\'t persist until MongoDB is configured');
}

// ─── API Routes ───────────────────────────────────────────

// GET /api/messages - Get all messages (decrypted for the client)
app.get('/api/messages', async (req, res) => {
    try {
        const chats = await Chat.find()
            .sort({ timestamp: 1 })
            .lean();

        // Decrypt messages and group by user
        const userMap = {};
        chats.forEach(chat => {
            if (!userMap[chat.username]) {
                userMap[chat.username] = [];
            }
            userMap[chat.username].push({
                username: chat.username,
                content: decrypt(chat.content),  // ← Decrypted for display
                timestamp: chat.timestamp.getTime(),
                formatted_time: chat.timestamp.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                _id: chat._id,
            });
        });

        const users = Object.keys(userMap).map(username => ({
            username,
            messages: userMap[username],
        }));

        res.json({ users });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// POST /api/send - Send a message (encrypted before storage)
app.post('/api/send', async (req, res) => {
    try {
        const { username, message } = req.body;

        if (!username || !message) {
            return res.status(400).json({
                success: false,
                error: 'Missing username or message'
            });
        }

        const trimmedUser = username.trim();
        const trimmedMsg = message.trim();

        // Upsert user in the Users collection
        await User.findOneAndUpdate(
            { username: trimmedUser },
            { $set: { lastActive: new Date() } },
            { upsert: true, new: true }
        );

        // Encrypt the message content before storing
        const encryptedContent = encrypt(trimmedMsg);

        // Create the new chat message
        await Chat.create({
            username: trimmedUser,
            content: encryptedContent,  // ← Stored encrypted in DB
        });

        // ── FIFO Queue enforcement: keep only last MAX_QUEUE_SIZE per user ──
        const userMessageCount = await Chat.countDocuments({ username: trimmedUser });

        if (userMessageCount > MAX_QUEUE_SIZE) {
            // Find the oldest messages that exceed the queue limit
            const excessCount = userMessageCount - MAX_QUEUE_SIZE;
            const oldestMessages = await Chat.find({ username: trimmedUser })
                .sort({ timestamp: 1 })
                .limit(excessCount)
                .select('_id');

            const idsToDelete = oldestMessages.map(m => m._id);
            await Chat.deleteMany({ _id: { $in: idsToDelete } });
        }

        res.json({
            success: true,
            message: 'Message sent successfully',
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ success: false, error: 'Failed to send message' });
    }
});

// POST /api/clear - Clear all messages
app.post('/api/clear', async (req, res) => {
    try {
        await Chat.deleteMany({});
        res.json({ success: true, message: 'All data cleared successfully' });
    } catch (error) {
        console.error('Error clearing data:', error);
        res.status(500).json({ success: false, error: 'Failed to clear data' });
    }
});

// GET /api/stats - Get chat statistics
app.get('/api/stats', async (req, res) => {
    try {
        const totalMessages = await Chat.countDocuments();
        const users = await Chat.distinct('username');
        const avgQueueSize = users.length > 0
            ? Math.round(totalMessages / users.length)
            : 0;

        res.json({
            totalMessages,
            totalUsers: users.length,
            avgQueueSize,
            maxQueueSize: MAX_QUEUE_SIZE,
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// GET /api/download/:username - Download last 10 messages for a user as readable text
app.get('/api/download/:username', async (req, res) => {
    try {
        const username = req.params.username;

        const chats = await Chat.find({ username })
            .sort({ timestamp: 1 })
            .lean();

        if (chats.length === 0) {
            return res.status(404).json({ error: 'No messages found for this user' });
        }

        // Build readable text format (decrypted)
        let text = `════════════════════════════════════════════\n`;
        text += `  Chat Log for: ${username}\n`;
        text += `  Downloaded: ${new Date().toLocaleString()}\n`;
        text += `  Messages: ${chats.length} (last ${MAX_QUEUE_SIZE} in queue)\n`;
        text += `════════════════════════════════════════════\n\n`;

        chats.forEach((chat, i) => {
            const time = new Date(chat.timestamp).toLocaleString();
            const decryptedContent = decrypt(chat.content);
            text += `[${time}] ${chat.username}:\n`;
            text += `  ${decryptedContent}\n\n`;
        });

        text += `════════════════════════════════════════════\n`;
        text += `  End of Chat Log\n`;
        text += `════════════════════════════════════════════\n`;

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="chat_${username}_${new Date().toISOString().slice(0, 10)}.txt"`);
        res.send(text);
    } catch (error) {
        console.error('Error downloading messages:', error);
        res.status(500).json({ error: 'Failed to download messages' });
    }
});

// GET /api/download-all - Download entire conversation as readable text
app.get('/api/download-all', async (req, res) => {
    try {
        const chats = await Chat.find()
            .sort({ timestamp: 1 })
            .lean();

        if (chats.length === 0) {
            return res.status(404).json({ error: 'No messages found' });
        }

        const usernames = [...new Set(chats.map(c => c.username))];

        let text = `════════════════════════════════════════════\n`;
        text += `  Chat App Logger — Full Conversation\n`;
        text += `  Downloaded: ${new Date().toLocaleString()}\n`;
        text += `  Participants: ${usernames.join(', ')}\n`;
        text += `  Total Messages: ${chats.length}\n`;
        text += `════════════════════════════════════════════\n\n`;

        chats.forEach(chat => {
            const time = new Date(chat.timestamp).toLocaleString();
            const decryptedContent = decrypt(chat.content);
            text += `[${time}] ${chat.username}: ${decryptedContent}\n`;
        });

        text += `\n════════════════════════════════════════════\n`;
        text += `  End of Chat Log\n`;
        text += `════════════════════════════════════════════\n`;

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="chat_all_${new Date().toISOString().slice(0, 10)}.txt"`);
        res.send(text);
    } catch (error) {
        console.error('Error downloading messages:', error);
        res.status(500).json({ error: 'Failed to download messages' });
    }
});

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Catch-all for SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start server (only when not on Vercel)
if (process.env.VERCEL !== '1') {
    app.listen(PORT, () => {
        console.log(`\n🚀 Chat App Logger v2.0`);
        console.log(`🌐 Server running at: http://localhost:${PORT}`);
        console.log(`📦 Database: ChatLogger (MongoDB Atlas)`);
        console.log(`🔒 Message encryption: AES-256`);
        console.log(`📨 Queue size: ${MAX_QUEUE_SIZE} messages per user`);
        console.log(`⚡ Press Ctrl+C to stop\n`);
    });
}

// Export for Vercel serverless
module.exports = app;
