const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true,
  },
  content: {
    type: String,
    required: true,
    trim: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

// Index for efficient querying by timestamp
messageSchema.index({ timestamp: 1 });
messageSchema.index({ username: 1, timestamp: 1 });

module.exports = mongoose.model('Message', messageSchema);
