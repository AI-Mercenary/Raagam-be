const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const playdl = require('play-dl');
const axios = require('axios');
const cheerio = require('cheerio');
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
        const url = `https://www.youtube.com/watch?v=${id}`;
        console.log(`[STREAM] Extracting: ${id}`);

        // Provider 1: @distube/ytdl-core (pure Node.js, no binary)
        try {
            const info = await ytdl.getInfo(url);
            const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
            if (format?.url) {
                console.log(`[P1 SUCCESS] Got stream via ytdl-core`);
                return res.json({ title: info.videoDetails.title, streamUrl: format.url, expiryInMs: 0 });
            }
        } catch (e) { console.warn(`[P1 FAIL] ytdl-core: ${e.message}`); }

        // Provider 2: play-dl (pure Node.js, no binary)
        try {
            const streamInfo = await playdl.stream(url, { quality: 2 });
            const ytInfo = await playdl.video_info(url);
            if (streamInfo?.stream) {
                // play-dl gives us a readable stream — we need the URL from video_info
                const audioFormat = ytInfo?.format?.find(f => f.mimeType?.includes('audio'));
                if (audioFormat?.url) {
                    console.log(`[P2 SUCCESS] Got stream via play-dl`);
                    return res.json({ title: ytInfo.video_details.title, streamUrl: audioFormat.url, expiryInMs: 0 });
                }
            }
        } catch (e) { console.warn(`[P2 FAIL] play-dl: ${e.message}`); }

        // Provider 3: Public Invidious Instance API
        try {
            const instances = ['https://invidious.tiekoetter.com', 'https://invidious.projectsegfau.lt', 'https://yt.artemislena.eu'];
            for (const instance of instances) {
                try {
                    const data = await axios.get(`${instance}/api/v1/videos/${id}`, { timeout: 5000 });
                    const fmt = data.data?.adaptiveFormats?.find(f => f.type?.includes('audio/webm') || f.type?.includes('audio/mp4'))
                              || data.data?.formatStreams?.[0];
                    if (fmt?.url) {
                        console.log(`[P3 SUCCESS] Got stream via ${instance}`);
                        return res.json({ title: data.data.title || id, streamUrl: fmt.url, expiryInMs: 0 });
                    }
                } catch (_) {}
            }
        } catch (e) { console.warn(`[P3 FAIL] Invidious: ${e.message}`); }

        throw new Error('All stream providers exhausted.');
    } catch (err) {
        console.error('[STREAM CRITICAL]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Diagnostic Route
router.get('/debug/status', async (req, res) => {
    res.json({ time: new Date().toISOString(), nodeVersion: process.version, platform: process.platform, status: 'ok' });
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
