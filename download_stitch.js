const fs = require('fs');
const https = require('https');
const path = require('path');

const inputFilePath = 'C:/Users/lengz/.gemini/antigravity/brain/1ac43146-537f-430d-bc9d-61780e132e07/.system_generated/steps/12/output.txt';
const outputDir = 'k:/Luvia-Gallery/stitch-design';

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const data = JSON.parse(fs.readFileSync(inputFilePath, 'utf8'));

const download = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close(resolve);
                });
            } else if (response.statusCode === 302 || response.statusCode === 301) {
                // handle redirect
                download(response.headers.location, dest).then(resolve).catch(reject);
            } else {
                reject(`Server responded with ${response.statusCode}: ${response.statusMessage}`);
            }
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err.message);
        });
    });
};

const sanitize = (name) => name.replace(/[^a-z0-9]/gi, '_').toLowerCase();

(async () => {
    for (const screen of data.screens) {
        const title = sanitize(screen.title);
        
        if (screen.screenshot && screen.screenshot.downloadUrl) {
            console.log(`Downloading screenshot for ${title}...`);
            await download(screen.screenshot.downloadUrl, path.join(outputDir, `${title}_screenshot.png`));
        }
        
        if (screen.htmlCode && screen.htmlCode.downloadUrl) {
            console.log(`Downloading html for ${title}...`);
            const ext = screen.htmlCode.mimeType === 'text/markdown' ? 'md' : 'html';
            await download(screen.htmlCode.downloadUrl, path.join(outputDir, `${title}_code.${ext}`));
        }
    }
    console.log('All downloads completed!');
})();
