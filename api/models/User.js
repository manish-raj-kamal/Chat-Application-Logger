const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    lastActive: {
        type: Date,
        default: Date.now,
    },
}, {
    collection: 'Users',   // Maps to your existing "Users" collection
    timestamps: false,
});

userSchema.index({ username: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
