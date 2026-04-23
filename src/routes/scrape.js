const express = require('express');
const router = express.Router();
const axios = require('axios');
const { db } = require('../config/firebase-admin');

const SAAVN_INSTANCE = 'https://saavn.sumit.co';

// GET: /api/scrape/search?q=query
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ error: 'Query required' });

        console.log(`[JioSaavn Search] Query: ${q}`);

        const { data } = await axios.get(`${SAAVN_INSTANCE}/api/search/songs`, {
            params: { query: q, limit: 15 },
            timeout: 8000
        });

        const results = data?.data?.results || [];

        const mapped = results.map(s => ({
            id: s.id,
            title: s.name?.replace(/&amp;/g, '&').replace(/&#039;/g, "'") || s.name,
            // Get the highest resolution image (usually last in array)
            thumbnail: s.image?.length > 0 ? s.image[s.image.length - 1].url : '',
            duration: formatDuration(parseInt(s.duration || '0')),
            artist: s.artists?.primary?.map(a => a.name).join(', ') || 'Various Artists',
            album: s.album?.name || '',
            year: s.year || '',
            source: 'jiosaavn'
        }));

        res.json(mapped);
    } catch (err) {
        console.error('[SEARCH ERROR]', err.message);
        res.status(500).json({ error: 'JioSaavn Search failed' });
    }
});

// GET: /api/scrape/stream/:id
router.get('/stream/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`[JioSaavn Stream] Fetching: ${id}`);

    try {
        const { data } = await axios.get(`${SAAVN_INSTANCE}/api/songs/${id}`, {
            timeout: 8000
        });

        const song = data?.data?.[0];

        if (!song) {
            return res.status(404).json({ error: 'Song not found' });
        }

        // Get the 320kbps link (usually last in downloadUrl array)
        const downloadUrls = song.downloadUrl || [];
        const bestStream = downloadUrls.length > 0 ? downloadUrls[downloadUrls.length - 1].url : null;

        if (!bestStream) {
            return res.status(404).json({ error: 'No stream available' });
        }

        res.json({
            title: song.name?.replace(/&amp;/g, '&').replace(/&#039;/g, "'") || id,
            artist: song.artists?.primary?.map(a => a.name).join(', ') || '',
            image: song.image?.length > 0 ? song.image[song.image.length - 1].url : '',
            streamUrl: bestStream,
            expiryInMs: 0
        });

    } catch (err) {
        console.error('[STREAM ERROR]', err.message);
        res.status(500).json({ error: 'Failed to extract JioSaavn stream' });
    }
});

function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

module.exports = router;
