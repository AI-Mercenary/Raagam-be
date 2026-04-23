const express = require('express');
const router = express.Router();
const axios = require('axios');
const qs = require('qs');

let spotifyAccessToken = '';
let tokenExpirationTime = 0;

// Middleware to Ensure we have a valid Spotify Access Token
const getSpotifyToken = async (req, res, next) => {
    try {
        if (Date.now() < tokenExpirationTime && spotifyAccessToken) {
            return next();
        }
        
        // Fetch new token via Client Credentials Flow
        const authString = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
        
        const response = await axios.post('https://accounts.spotify.com/api/token', 
            qs.stringify({ grant_type: 'client_credentials' }),
            {
                headers: {
                    'Authorization': `Basic ${authString}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        spotifyAccessToken = response.data.access_token;
        // Expire slightly before the actual 3600s expiration
        tokenExpirationTime = Date.now() + (response.data.expires_in - 60) * 1000;
        console.log("Spotify Token Refreshed!");
        next();
    } catch (err) {
        console.error('Spotify Auth Error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to authenticate with Spotify API' });
    }
};

// GET: /api/spotify/search?q=query
router.get('/search', getSpotifyToken, async (req, res) => {
    try {
        const { q, type = 'track,artist', limit = 20 } = req.query;
        if (!q) return res.status(400).json({ error: 'Missing search query params' });

        const response = await axios.get(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`, {
            headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
        });

        res.json(response.data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch tracks from Spotify' });
    }
});

// GET: /api/spotify/artist/:id
router.get('/artist/:id', getSpotifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const [artistInfo, topTracks] = await Promise.all([
            axios.get(`https://api.spotify.com/v1/artists/${id}`, { headers: { 'Authorization': `Bearer ${spotifyAccessToken}` } }),
            axios.get(`https://api.spotify.com/v1/artists/${id}/top-tracks?market=IN`, { headers: { 'Authorization': `Bearer ${spotifyAccessToken}` } })
        ]);

        res.json({
            artist: artistInfo.data,
            topTracks: topTracks.data.tracks
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch artist details' });
    }
});

// GET: /api/spotify/categories
router.get('/categories', getSpotifyToken, async (req, res) => {
    try {
        const response = await axios.get(`https://api.spotify.com/v1/browse/categories?country=IN&limit=20`, {
            headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
        });
        res.json(response.data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

// POST: /api/spotify/playlist/search — resolve a list of song names to YouTube IDs
// Body: { songs: ["Song Name - Artist", ...], name: "Playlist name" }
router.post('/playlist/search', async (req, res) => {
    try {
        const { songs, name } = req.body;
        if (!songs || !Array.isArray(songs) || songs.length === 0) {
            return res.status(400).json({ error: 'songs array required' });
        }

        const yts = require('yt-search');
        const VIDEO_KEYWORDS = ['official video', 'music video', 'lyric video', 'trailer', 'concert', 'live'];

        const resolved = await Promise.all(
            songs.slice(0, 30).map(async (songQuery) => {
                try {
                    const r = await yts({ query: songQuery + ' song audio', hl: 'en', gl: 'IN' });
                    const v = r.videos.find(v =>
                        v.seconds > 30 &&
                        v.seconds < 600 &&
                        !VIDEO_KEYWORDS.some(kw => v.title.toLowerCase().includes(kw))
                    );
                    if (!v) return null;
                    return {
                        title: v.title,
                        artist: v.author.name,
                        image: v.thumbnail,
                        ytId: v.videoId,
                        duration: v.timestamp
                    };
                } catch { return null; }
            })
        );

        const tracks = resolved.filter(Boolean);
        res.json({ name: name || 'Imported Playlist', tracks });
    } catch (err) {
        console.error('Playlist search error:', err.message);
        res.status(500).json({ error: 'Failed to resolve tracks' });
    }
});

module.exports = router;
