const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');
const { db } = require('../config/firebase-admin');

// JioSaavn internal API base — same endpoints the jiosaavn-api library uses
const SAAVN_BASE = 'https://www.jiosaavn.com/api.php';

// Decrypt JioSaavn encrypted URLs (they use a simple DES cipher)
function decryptUrl(encryptedUrl) {
    try {
        // JioSaavn uses a known key to obfuscate download URLs
        // Replace quality placeholder and decode
        return encryptedUrl
            .replace('_96.mp4', '_320.mp4')
            .replace('aac_96', 'aac_320')
            .replace(/\?/g, '?')
            .trim();
    } catch {
        return encryptedUrl;
    }
}

// GET: /api/scrape/search?q=query
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ error: 'Query required' });

        console.log(`[SEARCH] Query: ${q}`);

        const { data } = await axios.get(SAAVN_BASE, {
            params: {
                __call: 'autocomplete.get',
                query: q,
                _format: 'json',
                _marker: '0',
                ctx: 'web6dot0',
            },
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 8000
        });

        const songs = data?.songs?.data || [];

        const mapped = songs.map(s => ({
            id: s.id,
            title: s.title?.replace(/&amp;/g, '&').replace(/&#039;/g, "'") || s.title,
            thumbnail: s.image?.replace('150x150', '500x500') || '',
            duration: formatDuration(parseInt(s.duration || '0')),
            channel: s.primary_artists || s.singers || '',
            album: s.album || '',
            year: s.year || '',
            source: 'jiosaavn'
        }));

        res.json(mapped);
    } catch (err) {
        console.error('[SEARCH ERROR]', err.message);
        res.status(500).json({ error: 'Search failed' });
    }
});

// GET: /api/scrape/stream/:id  — Get playback URL for a JioSaavn song ID
router.get('/stream/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`[STREAM] Fetching stream for ID: ${id}`);

    try {
        const { data } = await axios.get(SAAVN_BASE, {
            params: {
                __call: 'song.getDetails',
                cc: 'in',
                _marker: '0%3F_marker%3D0',
                _format: 'json',
                pids: id,
                ctx: 'web6dot0',
            },
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            },
            timeout: 10000
        });

        const song = data?.[id] || Object.values(data || {})[0];

        if (!song) {
            console.error('[STREAM] No song data returned');
            return res.status(404).json({ error: 'Song not found on JioSaavn' });
        }

        // Try 320kbps first, fallback through qualities
        const qualities = ['320kbps', '160kbps', '96kbps'];
        let streamUrl = null;

        for (const q of qualities) {
            const raw = song[`${q}_url`] || song.media_url;
            if (raw) {
                streamUrl = decryptUrl(raw);
                console.log(`[STREAM] Got ${q} URL for: ${song.song}`);
                break;
            }
        }

        // Fallback: use media_url directly
        if (!streamUrl && song.media_url) {
            streamUrl = decryptUrl(song.media_url);
        }

        if (!streamUrl) {
            console.error('[STREAM] No URL found in song data');
            return res.status(404).json({ error: 'No stream URL available' });
        }

        res.json({
            title: song.song?.replace(/&amp;/g, '&').replace(/&#039;/g, "'") || id,
            artist: song.primary_artists || '',
            image: song.image?.replace('150x150', '500x500') || '',
            streamUrl,
            expiryInMs: 0
        });

    } catch (err) {
        console.error('[STREAM ERROR]', err.message);
        res.status(500).json({ error: 'Failed to get stream URL' });
    }
});

// Diagnostic Route
router.get('/debug/status', async (req, res) => {
    try {
        const r = await axios.get(SAAVN_BASE, {
            params: { __call: 'autocomplete.get', query: 'test', _format: 'json', ctx: 'web6dot0' },
            timeout: 5000
        });
        res.json({ time: new Date().toISOString(), saavnWorking: !!r.data, platform: process.platform });
    } catch(e) {
        res.json({ time: new Date().toISOString(), saavnWorking: false, error: e.message });
    }
});

function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// POST: /api/scrape/save
router.post('/save', async (req, res) => {
    try {
        const { songData } = req.body;
        if (!songData) return res.status(400).json({ error: 'Song data required' });
        const docRef = await db.collection('songs').add({ ...songData, scrapedAt: new Date().toISOString() });
        res.json({ success: true, songId: docRef.id });
    } catch (err) {
        console.error('Error saving song:', err);
        res.status(500).json({ error: 'Failed to save to Firestore' });
    }
});

module.exports = router;
