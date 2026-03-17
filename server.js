const http = require('http');
const https = require('https');
const fs = require('fs');
require('dotenv').config();

const PORT = 3001;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const BASE_PATH = 'candidature';

if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
    console.error('ERRORE: Variabili d\'ambiente GITHUB_TOKEN, REPO_OWNER o REPO_NAME mancanti nel file .env');
    process.exit(1);
}

const githubRequest = (path, method = 'GET', body = null) => {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
            method: method,
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'User-Agent': 'Artemis-Backend',
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = data ? JSON.parse(data) : {};
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed);
                    } else {
                        reject({ status: res.statusCode, message: parsed.message || 'GitHub API Error' });
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
};

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/api/applications' && req.method === 'GET') {
        try {
            const file = await githubRequest(`${BASE_PATH}/data.json`);
            const content = Buffer.from(file.content, 'base64').toString('utf-8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(content);
        } catch (e) {
            if (e.status === 404) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('[]');
            } else {
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
        }
    } else if (req.url === '/api/config' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ repo: `${REPO_OWNER}/${REPO_NAME}` }));
    } else if (req.url === '/api/upload-cv' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { name, email, pos, fileBase64, fileName } = JSON.parse(body);

                // 1. Fetch current data.json
                let applications = [];
                let sha = null;
                try {
                    const file = await githubRequest(`${BASE_PATH}/data.json`);
                    sha = file.sha;
                    applications = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
                } catch (e) { if (e.status !== 404) throw e; }



                // 2. Upload PDF to GitHub
                const newId = applications.length + 1;
                const newFileName = `cv_${newId}.pdf`;
                await githubRequest(`${BASE_PATH}/${newFileName}`, 'PUT', {
                    message: `Upload CV: ${name}`,
                    content: fileBase64.split(',')[1] // remove data:application/pdf;base64,
                });

                // 3. Update data.json
                const newEntry = {
                    id: newId,
                    name,
                    email,
                    pos,
                    file: newFileName,
                    date: new Date().toLocaleDateString('it-IT')
                };
                applications.push(newEntry);

                await githubRequest(`${BASE_PATH}/data.json`, 'PUT', {
                    message: `Update applications list: ${name}`,
                    content: Buffer.from(JSON.stringify(applications, null, 2)).toString('base64'),
                    sha: sha
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, application: newEntry }));
            } catch (e) {
                console.error(e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    } else if (req.url === '/api/delete-cv' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { id, fileName } = JSON.parse(body);

                // 1. Fetch current data.json to update it
                const file = await githubRequest(`${BASE_PATH}/data.json`);
                let applications = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
                const originalSha = file.sha;

                const filteredApps = applications.filter(app => app.id !== id);

                // 2. Get SHA of the file to delete
                let fileSha = null;
                try {
                    const cvFile = await githubRequest(`${BASE_PATH}/${fileName}`);
                    fileSha = cvFile.sha;
                } catch (e) {
                    console.error('File CV non trovato su GitHub, procedo comunque con la rimozione dal JSON', e);
                }

                // 3. Delete CV file from GitHub
                if (fileSha) {
                    await githubRequest(`${BASE_PATH}/${fileName}`, 'DELETE', {
                        message: `Delete CV: ${fileName}`,
                        sha: fileSha
                    });
                }

                // 4. Update data.json
                await githubRequest(`${BASE_PATH}/data.json`, 'PUT', {
                    message: `Remove application ID: ${id}`,
                    content: Buffer.from(JSON.stringify(filteredApps, null, 2)).toString('base64'),
                    sha: originalSha
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                console.error(e);
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, () => {
    console.log(`Artemis Backend in esecuzione su http://localhost:${PORT}`);
});
