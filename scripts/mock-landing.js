// Tiny mock server to preview public/landing.html with a fake /api/public.
const http = require('http');
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const PORT = 8899;

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/public') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      ok: true, bot: 'SAQIB-MD', prefix: '.', owner: 'Saqib',
      number: '923106762478', connected: 3, total: 27, referralGoal: 10,
    }));
  }
  let file = url === '/' ? 'landing.html' : url.replace(/^\//, '');
  const fp = path.join(PUB, file);
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    const ext = path.extname(fp);
    const type = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : 'application/octet-stream';
    res.setHeader('Content-Type', type);
    return res.end(fs.readFileSync(fp));
  }
  res.statusCode = 404; res.end('not found');
}).listen(PORT, () => console.log('mock landing on http://127.0.0.1:' + PORT));
