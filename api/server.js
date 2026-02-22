require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const Message = require('./models/Message');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI && MONGODB_URI !== 'your_mongodb_atlas_uri_here') {
    mongoose.connect(MONGODB_URI)
        .then(() => console.log('✅ Connected to MongoDB Atlas'))
        .catch(err => {
            console.error('❌ MongoDB connection error:', err.message);
            console.log('💡 Check your MONGODB_URI in .env file');
        });
} else {
    console.log('⚠️  MONGODB_URI not set — add it to your .env file');
    console.log('💡 The app will start but messages won\'t persist until MongoDB is configured');
}

// ─── API Routes ───────────────────────────────────────────

// GET /api/messages - Get all messages
app.get('/api/messages', async (req, res) => {
    try {
        const messages = await Message.find()
            .sort({ timestamp: 1 })
            .lean();

        // Group messages by user for backward compatibility
        const userMap = {};
        messages.forEach(msg => {
            if (!userMap[msg.username]) {
                userMap[msg.username] = [];
            }
            userMap[msg.username].push({
                username: msg.username,
                content: msg.content,
                timestamp: msg.timestamp.getTime(),
                formatted_time: msg.timestamp.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                _id: msg._id,
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

// POST /api/send - Send a message
app.post('/api/send', async (req, res) => {
    try {
        const { username, message } = req.body;

        if (!username || !message) {
            return res.status(400).json({
                success: false,
                error: 'Missing username or message'
            });
        }

        const newMessage = await Message.create({
            username: username.trim(),
            content: message.trim(),
        });

        res.json({
            success: true,
            message: 'Message sent successfully',
            data: newMessage,
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ success: false, error: 'Failed to send message' });
    }
});

// POST /api/clear - Clear all messages
app.post('/api/clear', async (req, res) => {
    try {
        await Message.deleteMany({});
        res.json({ success: true, message: 'All data cleared successfully' });
    } catch (error) {
        console.error('Error clearing data:', error);
        res.status(500).json({ success: false, error: 'Failed to clear data' });
    }
});

// GET /api/stats - Get chat statistics
app.get('/api/stats', async (req, res) => {
    try {
        const totalMessages = await Message.countDocuments();
        const users = await Message.distinct('username');
        const avgQueueSize = users.length > 0
            ? Math.round(totalMessages / users.length)
            : 0;

        res.json({
            totalMessages,
            totalUsers: users.length,
            avgQueueSize,
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
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
        console.log(`📦 Database: MongoDB Atlas`);
        console.log(`⚡ Press Ctrl+C to stop\n`);
    });
}

// Export for Vercel serverless
module.exports = app;
