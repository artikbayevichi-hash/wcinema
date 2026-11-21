# Tez kadr (instant) + intro klipilarni serverda yaratish

## Maqsad

Foydalanuvchi video bosganda **3 bosqichli zanjir** ishlaydi:

1. **Instant kadr** — 1 s, 240p, ~100–200 KB. Sekin (2G/3G) internetda ham
   birinchi kadr **~2 s ichida** chiqadi.
2. **Intro** — mavjud 19 MB lik qisqa klip (taxminan 11–20 s).
3. **Asl video** — to‘liq film (1 GB+).

Ikkala klip ham `wcinemaflash` guruhida **alohida post** sifatida turadi.
Sayt DB’sida (`telegram_preview` jadvali) faqat ularning metadata’si saqlanadi:
intro uchun `preview_channel`, `preview_post`, `size`, `w/h/dur`; instant uchun
`instant_channel`, `instant_post`, `instant_size`, `instant_w/h/dur`.
`telegram_meta` ga hech qanday o‘zgartirish kiritilmaydi.

**Nega 19 MB ning o‘zi yetmaydi?** Sekin tarmoqda 19 MB bir necha soniya
(ko‘pincha 5–15 s) yuklanadi — 2 s maqsadga erishib bo‘lmaydi. Shuning uchun
server shu 19 MB lik bo‘lakdan **qo‘shimcha yuklab olmasdan**, lokal FFmpeg
bilan 1 s lik ~150 KB MP4 yasaydi va uni ham guruhga yuklaydi.

**Muhim:** Telegram Bot API’da “tayyor videoni kesib ber” degan metod yo‘q.
Shuning uchun klip yaratish uchun video baytlarini Telegram’dan o‘qish kerak.
Lekin **to‘liq film (1 GB+) hech qachon yuklanmaydi** — faqat boshlang‘ich
~19 MB olinadi. Bu ishni interneti tez server bajaradi; foydalanuvchining
sekin interneti va sayt origin’i video baytlarida ishtirok etmaydi.

## Oqim

```
[lokal kompyuter]  --export-job-->  job.json  (faqat kanal/post, ~2 KB)
        |                                  |
        |                                  v
        |                          [server / yaxshi internet]
        |                          --run --workers=4
        |                          faqat 19 MB head olinadi:
        |                            1) 19 MB intro   -> wcinemaflash posti
        |                            2) lokal FFmpeg: 1 s, 240p ~150 KB
        |                               instant      -> wcinemaflash posti
        |                                  |
        |                                  v
[lokal kompyuter]  <--import--  results.json  (faqat metadata, ~40 KB)
```

Pleyer: `instant -> intro -> asl video`. Instant yaratish xato bersa,
pleyer avvalgidek `intro -> asl video` tartibida ishlayveradi (hech qanday
xato ko‘rsatilmaydi).

## 1. Server tayyorlash (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y php-cli php-curl php-mbstring php-xml php-zip \
  php-gmp php-bcmath php-sqlite3 php-intl ffmpeg git unzip
php -v
php -m | grep -E 'curl|mbstring|gmp|bcmath'
ffmpeg -version | head -1
```

Loyihani serverga yuklang (`vendor/` bilan yoki keyin `composer install`):

```bash
cd /var/www
git clone <REPO_URL> tele_uzdub
cd tele_uzdub
composer install --no-interaction --optimize-autoloader
mkdir -p storage/mtproto storage/cache/preview
chmod -R 775 storage
```

Serverda **MySQL kerak emas** — `--run` rejimi DB’ga ulanmaydi.

## 2. Server `.env`

`.env` ichiga faqat Telegram sozlamalari yoziladi:

```dotenv
API_ID=31336588
API_HASH=<my.telegram.org dan olingan hash>
TELEGRAM_BOT_TOKEN=<BotFather tokeni>
TELEGRAM_BOT_USERNAME=w_cinema_uz_bot

TG_PREVIEW_CHANNEL=wcinemaflash
TG_PREVIEW_SEC=20
TG_PREVIEW_HEIGHT=480
TG_PREVIEW_MAX_MB=5
TG_PREVIEW_CLIP_MB=19

# INSTANT KADR (birinchi kadr 2 s ichida): 1 s, 240p, ~150 KB.
# 19 MB intro'dan OLDIN o'ynatiladi. Qo'shimcha yuklab olish yo'q —
# allaqachon olingan 19 MB lik bo'lakdan lokal FFmpeg bilan yaratiladi.
TG_PREVIEW_INSTANT_SEC=1
TG_PREVIEW_INSTANT_HEIGHT=240
TG_PREVIEW_INSTANT_KB=160

FFMPEG_BIN=/usr/bin/ffmpeg
PHP_CLI_BIN=/usr/bin/php
TG_BOT_API_BASE=
```

```bash
chmod 600 .env
```

`TG_BOT_API_BASE=` **bo‘sh** bo‘lishi shart — bulutli Bot API katta fayllarda
`file is too big` qaytaradi. Klip MTProto orqali olinadi va yuklanadi.

Bot `wcinemaflash` guruhiga admin qilingan bo‘lishi va `wcinemauz` postlarini
o‘qish huquqi bo‘lishi kerak.

## 3. Lokal: vazifa faylini chiqarish

```bash
C:\xampp\php\php.exe cli/preview-server.php --export-job=storage/cache/preview/job.json --force --limit=55
```

Natija: `storage/cache/preview/job.json` ichida faqat:

```json
{"version":1,"clip_mb":19,"pairs":[{"ch":"wcinemauz","post":15}, ...]}
```

Faylni serverga yuklang:

```bash
scp storage/cache/preview/job.json user@SERVER:/var/www/tele_uzdub/storage/cache/preview/job.json
```

## 4. Server: bitta video bilan sinov

```bash
cd /var/www/tele_uzdub
php cli/preview-server.php \
  --run \
  --job=storage/cache/preview/job.json \
  --results=storage/cache/preview/results.json \
  --ch=wcinemauz --post=12 --force
```

Kutilgan natija:

```
Bot sessiyasi ochiladi (DB kerak emas)...
[1/1] wcinemauz/12 ... OK 18.14 MB + instant 128 KB  95.2s
Ishchi tugadi: ok=1, xato=0, oldin bor=0
```

`instant YO'Q` deb chiqsa — instant klip yaratilmadi (FFmpeg xatosi yoki
Bot API rad etdi). Bu xato emas: pleyer eski `intro -> asl video` tartibida
ishlayveradi. Sababini loglardan qarang.

Tekshirish:

```bash
php cli/preview-server.php --summary=storage/cache/preview/results.json
```

`results.json` ichida shunday qator bo‘lishi kerak:

```json
{
  "channel": "wcinemauz",
  "post": 12,
  "preview_channel": "wcinemaflash",
  "preview_post": 901,
  "size": 19025356,
  "status": "ok",
  "w": 1920,
  "h": 1080,
  "dur": 12,
  "instant": {
    "ch": "wcinemaflash",
    "p": 902,
    "size": 131072,
    "w": 426,
    "h": 240,
    "dur": 1
  }
}
```

`instant` bloki import paytida `instant_*` ustunlariga yoziladi. Eski bazada
ustunlar yo‘q bo‘lsa, `TgPreview::ensure()` ularni avtomatik qo‘shadi
(`telegram_meta` ga tegmaydi).

## 5. Server: barcha videolarni parallel qilish

```bash
php cli/preview-server.php \
  --run \
  --job=storage/cache/preview/job.json \
  --results=storage/cache/preview/results.json \
  --workers=4 --force --limit=55
```

Har ishchi o‘z sessiyasida (`storage/mtproto/p0..p3`) ishlaydi.
Loglar: `storage/cache/preview/server_worker_0.log` ... `server_worker_3.log`.

Xatolik chiqqan juftliklar `results.json` ichida `status=error` bilan qoladi.
Qayta urinish uchun ularni qayta ishga tushiring — `offlineWrite` eski
qatorni yangilaydi.

## 6. Lokal: natijani sayt DB’ga import qilish

```bash
scp user@SERVER:/var/www/tele_uzdub/storage/cache/preview/results.json storage/cache/preview/results.json
C:\xampp\php\php.exe cli/preview-server.php --import=storage/cache/preview/results.json
```

Faqat `status=ok` qatorlari yoziladi. `telegram_meta` ga hech qanday
o‘zgartirish kiritilmaydi.

## 7. Tekshiruv

```sql
SELECT channel, post,
       preview_channel, preview_post, size, dur,
       instant_channel, instant_post, instant_size, instant_dur, status
FROM telegram_preview
WHERE status='ok'
ORDER BY t DESC
LIMIT 10;
```

Keyin saytda istalgan filmni ochib tekshiring:

1. **Birinchi kadr 2 s ichida chiqadi** — bu 1 s lik instant klip (ko‘k
   spinner o‘rnida darhol tasna ko‘rinadi). Tarmoqni sekinlashtirib
   (Chrome DevTools → Network → Fast 3G) sinab ko‘ring.
2. Instant tugagach (1 s) **19 MB intro** boshlanadi, u tugagach **asl video**.
3. Qism almashtirganda (`switchEpisode`) player yangilanadi, lekin tavsif,
   izohlar va tavsiyalar **o‘zgarib qolmaydi** — faqat qism almashadi.

`__WCPREVIEW` inline ma'lumotida `instant` bloki borligini HTML manbasidan
ham tekshirish mumkin (`window.__WCPREVIEW = {...}`).

## Nima qilinmaydi

- To‘liq video hech qaerda yuklanmaydi/saqlanmaydi.
- Instant klip **qo‘shimcha yuklab olishsiz**, allaqachon olingan 19 MB
  bo‘lakdan yaratiladi — bot videoni yuklab o‘tirmaydi.
- Sayt origin’i video baytlarini bermaydi (baytlar faqat brauzer ↔ Telegram).
- `HLS_MODE` yoqilmaydi (default `off`); buzilgan HLS hech qachon asosiy
  oqimni to‘sib qo‘ymaydi.
- `TG_PREVIEW_CLIP_MB` 19 dan oshirilmaydi.
- Sequential fallback yo‘q — faqat parallel ishchilar.
- Viewer akkaunti faqat `source='gram'` doc metadata’siga ishonadi; bot
  tomonidan yozilgan `file_reference` ishlatilmaydi
  (`FILE_REFERENCE_INVALID` xatosining oldini oladi).
