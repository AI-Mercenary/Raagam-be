const express = require('express');
const router = express.Router();
const fs = require('fs');
const yts = require('yt-search');
const youtubedl = require('youtube-dl-exec');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const { db } = require('../config/firebase-admin');

// GET: /api/scrape/search?q=query  — searches yt-dlp (audio/music focus)
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ error: 'Query required' });

        // Use yt-search (much faster and more reliable for simple search lists)
        const result = await yts(`${q} audio topic`);
        const entries = result.videos || [];
        
        const mapped = entries
            .filter(v => v.seconds > 30 && v.seconds < 600)
            .map(v => ({
                id: v.videoId,
                title: v.title,
                thumbnail: v.thumbnail || v.image,
                duration: v.timestamp,
                channel: v.author?.name || '',
                isYTMusic: (v.author?.name || '').endsWith(' - Topic')
            }))
            .sort((a, b) => (a.isYTMusic ? -1 : 1))
            .slice(0, 15);

        res.json(mapped);
    } catch (err) {
        console.error('YT Search Error:', err.message);
        res.status(500).json({ error: 'Search failed' });
    }
});

function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}



// GET: /api/scrape/stream/:id
router.get('/stream/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const binaryPath = path.join(__dirname, '../../node_modules/youtube-dl-exec/bin/yt-dlp');
        
        console.log(`[STREAM] Final attempt for ID: ${id}`);

        // Provider 1: Local Binary
        try {
            const streamInfo = await youtubedl(`https://www.youtube.com/watch?v=${id}`, {
                dumpJson: true, noCheckCertificates: true, noWarnings: true, format: 'bestaudio',
                executablePath: binaryPath
            });
            if (streamInfo?.url) return res.json({ title: streamInfo.title, streamUrl: streamInfo.url, expiryInMs: 0 });
        } catch (e) { console.warn(`P1 Fail: ${e.message}`); }

        // Provider 2: Cobalt API
        try {
            const fallback = await axios.post('https://api.cobalt.tools/api/json', {
                url: `https://www.youtube.com/watch?v=${id}`, downloadMode: 'audio', audioFormat: 'mp3'
            }, { timeout: 5000 });
            if (fallback.data?.url) return res.json({ title: `Stream_${id}`, streamUrl: fallback.data.url, expiryInMs: 0 });
        } catch (e) { console.warn(`P2 Fail: ${e.message}`); }

        // Provider 3: Backup Extraction Pipe (Simple & Direct)
        try {
            const backup = await axios.get(`https://invidious.snopyta.org/api/v1/videos/${id}`);
            const format = backup.data?.adaptiveFormats?.find(f => f.type.includes('audio')) || backup.data?.formatStreams?.[0];
            if (format?.url) return res.json({ title: backup.data.title || id, streamUrl: format.url, expiryInMs: 0 });
        } catch (e) { console.warn(`P3 Fail: ${e.message}`); }

        throw new Error('All 3 stream providers failed to extract audio.');
    } catch (err) {
        console.error('CRITICAL EXTRACTION FAILURE:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Diagnostic Route: Check server health and binary existence
router.get('/debug/status', async (req, res) => {
    const binaryPath = path.join(__dirname, '../../node_modules/youtube-dl-exec/bin/yt-dlp');
    res.json({
        time: new Date().toISOString(),
        binaryExists: fs.existsSync(binaryPath),
        nodeVersion: process.version,
        platform: process.platform
    });
});

// GET: /api/scrape/naasongs?q=movie name
router.get('/naasongs', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ error: 'Query required' });

        // Step 1: Search the site
        const searchHtml = await axios.get(`https://naasongs.com.co/?s=${encodeURIComponent(q)}`);
        const $ = cheerio.load(searchHtml.data);
        
        let albumLink = '';
        // Find the first relevant movie album link
        $('h2.entry-title a').each((i, el) => {
            if (i === 0) albumLink = $(el).attr('href');
        });

        if (!albumLink) return res.status(404).json({ error: 'Album not found on Naa Songs' });

        // Step 2: Extract direct MP3s from the Album page
        const albumHtml = await axios.get(albumLink);
        const $$ = cheerio.load(albumHtml.data);
        
        const songs = [];
        $$('audio source').each((i, el) => {
             const mp3Link = $$(el).attr('src');
             if (mp3Link) {
                 // Naa songs sometimes has poor title parsing, we try to extract it from the filename
                 const filename = mp3Link.split('/').pop().replace('.mp3', '').replace(/%20/g, ' ');
                 songs.push({
                     id: `naa_${i}`,
                     title: filename,
                     streamUrl: mp3Link,
                     source: 'naasongs'
                 });
             }
        });

        res.json({ albumUrl: albumLink, songs });
    } catch (err) {
        console.error('Naa Songs Scraper Error:', err);
        res.status(500).json({ error: 'Failed to scrape regional source' });
    }
});

// POST: /api/scrape/save
router.post('/save', async (req, res) => {
    try {
        const { songData } = req.body; 
        if (!songData) return res.status(400).json({ error: 'Song data required' });

        const docRef = await db.collection('songs').add({
            ...songData,
            scrapedAt: new Date().toISOString()
        });

        res.json({ success: true, songId: docRef.id });
    } catch (err) {
        console.error('Error saving scraped song:', err);
        res.status(500).json({ error: 'Failed to save to Firestore' });
    }
});

module.exports = router;
