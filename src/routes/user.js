const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware to protect routes
const auth = (req, res, next) => {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).json({ error: 'No token, authorization denied' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded.userId;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Token is not valid' });
    }
};

// GET: /api/user/profile
router.get('/profile', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user).select('-password');
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// PUT: /api/user/profile
router.put('/profile', auth, async (req, res) => {
    try {
        const { username, age, gender, preferredLanguages, favoriteArtists } = req.body;
        
        let user = await User.findById(req.user);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (username) user.username = username;
        if (age) user.age = age;
        if (gender) user.gender = gender;
        if (preferredLanguages) user.preferredLanguages = preferredLanguages;
        if (favoriteArtists) user.favoriteArtists = favoriteArtists;

        await user.save();
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Server update error' });
    }
});

const { db } = require('../config/firebase-admin');

// POST: /api/user/like
// Toggles a song in the user's liked array
router.post('/like', auth, async (req, res) => {
    try {
        const { song, isLiked } = req.body;
        const userRef = db.collection('users').doc(req.user);
        
        if (isLiked) {
             // Save full song object into a 'liked_songs' subcollection or handle logic
             await userRef.collection('liked_songs').doc(song.id).set({
                 ...song,
                 likedAt: new Date().toISOString()
             });
        } else {
             await userRef.collection('liked_songs').doc(song.id).delete();
        }
        res.json({ success: true, isLiked });
    } catch (err) {
        console.error("Like Error", err);
        res.status(500).json({ error: 'Failed to toggle like' });
    }
});

// POST: /api/user/playlist
router.post('/playlist', auth, async (req, res) => {
    try {
        const { name, description } = req.body;
        const newPlaylist = await db.collection('playlists').add({
            name,
            description: description || '',
            userId: req.user,
            songs: [],
            createdAt: new Date().toISOString()
        });
        res.json({ id: newPlaylist.id, success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create playlist' });
    }
});

module.exports = router;
