require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic Testing Route
app.get('/', (req, res) => {
    res.json({ message: 'Welcome to the Raagam Core API Platform', status: 'Active' });
});

app.get('/api/health', (req, res) => {
    res.json({ db: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected', uptime: process.uptime() });
});

// Import and Use Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/user', require('./src/routes/user'));
app.use('/api/spotify', require('./src/routes/spotify'));
app.use('/api/scrape', require('./src/routes/scrape'));

// Start Server Immediately
app.listen(PORT, () => {
    console.log(`Raagam Backend Server running on port ${PORT}`);
});

// Database Connection in background
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/raagam')
    .then(() => console.log('MongoDB successfully connected.'))
    .catch(err => console.error('Database connection failed:', err));

