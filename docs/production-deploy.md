# Production deploy — doimiy domenga o'tish

Bu hujjat saytni `trycloudflare` vaqtinchalik tunnelidan **doimiy domen + nomlangan
tunnel** (yoki arzon VPS) ga ko'chirish, HLS'ni zaxira rejimga o'tkazish va
Cloudflare R2/B2 ga segmentlarni chiqarish bo'yicha amaliy qadamlar.

> Asosiy tamoyil: **Telegram — asosiy oqim, HLS — zaxira.**
> Telegram video baytlari tomoshabin brauzeriga to'g'ridan-to'g'ri keladi;
> serveringiz faqat sahifa/JS/API beradi. HLS esa baytlarni sizning
> serveringizdan beradi — u faqat zaxira yo'l bo'lishi kerak.

---

## 1. Nega trycloudflare yetarli emas

| Muammo | Natija |
|---|---|
| Manzil har ishga tushirishda o'zgaradi | Telegram bot `SITE_URL` buziladi, havolalar eskiradi |
| Bir vaqtdagi so'rovlar cheklangan | 200+ parallel foydalanuvchida javob kechikadi |
| Kompyuter/o'tkazish liniyasi o'chsa — sayt tushadi | 0 mavjudlik |
| HLS baytlari uy internetidan chiqadi | 2–4 Mbit/s × tomoshabin = tez tugaydigan upload |

## 2. Doimiy domen + nomlangan tunnel (eng arzon yo'l)

```bash
cloudflared tunnel login
cloudflared tunnel create wc-cinema
cloudflared tunnel route dns wc-cinema cinema.example.com
```

`deploy/cloudflared/config.yml.example` ni `~/.cloudflared/config.yml` ga ko'chirib,
`<TUNNEL_UUID>` va `hostname` ni to'ldiring. Linux'da:
`deploy/systemd/wc-cloudflared.service`.

`.env`:

```
SITE_URL=https://cinema.example.com
ALLOWED_HOSTS=cinema.example.com,www.cinema.example.com
```

So'ng `php cli/...` skriptlar va bot webhook manzilini yangilang:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://cinema.example.com/api/tg-webhook.php"
```

## 3. VPS (eng katta ishonchlilik yutug'i)

Uy kompyuteri o'chsa ham sayt ishlashi kerak bo'lsa — PHP + MySQL ni VPS'ga
ko'chiring. Minimal talab: 2 vCPU / 2 GB RAM / 40 GB SSD (HLS keshi uchun).
Ubuntu 22.04 uchun:

```bash
sudo apt update && sudo apt install -y nginx php8.2-fpm php8.2-mysql php8.2-curl \
  php8.2-mbstring php8.2-xml mysql-server ffmpeg
sudo cp -r /path/to/tele_uzdub /var/www/wc
sudo chown -R www-data:www-data /var/www/wc/storage /var/www/wc/uploads
sudo systemctl enable --now nginx php8.2-fpm mysql
```

`mysql` import qilingandan keyin `.env` da `DB_HOST=127.0.0.1`, `DB_USER`, `DB_PASS`
ni yangilang. **`.env` ni hech qachon git'ga qo'shmang** (`.gitignore` da bor).

## 4. Pleyer rejimi: Telegram asosiy, HLS zaxira

`.env`:

```
HLS_ENABLED=1
HLS_MODE=fallback      # prefer | fallback | off
HLS_FALLBACK_MS=8000   # Telegram 8 s ichida o'ynamasa — HLS tekshiriladi
```

* `fallback` (standart) — Telegram darhol boshlanadi. 8 soniya ichida `playing`
  hodisasi bo'lmasa yoki video `error` bersa, `api/hls.php?json=1` tekshiriladi va
  tayyor bo'lsa HLS'ga o'tiladi. Keyin 5 s → 30 s oraliqda (orqaga chekinish)
  qayta tekshiriladi.
* `prefer` — eski xatti-harakat (HLS tayyor bo'lsa darhol diskdan).
* `off` — HLS umuman ishlatilmaydi (hls.js ham yuklanmaydi). Telegram bo'lmasa
  HLS oxirgi chora sifatida qoladi.

Kod: `assets/js/watch.js` → `raceHlsTelegram()`, `watch.php` →
`window.__WC_HLS_MODE`.

## 5. HLS segmentlarini R2 / B2 ga chiqarish

R2 chiqish trafigi uchun pul olmaydi; B2 arzon. Segmentlar o'zgarmas, shuning
uchun `Cache-Control: public, max-age=31536000, immutable` bilan beriladi.

`.env` (git'ga tushmaydi):

```
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_BUCKET=wc-hls
S3_REGION=auto
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_PUBLIC_BASE=https://cdn.example.com
S3_PREFIX=hls
HLS_REMOTE_REDIRECT=1
```

R2'da: bucket → **Settings → Public access → Custom domain** (`cdn.example.com`).
B2'da: bucket → **Bucket Settings → Custom domain** yoki `f000.backblazeb2.com`.

Yuklash (qo'lda sinov):

```bash
php cli/hls-publish.php --all --dry-run     # nima yuklanishini ko'rsatadi
php cli/hls-publish.php --all              # yuklaydi + remote.json yozadi
php cli/hls-publish.php --all --prune      # lokaldan o'chganlarini remote'dan ham o'chiradi
```

`remote.json` paydo bo'lgach `api/hls.php` segmentlarni `302` bilan
`S3_PUBLIC_BASE` ga yo'naltiradi va playlistdagi segment satrlarini ham o'sha
manzilga almashtiradi. Muammo bo'lsa: `HLS_REMOTE_REDIRECT=0` (darhol qaytish).

Avtomatik: `deploy/systemd/wc-hls-publish.{service,timer}` (har kuni 04:30).

Videoning **bosh qismini** (2–5 MB) R2'ga oldindan yuklab, birinchi
tomoshabinga tez boshlanish berish: `php cli/prefix-publish.php --manifest=...`
va `p/<doc>` obyektlari — batafsil: [video-prep.md](video-prep.md).

## 6. Kesh va limitlar

`.env`:

```
RL_ENABLED=1
RL_READ_PER_MIN=240
RL_WRITE_PER_MIN=60
```

API javoblari `includes/HttpCache.php` orqali keshlanadi (faqat anonim
foydalanuvchi uchun):

| Endpoint | TTL | `s-maxage` |
|---|---|---|
| `api/home.php` | 30 s | 30 |
| `api/hot.php` | 300 s | 60 |
| `api/catalog.php` | 60 s | 60 |
| `api/related.php` | 300 s | 120 |
| `api/genres.php` | 600 s | 300 |
| `api/search.php` | 60 s | 30 |

Javob sarlavhalari: `X-WC-Cache: HIT|MISS|STALE|BYPASS`, `X-WC-TTL: <soniya>`.
Stampede himoyasi: bir vaqtda kelgan so'rovlardan faqat bittasi MySQL'ga boradi.

Anonim javob: `Cache-Control: public, max-age=15, s-maxage=<TTL>, stale-while-revalidate=60`.
Login qilgan foydalanuvchi: `Cache-Control: private, no-store` (kesh yo'q).

**Muhim: `.htaccess` da `Header set` emas, `Header setifempty` ishlatiladi.**
Ilgari `\.(php|html)$` uchun `Header set Cache-Control "no-cache, must-revalidate"`
turardi va u PHP qo'ygan `public, s-maxage=...` ni **ustidan yozib yuborardi** —
natijada `X-WC-Cache: HIT` bo'lsa ham Cloudflare hech narsani keshlay olmasdi.
`setifempty` faqat sarlavha umuman bo'lmaganda qo'shadi.

**Cloudflare Cache Rule** (Dashboard → Caching → Cache Rules → Create rule):

* If: `starts_with(http.request.uri.path, "/api/") and http.request.method eq "GET"`
* Then: **Cache eligibility: Eligible**; Edge TTL: **"Use cache-control header if present"**
  (boshqa variantda 30 s); Browser TTL: respect origin. `Cache Key` da
  query string'ni **saqlang** (`n`, `offset`, `sort`, `page`, `q` kesh kaliti).
* `/api/views.php`, `/api/live.php`, `/api/hls.php` — **Bypass** (yoki ular o'zi
  `no-store` beradi; baribir bypass xavfsizroq).
* Natija: bir xil ro'yxat 60 s davomida Cloudflare edge'dan qaytadi, uy
  kompyuteriga umuman yetib kelmaydi. `Set-Cookie` bor javoblar Cloudflare
  tomonidan keshlanmaydi — shuning uchun API'lar anonim rejimda cookie
  yubormasligi kerak (hozir `session_write_close()` dan keyin `Set-Cookie`
  faqat birinchi tashrifda chiqadi).

**Cloudflare WAF** (Dashboard → Security → WAF → Rate limiting rules):

1. `http.request.uri.path contains "/api/"` — 60 s ichida 300 so'rov / IP.
2. `http.request.uri.path eq "/api/hls.php"` — 60 s ichida 600 so'rov / IP
   (pleylist + segmentlar ko'p so'raladi).
3. Bot himoyasi: `cf.client.bot` — ma'lum yaxshi botlar bundan mustasno.

`api/hls.php` dagi `.rate_` (30 s / IP / yangi worker) cheklovi **saqlanib qoldi**.

## 7. Ko'rishlar hisoblagichi (batching)

`api/views.php` → `ViewCounter::record()`:

* unikal ko'rish `content_views` ga **darhol** `INSERT IGNORE`;
* `content.views` daqiqada bir marta (yoki 200 ta kontent yig'ilganda) yangilanadi;
* javobda har doim aniq `COUNT(*)` qaytadi.

Traffik bo'lmasa ham yangilanishi uchun timer:

```bash
sudo cp deploy/systemd/wc-flush-views.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wc-flush-views.timer
```

Qo'lda: `php cli/flush-views.php`.

## 8. Sessiya qulflari

Anonim API'lar (`home`, `hot`, `catalog`, `related`, `genres`, `search`, `views`,
`hls`) bootstrap'dan keyin darhol `session_write_close()` chaqiradi. Aks holda
PHP fayl sessiyasi bir foydalanuvchining parallel so'rovlarini ketma-ket qiladi.

## 9. ffmpeg — past ustuvorlik, serial, tunda

* `cli/proc-priority.php` — ffmpeg'ga `Idle` (Windows) yoki `renice 19` (Linux).
* `cli/hls-watch.php` — bir vaqtda bitta worker (Telegram sessiya qulfi serial).
* Tungi rejim (ixtiyoriy): `HLS_NIGHT_ONLY=1`, `HLS_NIGHT_FROM=1`, `HLS_NIGHT_TO=7`.
* systemd: `Nice=19`, `CPUSchedulingPolicy=idle`, `CPUQuota=50%`.
* Video tayyorlash (H.264/AAC, 2 s GOP, faststart): `php cli/video-prep.php --fix`
  — rejimlar, `.env` va cron: [video-prep.md](video-prep.md).

## 10. Tekshirish

```bash
# 1) Kesh sarlavhalari
curl -sI https://cinema.example.com/api/hot.php | grep -iE 'cache-control|x-wc-'

# 2) HLS remote 302 (remote.json yozilgandan keyin)
curl -sI "https://cinema.example.com/api/hls.php?key=<KEY>&seg=seg_00001.ts"

# 3) Limit
for i in $(seq 1 300); do curl -s -o /dev/null -w "%{http_code}\n" \
  https://cinema.example.com/api/genres.php; done | sort | uniq -c

# 4) Yuk sinovi (k6 bo'lsa)
k6 run tests/load/k6-read.js -e BASE=https://cinema.example.com

# 5) k6 yo'q bo'lsa — Node
node tests/load/smoke.js https://cinema.example.com 200 20

# 6) Aralash ro'yxatlar
node tests/load/smoke.js https://cinema.example.com 1000 50 \
  '/api/home.php?offset=0&limit=12,/api/catalog.php?sort=new&page=1,/api/hot.php?n=30'
```

Kutilgan natija (lokal o'lchov, `docs/scale.md` §6): p50 70–250 ms,
kesh HIT ≥ 99%, 260–385 RPS bitta XAMPP nusxasida. Agar HIT 0 bo'lsa —
`Header setifempty` va `X-WC-Cache` ni tekshiring; agar 429 ko'p bo'lsa —
`RL_READ_PER_MIN` yoki Cloudflare WAF qoidasini yumshatib ko'ring.

## 11. Muammo bo'lsa — tez qaytish

| Belgisi | Birinchi qadam |
|---|---|
| HLS o'ynayapti, Telegram yo'q | `HLS_MODE=prefer` (vaqtincha) |
| Segmentlar 302 dan keyin ochilmayapti | `HLS_REMOTE_REDIRECT=0` |
| 429 ko'p kelyapti | `RL_READ_PER_MIN=600` yoki CF WAF qoidasini yumshatish |
| Kesh "eskirgan" javob beryapti | `rm -rf storage/cache/http/*` |
| ffmpeg saytni sekinlashtiryapti | `HLS_NIGHT_ONLY=1` yoki `HLS_FFMPEG_NICE=1` |
