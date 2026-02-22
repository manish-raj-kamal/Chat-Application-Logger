const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true,
  },
  content: {
    type: String,       // Stored as AES-256 encrypted ciphertext
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
}, {
  collection: 'Chats',    // Maps to your existing "Chats" collection
  timestamps: false,
});

// Indexes for efficient querying
chatSchema.index({ timestamp: 1 });
chatSchema.index({ username: 1, timestamp: 1 });

module.exports = mongoose.model('Chat', chatSchema);
