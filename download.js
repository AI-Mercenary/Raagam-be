const fs = require('fs');
const https = require('https');
const path = require('path');

const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${process.platform === 'darwin' ? 'yt-dlp_macos' : process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp_linux'}`;

const binDir = path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin');
const binPath = path.join(binDir, binaryName);

console.log('Downloading yt-dlp bypassing GitHub API rate limits...');

if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
}

const file = fs.createWriteStream(binPath);

https.get(downloadUrl, (response) => {
    // Follow redirect if 302
    if (response.statusCode === 302 || response.statusCode === 301) {
        https.get(response.headers.location, (res) => {
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                if (process.platform !== 'win32') {
                    fs.chmodSync(binPath, '755'); // Make it executable
                }
                console.log('Successfully downloaded yt-dlp binary!');
            });
        }).on('error', (err) => {
            fs.unlinkSync(binPath);
            console.error('Error following redirect:', err.message);
        });
    } else {
        response.pipe(file);
        file.on('finish', () => {
            file.close();
            if (process.platform !== 'win32') {
                fs.chmodSync(binPath, '755');
            }
            console.log('Successfully downloaded yt-dlp binary!');
        });
    }
}).on('error', (err) => {
    fs.unlinkSync(binPath);
    console.error('Error downloading the binary:', err.message);
});
