# Masshtab: nima ko'taradi, nima ko'tarmaydi

Bu hujjat **taxmin emas** — har bir da'vo qaysi cheklovga tayanishini va uni
qanday o'lchashni yozadi. Raqamlar lokal o'lchov (`tests/load/smoke.js`) va
`storage/hls-watch.log` dan olinadi.

---

## 1. Ikki xil oqim — ikki xil yuk

| | Telegram (asosiy) | HLS (zaxira) |
|---|---|---|
| Video baytlari kimdan | Telegram DC → tomoshabin brauzeri | **sizning serveringiz** → tomoshabin |
| Serverimizdan trafik | ~0 (faqat sahifa/JS/API) | 2–4 Mbit/s × tomoshabin |
| 1000 tomoshabin | ~0 Mbit/s | **2–4 Gbit/s** (uy interneti ko'tarmaydi) |
| Kim o'ynaydi | brauzerdagi MTProto (foydalanuvchi akkaunti) | ffmpeg segmentlari |
| Cheklov | foydalanuvchi Telegram'ga kirgan bo'lishi kerak | upload + disk + CPU |

**Xulosa:** auditoriya o'sganda Telegram yo'li ishlatiladi. HLS — "Telegram
ochilmadi" holati uchun zaxira, ommaviy tarqatish vositasi emas.
Shuning uchun standart `HLS_MODE=fallback`.

## 2. Serverda nima bor (qatlamlar)

```
Brauzer
  │  1) HTML/JS/CSS  — .htaccess: 1 yil immutable, gzip/brotli
  │  2) API JSON     — HttpCache (disk) + Cache-Control: s-maxage
  │                     → 1000 tashrif = 1 MySQL so'rovi (TTL ichida)
  │  3) HLS          — faqat zaxira; segmentlar R2/B2 dan (302)
  ▼
PHP-FPM / Apache ── MySQL (indekslar, batching yozuvlar)
                 └─ ffmpeg (Nice=19, serial, tunda)
```

### Hisob-kitob (API qatlami)

* `api/home.php` keshi 30 s. 2000 ta bir vaqtli tashrif → ~1–2 DB so'rovi.
* Keshsiz holatda bitta `home` so'rovi ~6–10 SQL so'rov + `toPublicArray`
  (har element uchun poster/URL mantiq). 2000 × 8 = 16 000 so'rov — MySQL
  va PHP uchun og'ir.
* Ya'ni **kesh 30 s bo'lsa ham yuk ~1000× kamayadi**.

`X-WC-Cache` sarlavhasi bilan tekshiriladi:

```bash
curl -sI http://localhost/tele_uzdub/api/hot.php | grep -i x-wc-cache
# birinchi: MISS, keyingi: HIT
```

### Yozuv qatlami

* `api/views.php`: `INSERT IGNORE` (unikal indeks) + daqiqada bir marta
  `UPDATE content SET views = COUNT(*)`. Bir vaqtda 1000 ko'rish = 1000 yengil
  insert + 1 update (avval 1000 ta row-lock update edi).
* Sessiya qulflari: anonim API'lar `session_write_close()` ni darhol chaqiradi —
  bir foydalanuvchining 6 parallel segment so'rovi ketma-ket bo'lib qolmaydi.

## 3. Nima ko'taradi

| Yuk | Nega |
|---|---|
| 1000–2000 concurrent **API** tashrifi | kesh + sessiya qulfini bo'shatish + rate limit |
| Cheksiz **Telegram** tomoshabini | baytlar serverdan o'tmaydi |
| Ko'p ko'rish yozuvlari | batching (daqiqada 1 update) |
| Ko'p **statik** fayl | `.htaccess` immutable kesh + Cloudflare edge |
| Cloudflare R2/B2 dan segmentlar | chiqish trafigi provayderdan, sizdan emas |

## 4. Nima ko'tarmaydi

| Yuk | Cheklov | Yechim |
|---|---|---|
| 1000 HLS tomoshabini | 2–4 Gbit/s upload | R2/B2 (`cli/hls-publish.php`) yoki HLS'ni o'chirish |
| Bir vaqtda 2+ ffmpeg | CPU + Telegram sessiya qulfi | `hls-watch` serial, `Nice=19`, `HLS_NIGHT_ONLY` |
| Disk | `HLS_MAX_MB` (standart 8000 MB) | kvota LRU + remote nusxa |
| Bitta IP dan bot oqimi | PHP + MySQL | `RateLimit` (240/60 s) + Cloudflare WAF |
| Uy kompyuteri o'chishi | mavjudlik 0 | VPS + nomlangan tunnel |
| Telegram DC javob bermasligi | prewarm ishlamaydi | HLS allaqachon tayyor bo'lsa ishlaydi; aks holda kuting |

## 5. Yuk sinovi (o'lchov, taxmin emas)

k6 (o'rnatilgan bo'lsa):

```bash
k6 run tests/load/k6-read.js -e BASE=http://localhost/tele_uzdub
k6 run tests/load/k6-hls.js  -e BASE=http://localhost/tele_uzdub -e KEY=<key>
```

k6 yo'q bo'lsa:

```bash
node tests/load/smoke.js http://localhost/tele_uzdub 200 20
#                             BASE                  so'rov concurrency
# Aralash (bir nechta endpointga navbat bilan uriladi):
node tests/load/smoke.js http://localhost/tele_uzdub 1000 50 \
  '/api/home.php?offset=0&limit=12,/api/catalog.php?sort=new&page=1,/api/hot.php?n=30,/api/genres.php'
```

> Lokal sinovda `RL_READ_PER_MIN=240` 50 parallel uchun kam — 500 so'rovdan
> 460 tasi 429 bo'ldi (ya'ni limiter ishlayapti). Katta sinovdan oldin vaqtincha
> oshiring, sinovdan keyin qaytaring va `storage/cache/rl/*.json` ni tozalang:

```bash
# .env: RL_READ_PER_MIN=240 -> 100000, sinovdan keyin qaytarish
Remove-Item storage/cache/rl/*.json -Force
```

Birinchi bo'lib nima sinishini kuzating (tartib bo'yicha):

1. **429** ko'payishi → rate limit juda qattiq (`RL_READ_PER_MIN`).
2. **p95 > 1 s** → kesh ishlamayapti (`X-WC-Cache: MISS` bo'lsa TTL/ruxsat).
3. **MySQL `SHOW PROCESSLIST`** da `UPDATE content` navbati → batching ishlamayapti.
4. **ffmpeg CPU 100%** → `Nice`/`CPUQuota` yoki tunda ishlash.
5. **Disk to'lishi** → `HLS_MAX_MB`, `--prune`, remote nusxa.

## 6. O'lchangan bazaviy ko'rsatkichlar (lokal)

### 6.1. Javob keshi (`tests/load/smoke.js`, `api/hot.php?n=30`)

| Sinov | Natija |
|---|---|
| 200 so'rov / 20 parallel | 100% 200, p50 **69 ms**, p90 115 ms, p99 128 ms, **259.7 RPS**, kesh HIT 100% |
| 2000 so'rov / 100 parallel (`RL` vaqtincha ochiq) | 100% 200, p50 **253 ms**, p90 301 ms, p99 372 ms, **384.5 RPS**, kesh HIT 100% |
| 500 so'rov / 50 parallel (standart `RL_READ_PER_MIN=240`) | 40×200 + **460×429** — limiter ishlayapti |

### 6.2. Aralash yo'llar (1000 so'rov / 50 parallel)

`home` + `catalog` + `hot` + `genres` navbat bilan:

| Ko'rsatkich | Natija |
|---|---|
| Statuslar | 100% 200 (429 yo'q — limit vaqtincha ochilgan) |
| p50 / p90 / p99 | **124 / 168 / 220 ms** |
| Tezlik | **367.4 RPS**, 3.0 MB javob |
| Kesh | HIT 995 / MISS 5 (**99.5%**) |

Har bir endpoint alohida: p50 122–125 ms, p99 194–238 ms — ya'ni qaysi
ro'yxat so'ralishidan qat'i nazar javob vaqti bir xil (hammasi diskdan).

### 6.3. Oldingi (videosayt) o'lchovlari

| Ko'rsatkich | Oldin | Keyin |
|---|---|---|
| click → `canplay` (tail kesh bilan) | 2.48 s | 0.88 s |
| watch sahifa p50 | 4 029 ms | — |
| watch sahifa p90 | 34 720 ms | — |
| HLS kesh (3 done epizod) | ~3 077 MB | — |
| Bo'sh disk | ~15 GB | — |

> Bu raqamlar lokal XAMPP + uy tarmog'i sharoitida. Production raqamlari
> VPS'da `tests/load/*` bilan qayta o'lchanishi kerak. Muhim: lokal test
> bitta mashinada HTTP + PHP + Node birga ishlaydi, shuning uchun haqiqiy
> serverda p50 odatda pastroq bo'ladi.

## 7. Keyingi qadamlar (ustuvorlik bo'yicha)

1. Doimiy domen + nomlangan tunnel (yoki VPS) — ishonchlilik.
2. R2/B2 ga segmentlarni chiqarish — HLS upload muammosi yechiladi.
3. Cloudflare WAF rate limiting — bot oqimi.
4. k6 bilan 500 → 1000 → 2000 VU bosqichma-bosqich; har bosqichda yuqoridagi
   5 ta indikatorni yozib borish.
