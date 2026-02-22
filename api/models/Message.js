const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  from: {
    type: String,
    required: true,
  },
  fromName: {
    type: String,
    required: true,
  },
  fromAvatar: {
    type: String,
    default: '',
  },
  to: {
    type: String,
    required: true,       // 'global' or recipient email
  },
  toName: {
    type: String,
    default: '',
  },
  content: {
    type: String,         // AES-256 encrypted ciphertext
    required: true,
  },
  chatType: {
    type: String,
    enum: ['global', 'private'],
    default: 'global',
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
}, {
  collection: 'Chats',
  timestamps: false,
});

chatSchema.index({ chatType: 1, timestamp: 1 });
chatSchema.index({ from: 1, to: 1, timestamp: 1 });

module.exports = mongoose.model('Chat', chatSchema);
