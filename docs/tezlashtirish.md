# Tezlashtirish: 4 qatlam + R2 prefiks keshi

Bu hujjat videoning **ochilish vaqtini minimalga tushirish** uchun qilingan
o'zgarishlarni va ularni **qanday yoqish**ni tushuntiradi.

Asosiy g'oya: video baytlari sayt serveridan o'tmaydi. Ular ikki manbadan
keladi:

1. **Cloudflare R2** — har bir videoning faqat birinchi ~5 MB i (prefiks).
2. **Telegram (MTProto)** — qolgan baytlar, avvalgidek.

Brauzerda esa **Service Worker** (`tg-cdn-worker.js`) ishlaydi: u
`/tgfile/` so'rovlarini ushlab, kerakli baytlarni yuqoridagi manbalardan
oladi va `206 Partial Content` qilib qaytaradi.

Qo'shimcha (o'chirib bo'lmaydigan) ikkinchi yo'l — **Telegram rasmiy embed
pleyeri**. U ixtiyoriy "Tez pleyer" rejimi sifatida qo'shilgan, lekin katta
kinolarda ishlamaydi; tafsilot **9-bo'limda**.

---

## 1. Nima qilindi (4 ta optimizatsiya)

| # | Nima | Qayerda | Foyda |
|---|---|---|---|
| 0 | `Range: bytes=0-1` "probe" ga **darhol** 2 bayt javob | `tg-cdn-worker.js` | Pleer Telegram javobini kutmasdan ishga tushadi — "0 soniya" taassurot |
| 1 | **Disk bo'lak keshi** (Cache Storage, 24 soat, 400 MB) | `tg-cdn-worker.js` | Qayta ochish / orqaga qaytish / sahifa yangilash — **0 tarmoq** |
| 2 | **20 MB read-ahead** | `tg-cdn-worker.js` | Seek va oldinga o'tish deyarli darhol |
| 3 | **`esds` (MP4) tuzatish** | `tg-cdn-worker.js` | Chromium ba'zi Telegram MP4'larini rad etmaydi (aks holda butun fayl tortilardi) |
| 4 | **R2 prefiks keshi** (ixtiyoriy) | `deploy/r2-prefix-worker.js`, `api/r2-sign.php` | Birinchi bayt Telegram DC o'rniga Cloudflare edge'dan (~20–60 ms) |

0–3 raqamli qatlamlar **hech qanday sozlashsiz** ishlaydi. 4-chi qatlam
(R2) esa `.env` da yoqilguncha **o'chirilgan** — ya'ni hozirgi barqaror
oqim o'zgarmaydi.

Muhim: bu qatlamlar `?doc=<id>` parametri bo'lmasa yoki foydalanuvchi
`Save-Data: on` yuborsa **avtomatik o'chadi**. Ya'ni trafik tejash rejimi
va eski xatti-harakat buzilmaydi.

---

## 2. Hech narsa sozlamasdan nima ishlaydi

Saytni yangilagandan keyin birinchi marta oching. Brauzer Service Worker'ni
o'zi yangilaydi (`updateViaCache: 'none'`). Konsolda (F12) quyidagilarni
ko'rasiz:

```
🔧 MP4 esds tuzatildi (doc 5xxxxxxxx…)
📊 so'rov: 12 · 8.4 MB · seek: 2 ta · parallel: 24 · ulash: 1
```

Tekshirish:

1. Videoni oching — birinchi kadr tez chiqishi kerak.
2. Videoni yopib, **qayta oching** — "0 ms" effekt (disk kesh).
3. Konsolda `caches.keys()` → `wctg-chunks-v1` ko'rinishi kerak.

Keshni tozalash (kerak bo'lsa):

```js
caches.delete('wctg-chunks-v1')
```

---

## 3. R2 prefiks keshini yoqish (5 qadam)

R2 bepul tarifi: **10 GB saqlash**, **10 mln Class B (o'qish) oyiga**,
**chiqish trafigi bepul**. 5 MB × 500 video ≈ 2.5 GB — bemalol sig'adi.

### 3.1. Cloudflare akkaunt va bucket

1. https://dash.cloudflare.com → ro'yxatdan o'ting (bepul).
2. **R2** → **Create bucket** → nom: `wc-prefix` → Create.
3. Bucket → **Settings** → **Public access** → **Custom domain** →
   `cdn-r2.saytingiz.uz` qo'shing (domen Cloudflare'da bo'lishi kerak).
   Bu qadam **majburiy emas, lekin juda tavsiya etiladi**: o'qishlar
   Worker'ni chetlab o'tadi va Workers'ning 100 000 so'rov/kun bepul
   limitini tejaydi.

### 3.2. Worker'ni joylashtirish

1. **Workers & Pages** → **Create** → **Worker** → nom: `wc-prefix`.
2. **Edit code** → `deploy/r2-prefix-worker.js` faylining **butun**
   mazmunini joylashtiring → **Deploy**.
3. Worker → **Settings** → **Variables and Secrets**:

   | Nomi | Qiymati |
   |---|---|
   | `SIGN_SECRET` | uzun tasodifiy satr (pastda) |
   | `MAX_BYTES` | `8388608` (ixtiyoriy, 8 MB) |
   | `ALLOW_ORIGIN` | `https://saytingiz.uz` (yoki `*`) |

   `SIGN_SECRET` yaratish:

   ```powershell
   C:\xampp\php\php.exe -r "echo bin2hex(random_bytes(32));"
   ```

4. Worker → **Settings** → **Bindings** → **R2 bucket**:
   - Variable name: `R2`
   - Bucket: `wc-prefix`

5. Worker manzilini yozib oling:
   `https://wc-prefix.<account>.workers.dev`

### 3.3. Bucket CORS (Service Worker cross-origin o'qishi uchun)

R2 bucket → **Settings** → **CORS policy** → quyidagini joylashtiring
(`saytingiz.uz` ni o'z domeningizga almashtiring):

```json
[
  {
    "AllowedOrigins": ["https://saytingiz.uz"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Range", "Content-Length", "ETag", "Accept-Ranges"],
    "MaxAgeSeconds": 86400
  }
]
```

> CORS bo'lmasa Service Worker R2 dan o'qiy olmaydi va jim ravishda
> Telegram yo'liga qaytadi (sayt buzilmaydi, faqat tezlashmaydi).

### 3.4. `.env` sozlamalari

`.env` faylidagi izohlangan blokni oching:

```dotenv
R2_ENABLED=1
R2_WORKER_URL=https://wc-prefix.<account>.workers.dev
R2_PUBLIC_BASE=https://cdn-r2.saytingiz.uz
R2_SIGN_SECRET=<3.2 qadamda yaratgan satr>
R2_PREFIX_BYTES=5242880
R2_PUT_AUTH=1
R2_IP_DAY=20
R2_GLOBAL_DAY=2000
```

- `R2_PUBLIC_BASE` bo'sh bo'lsa o'qish Worker orqali ketadi (sekinroq va
  kunlik limitga yaqinroq).
- `R2_PUT_AUTH=1` — prefiksni faqat **login qilgan** foydalanuvchi yuklaydi.
- `R2_IP_DAY` / `R2_GLOBAL_DAY` — kunlik yuklash limitlari (bucket'ni
  axlat bilan to'ldirishdan himoya).

`storage/cache/` papkasi PHP tomonidan **yozilishi** kerak (limit
hisoblagichlari shu yerda saqlanadi).

### 3.5. Tekshirish

```powershell
# 1) Worker tirikmi?
curl.exe "https://wc-prefix.<account>.workers.dev/health"

# 2) PHP sozlamani ko'ryaptimi? (enabled:true, base, prefix)
curl.exe "https://saytingiz.uz/api/r2-sign.php?info=1"

# 3) Admin hisobot (yuklashlar soni)
curl.exe "https://saytingiz.uz/api/r2-sign.php?stats=1&key=<ADMIN_PANEL_KEY>"
```

Kutilgan javob (2-qadam):

```json
{"success":true,"enabled":true,"base":"https://cdn-r2.saytingiz.uz",
 "prefix":5242880,"put":true,"ttl":900,"min":4096}
```

Keyin videoni oching. Konsolda:

```
⚡ R2 prefiks 5.0 MB — Telegram kutishisiz
⬆ R2 prefiks saqlandi (5.0 MB)     ← Wi-Fi'da, login qilganda
```

Birinchi foydalanuvchi prefiksni **Telegram'dan o'qib, R2 ga yozadi**
(cache-aside). Keyingi barcha foydalanuvchilar uni **edge'dan** oladi.

---

## 4. Qanday ishlaydi (qisqa oqim)

```
video ochiladi
  │
  ├─ Range: bytes=0-1 ──────────────► SW darhol 206 (2 bayt)      ~0 ms
  │
  ├─ Range: bytes=0- ───────────────► SW:
  │     1) disk keshda bormi? ───────► bor: 0 ms
  │     2) R2 prefiks (5 MB) ────────► ~20–60 ms (edge)
  │     3) Telegram MTProto ─────────► ~100–600 ms (DC)
  │
  └─ Seek / oldinga ────────────────► 20 MB read-ahead allaqachon tayyor
```

Baytlar **aynan bir xil faylning boshi** — shuning uchun `<video>` manbani
almashtirmaydi, `Range`/`206` mantiqi buzilmaydi va sifat pasaymaydi.

---

## 5. Chegaralar va nimalarga e'tibor berish

| Narsa | Qiymat | Izoh |
|---|---|---|
| Prefiks | 5 MB | `R2_PREFIX_BYTES`, 4096 ga karrali bo'lishi shart |
| Disk kesh | 400 MB / 4096 kalit / 24 soat | `CACHE_MAX`, `CACHE_MAX_KEYS`, `CACHE_TTL` |
| Read-ahead | 20 MB | `READAHEAD_BYTES` |
| Telegram so'rov | 512 KB | 1 MB blok chegarasini kesib o'tmaydi |
| R2 obyekt | 8 MB gacha | Worker `MAX_BYTES` |
| Imzo muddati | 15 daqiqa | `api/r2-sign.php` |

Muhim: **prefiks uzunligi har doim 4096 ga karrali** bo'lishi kerak.
Telegram davomi shu chegaradan boshlanadi; aks holda `LIMIT_INVALID`.

---

## 6. Muammolarni bartaraf etish

**Konsolda `⚡ R2 prefiks` chiqmaydi**

1. `api/r2-sign.php?info=1` → `enabled:true` mi?
2. `R2_PUBLIC_BASE` domeni brauzerda ochilyaptimi?
   `https://cdn-r2.saytingiz.uz/p/<doc>` → 404 bo'lsa obyekt hali yo'q
   (birinchi foydalanuvchi yuklamagan) — bu normal.
3. Bucket CORS to'g'rimi? (3.3)
4. Worker'da `R2` binding bormi? `/health` → `"r2":true` bo'lishi kerak.

**`LIMIT_INVALID` xatosi**

`R2_PREFIX_BYTES` 4096 ga karrali emas yoki Telegram bloki kesilgan.
`R2_PREFIX_BYTES=5242880` (5 × 1024 × 1024) dan foydalaning.

**Prefiks yuklanmayapti (`⬆` chiqmaydi)**

- `R2_PUT_AUTH=1` bo'lsa foydalanuvchi login qilgan bo'lishi kerak.
- Wi-Fi/ethernet kerak (`canSeed()` mobil tarmoqda yuklamaydi).
- Kunlik limit tugagan bo'lishi mumkin (`?stats=1`).

**Video ochilmayapti / butun fayl yuklanmoqda**

- `esds` tuzatish ishlaganini tekshiring (konsolda `🔧`).
- `tg-cdn-worker.js` ning yangi versiyasi faollashganini tekshiring:
  DevTools → Application → Service Workers → **Update**.

**Kesh juda katta bo'lib ketdi**

Brauzer o'zi ham kvota bo'yicha tozalaydi. Qo'lda:

```js
caches.delete('wctg-chunks-v1')
```

---

## 7. Million foydalanuvchi uchun nima kerak

Kod tomoni tayyor, lekin **hosting** hali ham to'siq:

1. **Haqiqiy domen + hosting.** Hozirgi
   `https://causes-discretion-improvements-leone.trycloudflare.com/...`
   — bu vaqtinchalik tunnel, million foydalanuvchiga chidamaydi.
2. Domenni **Cloudflare** (bepul plan) orqasiga qo'ying: HTML/CSS/JS va
   `api/*.php` edge'da keshlanadi, TLS bepul.
3. R2 prefiksni yoqing (3-bo'lim) — birinchi 5 MB butun dunyo edge'idan
   keladi, Telegram faqat "sovuq" qolgan qism uchun ishlatiladi.
4. Disk kesh tufayli **qayta ko'rishlar umuman serverga bormaydi** —
   bu eng katta tejamkorlik.

Ya'ni: R2 — birinchi 5 MB uchun, Cloudflare edge — HTML/API uchun,
Telegram — qolgan baytlar uchun, brauzer keshi — qayta ko'rishlar uchun.
Server (PHP/MySQL) video baytlarini **hech qachon** ko'rmaydi.

---

## 8. Foydali buyruqlar

```powershell
# Sintaksis tekshiruvi
node --check tg-cdn-worker.js

# esds tuzatish testi
node tests\esds-patch.test.js

# PHP lint
C:\xampp\php\php.exe -l api\r2-sign.php
C:\xampp\php\php.exe -l api\perf.php

# O'lchovlar (p50/p90/p95)
curl.exe "https://saytingiz.uz/api/perf.php?stats=1&key=<ADMIN_PANEL_KEY>"

# Eng ko'p ko'rilgan videolar (prefetch ro'yxati)
curl.exe "https://saytingiz.uz/api/hot.php?n=30"
```

---

## 9. Ikkinchi rejim: Telegram rasmiy embed pleyeri ("Tez pleyer")

Videoni ochishning yana bir yo'li bor: Telegram'ning **o'zi** beradigan
embed pleyer. U `https://t.me/<kanal>/<post>?embed=1` manzilida ochiladi va
video baytlarini to'g'ridan-to'g'ri `cdn*.telesco.pe` dan oladi — Telegram
Web'dagi kabi.

**O'z pleyerimiz o'chirilmagan.** Saytda ikkita rejim bor va ular orasida
almashish mumkin (`#watchPMode` paneli, tanlov `localStorage.wc_pmode` da
saqlanadi):

| Rejim | Nima ishlaydi | Qachon |
|---|---|---|
| `own` (standart) | MTProto + Service Worker (yuqoridagi 4 qatlam) | Har doim |
| `fast` | Telegram embed (iframe) | Faqat embed haqiqatan o'ynasa |

### 9.1. Muhim cheklov: "Media is too big"

Telegram **anonim** ko'ruvchiga (saytga kirgan, lekin Telegram'da tizimga
kirmagan odamga) faqat **kichik** fayllarni oqizadi. Katta kinolarda embed
sahifasi video o'rniga shunday yozuv chiqaradi:

```
Media is too big
VIEW IN TELEGRAM
```

Tekshirilgan: `wcinemauz/4` (1:31:29), `wcinemauz/10` (1:42:50),
`wcinemauz/2` (1:23:53) — hammasi "Media is too big". URL varianti
(`?embed=1`, `?mode=generic`, `?single&embed=1`, `&video=1`, `&autoplay=1`)
hech narsani o'zgartirmaydi. Faqat kichik videolar (masalan
`t.me/Telegram/427`) haqiqatan `<video src="...mp4">` bilan ochiladi.

Shu sababli **standart rejim — `own`**. Embed faqat quyidagi ikki shart
bajarilganda ko'rsatiladi:

1. Server tekshiruvi `playable: true` deydi (9.2 ga qarang).
2. Foydalanuvchi "⚡ Tez pleyer" tugmasini o'zi bosadi.

Aks holda panelda faqat izoh chiqadi:
"Telegram pleyeri katta faylni oqizmaydi — bizning pleyer ishlatilmoqda".

### 9.2. Server tekshiruvi: `api/tg-embed.php`

Iframe cross-origin bo'lgani uchun brauzerdan "ichida video bormi?" deb
so'rab bo'lmaydi. Shuning uchun PHP `t.me` HTML'ini o'qiydi va holatlarni
ajratadi:

| HTML'da | `reason` | `playable` |
|---|---|---|
| `<video src="https://...">` | `ok` | `true` |
| `message_media_not_supported_label` = "Media is too big" | `too_big` | `false` |
| `Post not found` | `not_found` | `false` |
| video tegi yo'q (matn/rasm post) | `no_video` | `false` |

```
GET api/tg-embed.php?channel=wcinemauz&post=4
-> {"success":true,"playable":false,"reason":"too_big", ...}
```

- Kanal nomi `^[a-z0-9_]{3,64}$` bilan tekshiriladi — endpoint tashqi so'rov
  generatoriga aylanmasligi uchun.
- Javob **6 soat** `storage/cache/tg-embed-<sha1>.json` da keshlanadi —
  millionlab ko'ruvchida ham `t.me` ga bitta so'rov ketadi.
- Faqat aniq javoblar keshlanadi: tarmoq xatosi (`fetch_failed`) keshga
  yozilmaydi, aks holda embed 6 soat davomida bekorga o'chib turardi.

Brauzer ham natijani eslab qoladi: `wc_embed_ok` (6 soat) va
`wc_embed_bad` (`{at, reason}`, 7 kun). "Tez pleyer" bosilganda `bad`
belgisi tozalanadi va post qaytadan tekshiriladi.

### 9.3. Ikkinchi himoya (brauzer)

Embed ichkaridan balandligini `postMessage` bilan yuboradi
(`{"event":"resize","height":N}`). Haqiqiy video ≈ 418–509 px, "Post not
found" esa ≈ 66 px. Agar balandlik **150 px dan kichik** bo'lsa, sahifa
avtomatik `own` rejimiga qaytadi va postni "ishlamaydi" deb belgilaydi.
Qo'shimcha: 9 soniya ichida iframe `load` bo'lmasa ham `own` ga qaytamiz.

### 9.4. Qachon embed foydali

- Kanalingizda **kichik** (Telegram anonim ko'ruvchiga oqizadigan) videolar
  bo'lsa — o'shanda "Tez pleyer" haqiqatan tezroq ochiladi.
- Katta kinolar uchun yagona yo'l — R2 prefiks + Service Worker (3-bo'lim),
  chunki Telegram embed ularni oqizmaydi.

### 9.5. "Tez pleyer" bosilganda nima ko'rinadi

Tugma "hech narsa qilmayapti" bo'lib tuyulmasligi uchun har bir bosish
ko'rinadigan javob beradi:

1. Panelda `⏳ Tekshirilmoqda…` (o'chirilgan tugma) holati paydo bo'ladi va
   toast chiqadi (`wc_embed_bad` tozalanadi, `api/tg-embed.php` qayta
   so'raladi).
2. Embed o'ynasa — iframe o'rnatiladi, `⚡ Telegram pleyeri ochildi` toast
   chiqadi, tanlov `wc_pmode=fast` bo'lib saqlanadi.
3. O'ynamasa — panelda **sariq (amber)** qatorda sabab turadi
   ("Telegram pleyeri katta faylni oqizmaydi — bizning pleyer ishlatilmoqda")
   va toast chiqadi, `wc_pmode` yana `own` ga qaytadi, **o'z pleyerimiz joriy
   o'rni bilan davom etadi** (u qayta yuklanmaydi).
4. Tarmoq xatosi bo'lsa post "ishlamaydi" deb **belgilanmaydi**: panel
   `⚠️ Tekshirib bo'lmadi` holatida qoladi, 30 soniya qayta so'ralmaydi
   (cheksiz sikl/toast bo'roni yo'q).

#### 9.5.1. Nega ilgari tugma "hech narsa qilmayapti" bo'lib tuyulgan

Haqiqiy sabab **ko'rinmas toast** edi. `watch.js` dagi `toast()` funksiyasi
`b.className = 'reels-toast ...'` deb yozardi va shu bilan ko'rinish uchun
zarur bo'lgan `show` klassini o'chirib yuborardi. `reels.css` da esa
`.reels-toast { opacity: 0 }` va `.reels-toast.show { opacity: 1 }` — natijada
sahifadagi **hamma** xabar (xato sababi ham) shaffof bo'lib qolardi.

Tuzatish (`assets/js/watch.js` va `assets/js/tg-comments.js`):

```js
b.className = 'reels-toast' + (kind ? ' ' + kind : '');
b.hidden = false;
void b.offsetWidth;          // transition uchun reflow
b.classList.add('show');     // KO'RINISH uchun shart
// ... 3.2 s dan keyin: classList.remove('show'), 220 ms dan keyin hidden = true
```

Tekshirishning o'ziga xosligi: brauzer **fonda** (focus bo'lmagan tabda)
CSS `opacity` transitionini oldinga surmaydi, shuning uchun hisoblangan
`opacity` `0` ko'rinishi mumkin. To'g'ri tekshirish uchun tabni fokuslang
(`browser.tabs.focus`) yoki `getBoundingClientRect()` (kenglik/balandlik > 0)
va `hidden === false` ni tekshiring.

### 9.6. O'z pleyerida "abadiy Tayyorlanmoqda..." bo'lsa

`tg-stream.js` da 20 soniyalik watchdog bor: agar shu vaqt ichida na
`<video>`, na xato paydo bo'lmasa, "Tayyorlanmoqda..." o'rniga
**"Pleyer javob bermayapti"** + **Qayta urinish** tugmasi chiqadi.
Qayta urinish `TgStream.mount()` ni joriy manba bilan qayta chaqiradi
(`window.__wcTgLast`). Xuddi shu tugma xato ekranida (`fail()`) ham endi
haqiqatan ishlaydi.

---

## 10. Embed'ni tekshirish

```powershell
# 1) Server tekshiruvi
curl.exe "http://localhost/tele_uzdub/api/tg-embed.php?channel=wcinemauz&post=4"
#    -> "reason":"too_big"

curl.exe "http://localhost/tele_uzdub/api/tg-embed.php?channel=Telegram&post=427"
#    -> "playable":true

# 2) Brauzerda (F12 -> Console)
#    localStorage.getItem('wc_embed_bad')
#    -> {"wcinemauz/4":{"at":...,"reason":"too_big"}}
#    Keshni tozalash:  localStorage.removeItem('wc_embed_bad')
```
