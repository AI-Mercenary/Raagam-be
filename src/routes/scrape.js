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

        // Use yt-search biased toward YouTube Music Topic channels
        const result = await yts(`${q} music topic`);
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
    const { id } = req.params;
    console.log(`[STREAM] Extracting: ${id}`);

    // Piped API instances — open-source YouTube proxy, no bot detection
    const pipedInstances = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.adminforge.de',
        'https://piped-api.garudalinux.org',
        'https://api.piped.yt',
    ];

    for (const instance of pipedInstances) {
        try {
            const { data } = await axios.get(`${instance}/streams/${id}`, {
                timeout: 8000,
                headers: { 'Referer': 'https://music.youtube.com/' }
            });
            const audio = data?.audioStreams?.sort((a, b) => b.bitrate - a.bitrate)?.[0];
            if (audio?.url) {
                console.log(`[SUCCESS] Stream via ${instance}`);
                return res.json({ title: data.title || id, streamUrl: audio.url, expiryInMs: 0 });
            }
        } catch (e) {
            console.warn(`[FAIL] ${instance}: ${e.message}`);
        }
    }

    // Last resort: Invidious instances
    const invidiousInstances = [
        'https://invidious.tiekoetter.com',
        'https://invidious.projectsegfau.lt',
        'https://invidious.privacyredirect.com',
    ];

    for (const instance of invidiousInstances) {
        try {
            const { data } = await axios.get(`${instance}/api/v1/videos/${id}`, { timeout: 6000 });
            const fmt = data?.adaptiveFormats?.find(f => f.type?.includes('audio'))
                      || data?.formatStreams?.[0];
            if (fmt?.url) {
                console.log(`[SUCCESS] Stream via ${instance}`);
                return res.json({ title: data.title || id, streamUrl: fmt.url, expiryInMs: 0 });
            }
        } catch (e) {
            console.warn(`[FAIL] ${instance}: ${e.message}`);
        }
    }


    console.error('[STREAM] All providers exhausted for:', id);
    res.status(500).json({ error: 'Could not extract stream from any provider' });
});

// Diagnostic Route
router.get('/debug/status', async (req, res) => {
    // Quick test of primary piped instance
    try {
        const test = await axios.get('https://pipedapi.kavin.rocks/streams/dQw4w9WgXcQ', { timeout: 5000 });
        const ok = !!test.data?.audioStreams?.length;
        res.json({ time: new Date().toISOString(), pipedWorking: ok, platform: process.platform });
    } catch(e) {
        res.json({ time: new Date().toISOString(), pipedWorking: false, error: e.message });
    }
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
