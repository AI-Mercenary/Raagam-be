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

    // METHOD 1: YouTube Internal Player API — Android Music Client
    // This is what the real YouTube Music app uses. No bot detection.
    try {
        const ytMusicResponse = await axios.post(
            'https://www.youtube.com/youtubei/v1/player',
            {
                videoId: id,
                context: {
                    client: {
                        clientName: 'ANDROID_MUSIC',
                        clientVersion: '5.29.52',
                        androidSdkVersion: 30,
                        hl: 'en',
                        gl: 'US'
                    }
                }
            },
            {
                params: { key: 'AIzaSyAOghZGza2MQSZkY_zfiqTmuDAFqKOf_oE' },
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'com.google.android.apps.youtube.music/5.29.52 (Linux; U; Android 11) gzip',
                    'X-YouTube-Client-Name': '21',
                    'X-YouTube-Client-Version': '5.29.52'
                },
                timeout: 10000
            }
        );

        const streamingData = ytMusicResponse.data?.streamingData;
        const formats = [
            ...(streamingData?.adaptiveFormats || []),
            ...(streamingData?.formats || [])
        ];

        // Get best audio-only stream
        const audioFormats = formats
            .filter(f => f.mimeType?.includes('audio') && f.url)
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

        if (audioFormats.length > 0) {
            const best = audioFormats[0];
            const title = ytMusicResponse.data?.videoDetails?.title || id;
            console.log(`[SUCCESS] YouTube Music internal API — ${title}`);
            return res.json({ title, streamUrl: best.url, expiryInMs: 0 });
        }
    } catch (e) {
        console.warn(`[FAIL] YT Internal API: ${e.message}`);
    }

    // METHOD 2: ANDROID client fallback (less music-specific but reliable)
    try {
        const androidResponse = await axios.post(
            'https://www.youtube.com/youtubei/v1/player',
            {
                videoId: id,
                context: {
                    client: {
                        clientName: 'ANDROID',
                        clientVersion: '17.31.35',
                        androidSdkVersion: 30
                    }
                }
            },
            {
                params: { key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w' },
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip'
                },
                timeout: 10000
            }
        );

        const formats2 = [
            ...(androidResponse.data?.streamingData?.adaptiveFormats || []),
            ...(androidResponse.data?.streamingData?.formats || [])
        ].filter(f => f.mimeType?.includes('audio') && f.url)
         .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

        if (formats2.length > 0) {
            const title = androidResponse.data?.videoDetails?.title || id;
            console.log(`[SUCCESS] YouTube Android client fallback — ${title}`);
            return res.json({ title, streamUrl: formats2[0].url, expiryInMs: 0 });
        }
    } catch (e) {
        console.warn(`[FAIL] Android fallback: ${e.message}`);
    }

    console.error('[STREAM] All providers exhausted for:', id);
    res.status(500).json({ error: 'Could not extract audio stream' });
});

// Diagnostic Route
router.get('/debug/status', async (req, res) => {
    try {
        const r = await axios.post('https://www.youtube.com/youtubei/v1/player',
            { videoId: 'dQw4w9WgXcQ', context: { client: { clientName: 'ANDROID_MUSIC', clientVersion: '5.29.52' } } },
            { params: { key: 'AIzaSyAOghZGza2MQSZkY_zfiqTmuDAFqKOf_oE' }, timeout: 5000 }
        );
        const works = !!(r.data?.streamingData?.adaptiveFormats?.length);
        res.json({ time: new Date().toISOString(), ytMusicApiWorks: works, platform: process.platform });
    } catch(e) {
        res.json({ time: new Date().toISOString(), ytMusicApiWorks: false, error: e.message });
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
