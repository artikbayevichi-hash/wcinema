# Videoni strimingga tayyorlash (VideoPrep)

Maqsad: **har bir video birinchi so'rovdanoq o'ynasin**. Buning uchun har bir
fayl quyidagi talablarga javob berishi kerak:

| Talab | Nega |
|---|---|
| **H.264** (yuv420p) | barcha brauzer, iOS/Android, Smart TV qo'llab-quvvatlaydi |
| **AAC** 128k stereo 48 kHz | audio ham hamma joyda ishlaydi |
| **MP4** konteyner | `video/mp4` — eng keng tarqalgan |
| **faststart** (`moov` boshida) | pleyer butun faylni kutmasdan boshlaydi |
| **kalit kadr har 2 s** (`-g 48 @24fps`) | seek tez, HLS segmentlari toza |
| **≤ 1080p**, ≤ 2800 kbps | sekin internetda ham oqadi, trafik arzon |

Tekshiruv va tuzatish bitta joyda: `includes/VideoPrep.php`.

## Rejimlar

`.env`: `VIDEO_PREP=off|faststart|remux|normalize|auto` (standart `auto`).

| Rejim | Nima qiladi | Qayta kodlaydimi |
|---|---|---|
| `off` | hech narsa (tekshirish ham yo'q) | yo'q |
| `faststart` | `moov`ni boshiga ko'chiradi; MP4 bo'lmasa remux | yo'q |
| `remux` | konteynerni MP4 qiladi, oqimlarni nusxalaydi | yo'q |
| `normalize` | to'liq H.264/AAC transcode, 2 s GOP, ≤1080p | ha |
| `auto` | **CLI → `normalize`**, **web → `faststart`** | — |

Muhim: `faststart`/`remux` **hech qachon** qayta kodlamaydi. Agar fayl
H.264/AAC bo'lsa-yu, faqat konteyner yoki `moov` joyi noto'g'ri bo'lsa —
nusxalash (remux) bilan tuzatiladi. Kodek boshqa bo'lsa (HEVC, VP9, Opus) —
transcode kerak.

## Web va CLI farqi

HTTP so'rov ichida uzoq transcode qilish saytni sekinlashtiradi. Shuning uchun:

* **Web** (`Uploader`, `Reels`, `TgPull`): `auto` → `faststart`. Transcode faqat
  kichik fayllarga ruxsat etiladi (`VIDEO_PREP_WEB_MAX_MB` /
  `VIDEO_PREP_WEB_MAX_SEC`). Katta fayl transcode talab qilsa, **asl fayl
  o'zgarishsiz qoladi** va tungi CLI uni tuzatadi.
* **CLI** (`php cli/video-prep.php`): `auto` → `normalize` — hamma narsani
  to'liq tuzatadi, ffmpeg past ustuvorlikda (`HLS_FFMPEG_NICE=1`) ishlaydi.

## .env kalitlari

```
VIDEO_PREP=auto              # off | faststart | remux | normalize | auto
FFMPEG_BIN=ffmpeg            # (mavjud) transcode/remux
FFPROBE_BIN=ffprobe          # tekshiruv (kodek, GOP, faststart)
VIDEO_PREP_HEIGHT=1080       # maksimal balandlik (p)
VIDEO_PREP_BITRATE=2800      # maksimal bitrate (kbps, -maxrate)
VIDEO_PREP_GOP_SEC=2         # kalit kadr oralig'i (soniya)
VIDEO_PREP_WEB_MAX_MB=150    # web'da transcode ruxsat etilgan maks. hajm
VIDEO_PREP_WEB_MAX_SEC=1800  # web'da transcode ruxsat etilgan maks. davomiylik
VIDEO_PREP_TIMEOUT=240       # web transcode timeout (soniya)
```

`ffmpeg`/`ffprobe` bo'lmasa hech narsa buzilmaydi: fayl o'zgarishsiz yuboriladi
va `error_log`ga yoziladi.

## Kunlik tekshiruv va tuzatish

```bash
# 1) Faqat tekshirish (hech narsa o'zgarmaydi). Muammo bo'lsa exit=1.
php cli/video-prep.php
php cli/video-prep.php --dir=uploads/videos --json

# 2) Tuzatish (JOYIDA almashtiradi; xatoda asl fayl tiklanadi)
php cli/video-prep.php --fix

# 3) Faqat tez amallar (qayta kodlashsiz)
php cli/video-prep.php --fix --mode=remux

# 4) Bitta fayl / limit
php cli/video-prep.php --file=uploads/videos/x.mkv --fix
php cli/video-prep.php --fix --max=50 --timeout=1800
```

Chiqish misoli:

```
[BAD] 17.1 MB  big1440.mp4
      h264 2560x1440 | fps 24 | 23838k | aac | faststart | gop 2s | 00:00:06
      sabab: balandligi 1440p (<= 1080p kerak); bitrate 23838k (<= 2800k kerak)
[FIX] 17.1 MB  big1440.mp4
      amal: transcode (normalize), almashtirildi
      natija: ok
      h264 1920x1080 | fps 24 | 3082k | aac | faststart | gop 2s | 00:00:06
```

Tunda avtomatik ishga tushirish (Linux/cron):

```cron
# har kuni 03:30 — katta fayllarni tuzatish
30 3 * * * cd /var/www/wc && php cli/video-prep.php --fix --quiet >> storage/logs/video-prep.log 2>&1
```

Windows (Task Scheduler) uchun:

```
C:\xampp\php\php.exe C:\xampp\htdocs\tele_uzdub\cli\video-prep.php --fix --quiet
```

## Videoning boshini R2'ga oldindan yuklash (`p/<doc>`)

Service Worker pleyer avval `https://<R2 domen>/p/<doc>` dan videoning birinchi
2–4 MB'ini oladi (tez boshlanish), qolganini Telegram'dan. Ilgari bu obyekt
faqat birinchi tomoshabin kelganda yozilardi. `cli/prefix-publish.php` uni
**oldindan** tayyorlaydi — birinchi tomoshabin ham tez ochadi.

Obyekt — asl faylning **baytma-bayt** boshi (qayta kodlanmaydi), uzunligi
`R2_PREFIX_BYTES` va har doim 4096 ga karrali. Shu sababli Telegram davomi
aynan shu chegaradan boshlanadi va pleyer uchun bu bitta fayl bo'lib qoladi.

### Service Worker qanday xizmat qiladi

| Qadam | Xatti-harakat |
|---|---|
| Sahifa yuklandi | `init()` → `api/r2-sign.php?info=1` bir marta olinadi va SW'ga `r2info` xabari bilan uzatiladi |
| Video so'rovi | SW sozlamani **kutmaydi**: tayyor bo'lsa darhol, bo'lmasa ko'pi 700 ms |
| `Range` prefiks ichida | javob CDN'dan (`X-WC-R2: 1`), Telegram'ga murojaat yo'q |
| `Range` prefiksdan narida | Telegram'dan (avvalgidek) |
| Prefiks yo'q (404) | o'sha hujjat uchun 5 daqiqa eslab qolinadi — har seek'da CDN so'ralmaydi |
| R2 javob bermadi | 30–60 s tanaffus (circuit breaker), oqim Telegram'dan davom etadi |
| `put:false` | faqat o'qish — oldindan yuklangan prefikslar baribir ishlaydi |

Doc id — `api/tg-doc.php?url=<t.me/...>` javobidagi `id`.

```bash
# Bitta video
php cli/prefix-publish.php --doc=123456789 --file=uploads/videos/x.mp4 --verify

# Ro'yxat bo'yicha
php cli/prefix-publish.php --manifest=storage/prefix-manifest.json
php cli/prefix-publish.php --manifest=... --dry-run
php cli/prefix-publish.php --manifest=... --force --verify
php cli/prefix-publish.php --prune           # reestrdagi o'chgan fayllarni remote'dan ham o'chiradi
```

Manifest (JSON) — ikki ko'rinish:

```json
[ { "doc": 123456789, "file": "uploads/videos/x.mp4" } ]
```

```json
{ "123456789": "uploads/videos/x.mp4" }
```

Sozlamalar (`.env`): `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`,
`S3_SECRET_KEY`, `R2_PUBLIC_BASE` (tekshiruv uchun), `R2_PREFIX_BYTES`
(standart `4194304` = 4 MB; 1–8 MB, 4096 ga karrali).

Obyekt **bucket ildizida** yotadi (`p/<doc>`), HLS esa `S3_PREFIX=hls` ostida —
shuning uchun CLI `S3Client::withPrefix('')` bilan yozadi.

Reestr: `storage/cache/r2-prefix-published.json`. Faylning hajmi va SHA-256
o'zgarmasa, obyekt qayta yuklanmaydi.

## R2 tayyorligi: o'qish va yozish alohida

`api/r2-sign.php?info=1`:

```json
{ "success": true, "enabled": true, "base": "https://cdn-r2.example.uz",
  "prefix": 4194304, "put": true, "ttl": 900, "min": 4096 }
```

| Maydon | Ma'nosi |
|---|---|
| `enabled` | **o'qish** tayyor: `R2_ENABLED=1` + (`R2_PUBLIC_BASE` yoki `R2_WORKER_URL`) |
| `put` | **yozish** tayyor: qo'shimcha `R2_WORKER_URL` + `R2_SIGN_SECRET` |

Ya'ni `cli/prefix-publish.php` bilan oldindan yuklangan prefikslar faqat
`R2_PUBLIC_BASE` bilan ham ishlaydi (imzo faqat brauzer PUT uchun kerak).
Yozish o'chirilgan bo'lsa SW hech narsa yozmaydi — faqat o'qiydi.

## Tekshirish

```bash
# Bitta fayl qo'lda
ffprobe -v error -show_entries stream=codec_name,width,height,pix_fmt -of default=nw=1 x.mp4
# faststart: moov mdat'dan oldin bo'lishi kerak
ffprobe -v trace -i x.mp4 2>&1 | grep -m1 -E "type:'(moov|mdat)'"
# kalit kadrlar
ffprobe -v error -select_streams v:0 -show_entries frame=key_frame,pts_time -read_intervals %+12 -of csv x.mp4
```

`php cli/video-prep.php --file=x.mp4` — yuqoridagilarning hammasini bir
chiqishda ko'rsatadi.

## Muammo bo'lsa

| Belgi | Yechim |
|---|---|
| `ffprobe mavjud emas` | `FFPROBE_BIN` yo'lini tekshiring (`where ffprobe`) |
| video 1-2 s kutib boshlanadi | `moov` oxirida — `--fix --mode=remux` |
| iOS'da o'ynamaydi | HEVC/VP9 — `--fix` (transcode) |
| seek sekin | GOP > 2 s — `--fix` (transcode) |
| web upload sekinlashdi | `VIDEO_PREP_WEB_MAX_MB` ni kamaytiring yoki `VIDEO_PREP=faststart` |
| `p/<doc>` 404 | `--verify` bilan qayta yuklang; `R2_PUBLIC_BASE` to'g'rimi? |
| qayta-qayta yuklaydi | reestr yozilmayapti — `storage/cache` yozish huquqini tekshiring |
