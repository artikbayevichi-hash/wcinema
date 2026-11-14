#!/usr/bin/env node
/**
 * cf-proxy.js — Cloudflare Tunnel uchun lokal "dara" (gate) proksi.
 *
 * NIMA UCHUN?
 *   cloudflared quick tunnel odatda butun Apache portini (80) ochadi — ya'ni
 *   htdocs ichidagi BARCHA ilovalar (phpMyAdmin, dashboard, boshqa loyihalar)
 *   internetga ochiq bo'lib qoladi. Bu proksi faqat /tele_uzdub yo'lini
 *   o'tkazadi, qolganini 404 qiladi. Shunda do'stlaringiz saytni ko'radi,
 *   lekin serveringizning boshqa qismi tashqariga chiqmaydi.
 *
 * QANDAY ISHLAYDI?
 *   cloudflared (https://xxx.trycloudflare.com)
 *        -> 127.0.0.1:8787  (shu proksi)
 *        -> 127.0.0.1:80    (XAMPP Apache)
 *
 * MUHIM: X-Forwarded-Proto: https yuboriladi — ilova shunda "men HTTPS
 * orqali keldim" deb tushunadi va Secure cookie qo'yadi (config.php).
 *
 * ISHLATISH:
 *   node tools/cf-proxy.js            # 127.0.0.1:8787 da eshlab turadi
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const LISTEN_HOST = process.env.CF_PROXY_HOST || '127.0.0.1';
// 8787 Windows'da tizim tomonidan band qilingan (excluded port range),
// shuning uchun 8099 ishlatiladi.
const LISTEN_PORT = parseInt(process.env.CF_PROXY_PORT || '8099', 10);
const ORIGIN_HOST = process.env.CF_PROXY_ORIGIN_HOST || '127.0.0.1';
const ORIGIN_PORT = parseInt(process.env.CF_PROXY_ORIGIN_PORT || '80', 10);

// Internetga chiqadigan yagona yo'l (saytning web-root ichidagi katalog).
const ALLOW_PREFIX = '/tele_uzdub';

const LOG_FILE = path.join(__dirname, '..', 'storage', 'logs', 'cf-proxy.log');

function log(line) {
  const stamp = new Date().toISOString();
  const text = `[${stamp}] ${line}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, text, 'utf8');
  } catch (e) {
    /* log yozilmasa ham ishlayveradi */
  }
  process.stdout.write(text);
}

const server = http.createServer((req, res) => {
  const rawPath = (req.url || '/').split('?')[0];

  // /  ->  /tele_uzdub/  (dostlar bare URL ni kiritganda qulay bo'lsin)
  if (rawPath === '/' || rawPath === '') {
    res.writeHead(302, { Location: ALLOW_PREFIX + '/' });
    res.end();
    return;
  }

  // Faqat /tele_uzdub/* ruxsat etiladi (boshqa hamma 404).
  if (rawPath !== ALLOW_PREFIX && !rawPath.startsWith(ALLOW_PREFIX + '/')) {
    log(`BLOCK ${req.method} ${rawPath}`);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — bu manzil faqat sayt uchun.');
    return;
  }

  const headers = Object.assign({}, req.headers);
  // Original Host saqlanadi (ilova o'z domenini ko'radi),
  // lekin "https" deb bildiriladi.
  headers['x-forwarded-proto'] = 'https';
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-for'] = req.socket.remoteAddress || '';
  headers['host'] = req.headers.host || ORIGIN_HOST;

  const proxyReq = http.request(
    {
      host: ORIGIN_HOST,
      port: ORIGIN_PORT,
      method: req.method,
      path: req.url,
      headers: headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
      proxyRes.on('error', () => res.destroy());
    }
  );

  proxyReq.on('error', (err) => {
    log(`ERROR ${req.method} ${rawPath} -> ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('502 — lokal server javob bermadi.');
    } else {
      res.destroy();
    }
  });

  req.pipe(proxyReq);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log(`cf-proxy ishga tushdi: http://${LISTEN_HOST}:${LISTEN_PORT} -> http://${ORIGIN_HOST}:${ORIGIN_PORT}${ALLOW_PREFIX}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
