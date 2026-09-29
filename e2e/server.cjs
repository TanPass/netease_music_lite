/* 迷你静态服务器：跑 E2E 用
 *   ① 把 .tmp-e2e/mock.html 与上一级的 userscript 用 http:// 提供出来
 *      （file:// 下 new URL(相对路径) 的行为和真实站点不一样，而且 localStorage 常常受限）
 *   ② POST /__report 收下页面里的测试报告，落成 report.json
 * 用法：node .tmp-e2e/server.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const PORT = 8791;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__report') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      fs.writeFileSync(path.join(DIR, 'report.json'), body);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      console.log('REPORT SAVED ' + body.length + ' bytes');
    });
    return;
  }

  const clean = req.url.split('?')[0];
  const name = clean === '/' ? 'mock.html' : clean.slice(1);
  let target = path.join(DIR, name);
  if (!fs.existsSync(target)) target = path.join(DIR, '..', name);   // userscript 在上一级
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found: ' + name);
    return;
  }
  res.writeHead(200, {
    'Content-Type': /\.js$/.test(name) ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(fs.readFileSync(target));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('mock server: http://127.0.0.1:' + PORT + '/mock.html');
});
