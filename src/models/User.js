const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    age: {
        type: Number,
        default: null
    },
    gender: {
        type: String,
        enum: ['Male', 'Female', 'Diverse', 'Other', ''],
        default: ''
    },
    preferredLanguages: [{
        type: String
    }],
    favoriteArtists: [{
        type: String // We will store Artist IDs or Strings
    }],
    profileImage: {
        type: String,
        default: ''
    },
    isPremium: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
