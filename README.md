# W CINEMA — Telegram Video Platform

Telegram Mini App asosida ishlaydigan video platformasi: katalog
(film/serial), o'z serveridan video oqimi (Range/seek), har bir qismni
Telegram chat'iga yetkazib berish va **Reels** (qisqa vertikal videolar:
yuklash + "bo'lak" kesish + moderatsiya).

Branding: **W CINEMA** (`SITE_NAME`).

---

## 🎯 Asosiy oqim

```
1. Foydalanuvchi saytga kiradi   → Telegram orqali login (initData + HMAC)
2. Katalog bo'limlarini ko'radi   → Bosh sahifa / Kino / Anime / Multfilm
3. Kontentni ochadi               → Player: direct/file/embed/hls ovqatlanadi
4. "Telegram'ga saqlash"          → Bot shu QISMINI chat'ga yuboradi (428 need_start)
5. Reels                          → qisqa video yuklash yoki katalogdan "bo'lak" kesish
6. Moderatsiya                    → Admin tasdiqlagach reel oqimda paydo bo'ladi
```

**Katalog → qism** tuzilmasi: `content` (film/serial meta) + `episodes`
(har bir qism alohida video manba). Katalog ma'lumotlarini **admin paneli**
(`admin-content.php`) boshqaradi — SQL bilan qo'lda kontent qo'shish shart emas.

---

## 🎞 Reels tizimi

| Tur | Tavsif | Manba |
|---|---|---|
| `upload` | Video saytda tanlanadi → Telegram kanalga joylanadi (`REELS_CHANNEL`), serverda saqlanmaydi | `reels-upload.php` |
| `clip` | Katalogdagi **qismdan vaqt kesiladi** — fayl ko'chirilmaydi | `openTrimmer()` (app.js) |

**Clip cheklovlari:** faqat seek qilinadigan manbalar ishlaydi
(`direct`/`file`/`hls`). `embed` (YouTube/iframe) dan → *"Bu manba
YouTube/iframe ko'rinishida — undan bo'lak kesib bo'lmaydi"*, `none` dan →
alohida xabar.

**Moderatsiya:** yangi reel `status=0` (kutilmoqda) — oqimda ko'rinmaydi.
Admin `admin-reels.php` da tasdiqlaydi (1) yoki rad etadi (2, sabab bilan).
Rad etilgan reel stream `403` qaytaradi; muallif va admin o'z ko'rallarini
ko'ra oladi.

**Endpointlar:** `api/reels.php` (feed/like/view/delete/mine),
`api/reel-create.php` (clip), `api/reel-upload.php` (saytdan yuklab Telegram
kanalga joylash), `api/reel-intent.php` (zaxira: botga qo'lda yuborish),
`api/reel-moderate.php` (admin), `api/reel-authors.php` (reklamachilar).

**Muhim:** foydalanuvchi videoni **saytda** tanlaydi; `api/reel-upload.php`
uni **to'g'ridan-to'g'ri Telegram kanalga** (`REELS_CHANNEL`) joylaydi va
serverdagi vaqtinchalik faylni darhol o'chiradi — saytda fayl SAQLANMAYDI.
Tomoshabinlar videoni Telegram'dan ko'radi (`t.me/...`), shu bois sayt
serveriga og'irlik tushmaydi. `api/content-upload.php` (admin poster fayli)
ataylab o'chirilgan (410) — poster faqat URL bilan saqlanadi.

Limitlar: `REEL_MAX_UPLOAD_MB` (50), `REEL_MIN/MAX_LENGTH` (3–90 s), hajm
`min(post_max_size, upload_max_filesize, REEL_MAX_UPLOAD_MB)` = amaliy chegara
(`REEL_EFFECTIVE_MAX_UPLOAD_MB`).

**Tez o'ynash (streaming):** `<video>` `tg-cdn-worker.js` orqali Telegram'dan
**progressiv** oqadi — `bytes=0-` so'rovi 200 + oqim bilan javob oladi, ya'ni
videoning boshi darhol ochiladi, qolgani ko'rish davomida yuklanadi (seek
uchun alohida Range so'rovlari 206 bilan xizmat qiladi). Aktiv reel tez
tayyor bo'lsa (`TgStream` `onReady`), `reels.js` **keyingi** reelning
hujjatini oldindan tayyorlaydi (`TgStream.prefetch`) — keyingi slaydga
o'tish bir zumda. Slayd tashlab ketilsa `cancelPrefetch()`, boshqa bo'limga
o'tilganda esa `TgStream.release()` oqim va prefetch'ni darhol to'xtatadi
(fon yuklamasi yangi sahifani sekinlashtirmaydi). `reels.php` sahifa
ochilishidanoq `TgStream.warm()` + `verify()` ni chaqiradi — Service Worker
va GramJS klient **birinchi** reel bosilishidan oldin tayyor bo'ladi (aks
holda `ensureWorker()` 6 soniyagacha kutib yoki sahifani qayta yuklab,
"video ochilmayapti" degan taassurot berardi).

---

## 🛡 Admin huquqlari

Admin = `.env` dagi `ADMIN_TELEGRAM_IDS` (masalan `999111003`). Bunga
`users.is_premium` **aloqasi yo'q** — premium to'lovchi mijoz, admin esa
boshqaruvchi. Tekshiruv: `Auth::isAdmin()` / `requireAdmin()`.

**Admin sahifalari:**
- `admin-content.php` — kontent + qismlar CRUD, video yuklash (`uploads/videos/`)
- `admin-reels.php` — reels moderatsiya (tasdiqlash / rad etish / o'chirish)

---

## 📤 Telegram'ga yetkazib berish (qism darajasida)

`includes/TelegramDelivery.php` + `api/telegram-save.php` — **har bir qism
uchun alohida**:

| Holat | HTTP | Nima |
|---|---|---|
| Yuborildi / allaqachon yuborilgan | 200 | `telegram_file_id` takror ishlatiladi |
| `/start` kerak | 428 | `need_start` — UI bot tugmasi ko'rsatadi |
| Xato | 500/502 | Telegram xabari |

Telegram **faqat 50 MB** gacha yuklashga ruxsat beradi — katta fayllar uchun
Local Bot API server kerak. `protect_content=true`.

---

## 📺 Playback (api/stream.php)

- `Range`/`206 Partial Content` — `upload_max_filesize=256M`, `post_max_size=256M`
  kerak (php.ini).
- `uploads/` ichidagi fayllarni beradi, `realpath()` bilan path traversal
  himoya qilinadi.
- `GET api/stream.php?id=N` (katalog qismi) yoki `?reel=N` (reels).
- Reels uchun tasdiqlanmagan fayl 403.

**Manba turlari** (URL'dan avtomatik aniqlanadi):
`direct` (`.mp4` va h.k., seek ✓) · `file` (sayt ichki `/api/stream.php` yoki
`SITE_URL` prefiksli, seek ✓) · `hls` (`.m3u8`, hls.js) · `embed`
(YouTube/iframe, seek ✗) · `none` (manba yo'q, ogohlantirish).

---

## 🔐 Login (HMAC)

`includes/TelegramBot.php::validateInitData()` — rasmiy Telegram algoritmi:
`data_check_string` bilan `HMAC_SHA256(secret="WebAppData", data=token)`.
`hash_equals()` + `auth_date` yoshi ≤ 1 kun. Soxta `initData` ishlamaydi.

Demo login faqat `localhost` + `ALLOW_DEMO_LOGIN=1` (+ Host tekshiruvi bilan).

---

## ⚙️ O'rnatish

1. **Apache + PHP 8.x + MySQL** (XAMPP). php.ini'da:
   `post_max_size=256M`, `upload_max_filesize=256M`, `max_input_time=300`.
2. DB import: `database.sql` (asos), `migrate.sql` + `migrate-reels.sql`
   + `migrate-reels-telegram.sql` (yangilanishlar uchun).
3. `.env` (repo'ga yozilmaydi, `.gitignore` da):
   ```env
   TELEGRAM_BOT_TOKEN=...
   ADMIN_TELEGRAM_IDS=999111003
   REEL_MAX_UPLOAD_MB=50
   REELS_REQUIRE_APPROVAL=1
   REELS_CHANNEL=@your_public_reels_channel
   ALLOW_DEMO_LOGIN=1
   APP_DEBUG=1
   ```
   > `REELS_CHANNEL` — ommaviy Telegram kanal. Bot (`@...`) shu kanalga
   > **admin** qilib qo'shilishi va **Post Messages** huquqi bo'lishi shart.
4. Tunnel (Mini App HTTPS talab qiladi): `start-tunnel.bat` →
   BotFather'da `/setmenubutton` ga yangi URL bering.
5. Telegram'da botga **`/start`** yuboring (428 need_start holatini yo'q qiladi).

---

## 🗂 Fayl tuzilishi

```
tele_uzdub/
├── config.php               # Sozlamalar (env_value orqali, token .env'dan)
├── database.sql             # To'liq sxema
├── migrate.sql / migrate-reels.sql
├── start-tunnel.bat         # HTTPS tunnel (Cloudflare quick tunnel)
├── index.php                # Bosh sahifa + player
├── login.php / logout.php
├── bot.php                  # Bot webhook (menyu, havola)
├── mini-app-setup.php       # BotFather sozlash qo'llanmasi
├── reels.php                # Reels vertikal oqim
├── reels-upload.php         # Reels fayl yuklash
├── admin-content.php        # ★ Kontent boshqaruvi (admin)
├── admin-reels.php          # Reels moderatsiya (admin)
├── includes/
│   ├── bootstrap.php        # Kirish qatlami: ok/fail, input, esc, ini_bytes,
│   │                        #   requireAdmin, session
│   ├── Database.php         # PDO wrapper (insert/update/delete, errmode)
│   ├── TelegramBot.php      # Bot API + initData HMAC
│   ├── Auth.php             # Login/session
│   ├── Catalog.php          # Kontent/qismlar, playback, kategoriyalar
│   ├── Reels.php            # Reels CRUD, clip/upload, moderatsiya, like/view
│   └── TelegramDelivery.php # Qismni Telegram'ga yuborish
├── api/
│   ├── catalog.php, content.php, genres.php, home.php, like.php,
│   │   views.php, progress.php, watchlist.php
│   ├── stream.php           # Range video oqimi
│   ├── telegram-save.php    # Qismni chat'ga (POST) / holat (GET)
│   ├── content-admin.php    # ★ Kontent CRUD (admin)
│   ├── content-upload.php   # O'CHIRILGAN (fayl yuklash yo'q, 410)
│   ├── reels.php            # Reels feed/action
│   ├── reel-create.php      # Clip yaratish (episode kesish)
│   ├── reel-intent.php      # Telegram kanalga yuborishni boshlash
│   ├── reel-upload.php      # O'CHIRILGAN (fayl yuklash yo'q, 410)
│   ├── reel-moderate.php    # Reels moderatsiya (admin)
│   └── reel-authors.php     # Reklamachi reytingi
├── assets/
│   ├── css/style.css, reels.css
│   └── js/app.js            # Player, #t=NN seek, trimmer (#actClip)
└── uploads/                 # reels/, videos/, test/ (serverda)
```

---

## 🔧 Muhim sozlamalar (config.php)

| Doimiy | Nima | Standart |
|---|---|---|
| `SITE_URL` | Sayt manzili | so'rovdan avtomatik / `SITE_URL` env |
| `ALLOWED_HOSTS` | Ruxsat etilgan domenslar | localhost + tunnel |
| `ADMIN_TELEGRAM_IDS` | Admin Telegram ID ro'yxati | `.env` |
| `ALLOW_DEMO_LOGIN` | Demo login (faqat localhost) | `1` |
| `APP_DEBUG` | Xato ko'rsatish | `1` |
| `TELEGRAM_DELIVERY_ENABLED` | 4-qadam | `1` |
| `TELEGRAM_MAX_UPLOAD` | Bot API yuklash (50 MB) | 50 MB |
| `REEL_MAX_UPLOAD_MB` | Reels fayl chegarasi | 50 |
| `REELS_REQUIRE_APPROVAL` | Tasdiqlashsiz oqimda ko'rinmasin | `1` |
| `REELS_CHANNEL` | Reels saqlanadigan ommaviy Telegram kanal | `@...` |
| `CONTENT_MAX_UPLOAD_MB` | Kino video chegarasi | 200 |
| `REEL_MIN_LENGTH` / `REEL_MAX_LENGTH` | Clip uzunligi | 3 / 90 s |

Production'da: `ALLOW_DEMO_LOGIN=0`, `APP_DEBUG=0`, sinov
`ADMIN_TELEGRAM_IDS` ni almashtiring, bot tokenini aylantiring
(`/revoke`).

---

## 🧪 Tekshirish

E2E HTTP testlar (Temp'da, `localhost` ga qarshi ishlaydi):

| Test | Qamrov | Holat |
|---|---|---|
| `t3_e2e.php` | Katalog, playback, like, progress, watchlist | 94/94 |
| `t4_reels.php` | Clip/upload, feed-gating, moderatsiya, delete | 132/132 |
| `t5_content_admin.php` | Kontent CRUD, video yuklash, cascade | 35/35 |

Ular baza holatini o'zlari tozalaydi va tiklaydi.

---

## 🔀 Telegram t.me havolalari va Cloudflare Worker (ixtiyoriy)

### t.me postlari qanday o'ynaydi
Sayt t.me post havolasini 4 holatda hal qiladi (server tekshiradi, 6 soat kesh):

| Holat | Natija |
|---|---|
| Postda **haqiqiy video** bor (ochiq kanal, embed ruxsat) | ➤ HTML5 playerimizda CDN to'g'ridan-to'g'ri o'ynaydi |
| Embed media ko'rinadi | ➤ Telegram iframe playeri |
| Media yopiq (*"Please open Telegram"*) | ➤ Poster + aniq xabar + «Telegram'da ochish» tugmasi |
| Post umuman ko'rinmaydi | ➤ Aniq xabar |

**Muhim:** yopiq kanal yoki "Media is too big" bo'lgan postlar uchun Telegram
anonimga video fayl havolasini **umuman bermaydi** — hech qanday proxy (Cloudflare
ham) buni o'nglay olmaydi. Bunday kontent uchun ishonchli yo'l — yuqoridagi
«📥 Telegram'dan yuklab olish» (bot kanal admini bo'lganda istalgan hajm olinadi)
yoki «⬆️ Videoni serverga yuklash».

### Cloudflare Worker (edge streaming proxy)
Ochiq kanal video postlarida CDN URL **to'g'ridan-to'g'ri** brauzerga yuboriladi.
Ba'zi hollarda Telegram CDN referer/hotlink himoyasi yoki URL imzosining muddati
tugashi tufayli oqim buzilishi mumkin. Buni hal qilish uchun ixtiyoriy Cloudflare
Worker qo'shilgan:

1. `deploy/cloudflare-worker.js` ni dash.cloudflare.com → Workers → Create
   Worker → joylashtiring → Deploy.
2. `.env` ga worker manzilini yozing:
   ```
   CLOUDFLARE_WORKER_URL=https://<domen>.workers.dev
   ```
   Bo'sh bo'lsa (default) — CDN to'g'ridan-to'g'ri o'ynaydi, worker funksiyasi o'chiq.
3. So'ng oqim `?url=<Telegram-CDN-havolasi>` orqali Cloudflare CDN'dan uzatiladi:
   Range (206)/seek ishlaydi, hostgingizga yuk tushmaydi, kuniga 100 000 so'rov
   bepul tarifda.

Worker **faqat** `telesco.pe` / `cdn-telegram.org` domenlariga so'rov yuboradi
(SSRF himoya) — boshqa manzil 403.

### 📥 Telegram'dan video yuklab olish (katta filmlar uchun — «Media is too big»)
Telegram veb-prevyusi **faqat kichik videolarni** (~20 MB gacha) anonim oqimlaydi.
To'liq film fayli qo'yilsa Telegram *"Media is too big"* deydi va video faqat ilova
ichida ochiladi — na CDN havola, na Cloudflare Worker buni o'nglay olmaydi.

**Yechim:** sayt bot (MTProto — **MadelineProto** kutubxonasi) orqali videoni
**kanalning o'zidan** serverga yuklab oladi, so'ng o'zi oqimlaydi
(`api/stream.php`, Range/206). Tomoshabin cheklovi yo'q — Telegram'ga bog'liqsiz.

Sozlash (bir marta, ~5 daqiqa):

1. **Kutubxona** (allaqachon o'rnatilgan): `composer require danog/madelineproto`
2. **API ID + API HASH** — https://my.telegram.org → "API development tools" →
   "Create application" → chiqqan `api_id` (son) va `api_hash` (satr) ni `.env` ga yozing:
   ```
   API_ID=12345678
   API_HASH=0123456789abcdef0123456789abcdef
   ```
3. **Botni kanalga ADMIN qiling** — Telegram → kanal → "Administrators" →
   botni qo'shing (kerak bo'lsa @BotFather orqali yangi bot yarating). Shunda bot
   kanalning istalgan postini (eski yozilganlarini ham) o'qiy oladi.
4. Admin panel → qism formasi → «📥 Telegram'dan yuklab olish» — t.me havolani
   qo'yib tugmani bosasiz. Yuklanish fon jarayonida boradi (progress ko'rinadi),
   tugagach `video_type=file` bo'lib addan saqlaysiz.

> Ixtiyoriy boshqa telegram yordamchi botlari (Telethon/Pyrogram) ham o'rnatilishi
> mumkin — lekin MadelineProto pure-PHP, qo'shimcha server talab qilmaydi.

---

## ⚠️ Cheklovlar

1. **Bot 50 MB dan katta faylni foydalanuvchiga YUBORA olmaydi** — kattaroq uchun
   Local Bot API server kerak. (Saytga kino olish boshqa yo'l: MTProto pull
   istalgan hajmni `uploads/videos/`ga tushiradi, cheklov faqat disk hajmi.)
2. **Foydalanuvchi `/start` bosishi shart**, aks holda 428 `need_start`.
3. **Embed manbadan "bo'lak" kesib bo'lmaydi** — katalogda direct/file
   manba bo'lgan qism zarur.
4. **`telegram` oqim rejimida token ochiq qoladi** — maxfiy kontentga
   ishlatmang (`VIDEO_PLAYBACK_MODE=auto` — default).
5. **Mini App faqat Telegram ichida ishlaydi** — oddiy brauzerda tokensiz
   login o'tmaydi.
6. **TryCloudflare tunnel manzili har restartda o'zgaradi** — BotFather'da
   menu tugmasi yangilanishi kerak; tugatgach tunnelni o'chiring.

---

## 🐛 Muammolar

| Holat | Yechim |
|---|---|
| Reels moderatsiya ro'yxati bo'sh | `esc()` helper borligini tekshiring; API JSON xatolar uchun `display_errors` API'da o'chirilgan |
| Clip "Bu manba..." xatosi | Qism `direct`/`file`/`hls` bo'lishi kerak, embed emas |
| Yuklash "Fayl juda katta" (413) | php.ini `post_max_size` / `upload_max_filesize` ni oshiring |
| Reels stream 403 | Reel tasdiqlanmagan yoki rad etilgan |
| 428 `need_start` | Botga `/start` yuboring |
| O'chirilganda fayl diskda qolib ketaveradi | Windows'da qisqa vaqt fayl qulflanishi mumkin — `Reels::unlinkWithRetry` buni hal qiladi |