# W CINEMA: Telegram oqimi, HLS, Nginx va PHP-FPM

## Telegram'dan to'g'ridan-to'g'ri progressiv oqim

`tg-cdn-worker.js` videoni brauzer orqali Telegram'dan oladi; media baytlari sayt serveridan o'tmaydi. Range'siz progressiv javobning birinchi bo'lagi 128 KiB bilan boshlanadi. `bytes=0-` kabi ochiq Range so'rovi uchun worker 2 MiB gacha dastlabki bo'lak qaytaradi. Keyingi ma'lumotlar ko'rish davomida Telegram'dan olinadi. Cheklangan navbat va backpressure butun videoni brauzer xotirasiga yig'ib qo'ymaslikka yordam beradi; sahifa yopilsa yoki seek qilinsa keraksiz o'qish to'xtatiladi.

### Loyihaga kiritilgan o'zgarishlar

- Sovuq HLS keshi bo'lgan ommaviy `t.me` postlari uchun sayt butun videoni oldindan yuklaydigan worker ishga tushirmaydi; player to'g'ridan-to'g'ri Telegram yo'liga o'tadi. Tayyor HLS kesh bo'lsa production host undan foydalanishi mumkin.
- `watch.php` player ishga tushishidan oldin Service Worker'ni tayyorlaydi va odatiy tarmoqda faqat dastlabki 128 KiB ni qizdiradi. Data Saver yoki 2G rejimida video baytlari oldindan olinmaydi.
- `tg-stream.js` shu sahifadagi tayyor metadata keshini avval ishlatadi, server metadata so'rovini Service Worker tayyorlanishi bilan parallel boshlaydi va noaniq fayl nomi uchun to'liq format tekshiruvini kutmasdan native playerni sinab ko'radi. Format mos kelmasa mavjud xato tekshiruvi adaptive yo'lga o'tkazadi.
- GramJS zaxira oqimida Telegram `file_reference` endi SDK kutadigan `Buffer` turiga aylantiriladi; bu `Bytes or str expected, not object` serializer xatosini bartaraf etadi.
- `tg-cdn-worker.js` birinchi javobni kichikroq beradi va oqim davomida taxminan 10 soniyalik oldinda turuvchi bufferga intiladi. Bu maqsad tarmoq tezligi va navbat chegarasi sabab kafolat emas.
- `api/stream.php` va `api/hls.php` ixtiyoriy Nginx `X-Accel-Redirect` orqali media fayl baytlarini PHP-FPM'dan bo'shatishi mumkin. Buning uchun production Linux'da namuna Nginx sozlamasini haqiqiy serverga moslash kerak; Apache/XAMPP'da eski PHP oqim yo'li qoladi.

`START_BUFFER_SECONDS=10` — oqim davomida taxminan 10 soniyalik navbatni to'ldirish maqsadi; player buning hammasini kutib keyin boshlamaydi. Birinchi bayt yuborilgach worker keyingi bo'laklarni davom ettiradi. Navbat oltita 2 MiB gacha bo'lak bilan chegaralangan, shu sababli 10 soniyalik zaxira ham kafolat emas. Birinchi bayt va kadrning kelish vaqti tarmoq, Telegram javobi, Service Worker tayyorligi, MP4 fayl indeksi (`moov`) hamda kodekka bog'liq. Bir soniyada ochilishini kafolatlab bo'lmaydi. Brauzerning `preload` atributi ham faqat ko'rsatma bo'lib, bajarilishi shart emas ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video)).

## Tez ochilish: minimal MTProto klient (2026-11-05)

Bir soniyada ochilishning eng katta tormog'i **GramJS bundle'i** edi: `tg-client.bundle.js` — 5.4 MB (gzip'da 718 KB). U faqat `upload.getFile` (video baytlarini olish) uchun ishlatilardi, lekin sahifada yuklanishi va parse qilinishi (~570 ms Node'da, mobil brauzerda ~0.8–1.4 s) **birinchi kadrgacha** to'xtagan edi.

Yechim: shu vazifani bajaradigan **25 KB li minimal MTProto klienti** — `assets/js/tg-mtproto.js`.

### Nima qilindi

| Qatlam | O'zgarish |
|---|---|
| `assets/js/tg-mtproto.js` (yangi, ~46 KB) | MTProto 2.0: AES-256-IGE, SHA-256/1, obfuscated2 transport, TL serializatsiya (`initConnection` → `invokeWithLayer` → `upload.getFile`), javob o'qish (`rpc_result` / `upload.file`). Faqat `upload.getFile` — qolgan barcha Telegram funksiyalari GramJS'da qoladi. |
| `assets/js/tg-stream.js` | `readOnce()` avval tez klientni sinaydi, muvaffaqiyatsiz bo'lsa GramJS yo'liga qaytadi. `init()` Telegram DC'ga ulanishni **sahifa yuklanganda** boshlaydi (TLS handshake HTML parse bilan parallel). Hujjat metama'lumotining brauzer keshi (`localStorage`, 30 daqiqa) qo'shildi. |
| `api/tg-doc.php` (yangi) | Hujjat metama'lumotini (`id` / `access_hash` / `file_reference` / `dc_id`) serverda bir marta yechib, 6 soatga keshlaydi. Javob ~200 bayt — **video yuki bu yerdan o'tmaydi**. Faqat sayt katalogida mavjud (kanal, post) juftliklariga javob beradi. |
| `tg-cdn-worker.js` | MP4 indeksi (`moov`) boshda bo'lmasa, faylning oxiri **parallel** yuklab qo'yiladi. Brauzer indeksni so'raganda javob shu zaxiradan beriladi — bir RTT tejaladi, indeks Telegram'dan ikkinchi marta yuklanmaydi. `moov` boshda bo'lsa (faststart) — umuman yuklanmaydi. |
| `watch.php` | `tg-mtproto.js` `tg-stream.js` dan **oldin** yuklanadi. |

### Oqim

```
sahifa yuklanadi ─┬─ HTML/CSS/JS (~150 KB gzip)
                 ├─ tg-mtproto.js (25 KB) → Telegram DC'ga WebSocket (parallel)
                 └─ localStorage'da hujjat keshi bormi?
                        │ ha (0 ms)          │ yo'q → api/tg-doc.php (~10 ms, server keshi)
                        └────────┬──────────┘
                    GramJS bundle (5.4 MB) YUKLANMAYDI
                                 │
              upload.getFile → Telegram DC → brauzer (sayt serveridan O'TMAYDI)
```

### Nima uchun bu xavfsiz

- Minimal klient **production'da ishlaydigan teleproto/GramJS implementatsiyasidan** bayon qilingan: SHA-256, AES-256-ECB, AES-256-IGE, obfuscated2 handshake, `auth_key_id = SHA1(auth_key)[12..20]`, TL `bytes` qisqa uzunlik kodlash (1 bayt / 254+3), `initConnection` maydon tartibi — hammasi aniq tekshirilgan.
- `.work/tools/tg-mtproto.test.mjs` — **19/19** test o'tadi: SHA/AES Node.js `crypto` bilan, IGE va MTProto paketi teleproto'dan olingan "oltin" vektorlar bilan, TL esa teleproto `Api` klasslari bilan **bayt-an-bayt** solishtiriladi.
- `.work/tools/stream-fastpath.test.mjs` — **35/35**: wiring, MP4 `moov` aniqlash, PHP sintaksisi.
- Tez yo'l ishlamasa (`file_reference` eskirgan, sessiya nosoz, Telegram javob bermasa) — `tg-stream.js` avvalgi GramJS yo'liga qaytadi. Hech qanday holatda oqim butunlay to'xtamaydi.

### Tekshirishni qanday ishga tushirish

```bash
node .work/tools/mtproto-vectors.mjs       # "oltin" vektorlarni qayta yaratish
node .work/tools/tg-mtproto.test.mjs       # kriptografiya + TL bayt-an-bayt  (19/19)
node .work/tools/tg-mtproto-ws.test.mjs    # to'liq ulanish oqimi, mock WS   (35/35)
node .work/tools/stream-fastpath.test.mjs  # wiring + MP4 indeks + sintaksis  (35/35)
node .work/tools/stream-regression.test.mjs# "video ochmayapti" regressiyasi (19/19)
```

> `stream-regression.test.mjs` **joriy arxitekturani** tekshiradi: server metama'lumot yo'li o'chirilgan, tez yo'l localStorage keshidan foydalanadi, `FILE_REFERENCE_*` xatolarida GramJS zaxira yo'liga o'tiladi. `node .work/tools/make-buggy.mjs` esa tuzatishlarni qaytarib beradi — shu bilan test **8 ta assertni yiqitiradi** (xato haqiqatan ushlanadi).

`tg-mtproto-ws.test.mjs` server tomonini mock qiladi: obfuscated2 handshake, intermediate kadrlash, so'rov tanasining to'liq TL tuzilishi (`invokeWithLayer` → `initConnection` → `upload.getFile` → `inputDocumentFileLocation`) va javobning `rpc_result` → `upload.file` orqali qaytishi tekshiriladi.

> `.work/` gitignore qilingan — test fayllari faqat lokal ishlatiladi.

### Qolgan cheklovlar

- Birinchi ochilish hujjat metama'lumoti topilmasa (`telegram_meta` bazasi va disk keshi bo'sh, bot kanalda a'zo emas) — eski GramJS yo'li ishlaydi va `api/tg-doc.php` shu hujjatni keyin baza + disk keshga yozib qo'yadi.
- `file_reference` ~24 soat yashaydi; server keshi 6 soat, brauzer keshi 30 daqiqa — muddati o'tgan metama'lumot eski yo'l orqali yangilanadi.
- MP4 bo'lmagan formatlar (MKV/WEBM) MP4 indeks optimizatsiyasidan foydalanmaydi va `mp4box.js`/FFmpeg konvertatsiyasi talab qiladi.

## Doimiy metama'lumot: `telegram_meta` bazasi (2026-11-17)

Admin panelga qo'shilgan va katalogdagi **barcha** videolarning Telegram metama'lumoti endi bazada doimiy saqlanadi: kanal, post, fayl ID, `access_hash`, `file_reference`, DC, hajm, MIME, fayl nomi, kenglik/balandlik, davomiylik, manba (`bot`/`gram`) va holat (`pending`/`ok`/`error`). Har bir video uchun ~300 bayt — **video baytlari bu yerdan o'tmaydi**, ular to'g'ridan-to'g'ri brauzer → Telegram DC.

| Fayl | Vazifa |
|---|---|
| `includes/TgMeta.php` | Jadvalni o'z-o'zidan yaratadi (`ensure()`), `parseUrl()`, `get()`, `save()`, `savePending()`, `saveError()`, `docToOut()`, `fetchAndStore()`, `fetchManyAndStore()`. |
| `migrations/telegram_meta.sql` | Production uchun aniq schema (qo'lda yaratish uchun). |
| `api/tg-doc.php` | **Avval bazadan**, topilmasa disk keshidan, keyin Telegram'dan o'qiydi; yozish ikkala joyga ham qilinadi. Javobda `source` maydoni bor. |
| `api/content-admin.php` | `create_content` (1-qism), `add_episode`, `update_episode`, `bulk_episodes` — hammasida metadata darhol bazaga yoziladi. Xato jim yutiladi (backfill keyin to'ldiradi). |
| `cli/tg-meta-backfill.php` | Mavjud hamma `episodes` + `reels` havolalarini bir martalik to'ldirish (`--force` bilan qayta yangilash). |
| `cli/tg-meta-warm.php` | Cron isitish endi disk bilan birga bazaga ham yozadi. |

```bash
# Barcha mavjud videolarni bazaga to'ldirish (bir marta):
C:\xampp\php\php.exe cli\tg-meta-backfill.php

# Yangilash/tekshirish:
C:\xampp\mysql\bin\mysql.exe -uroot uzdub -e "SELECT status,COUNT(*) n FROM telegram_meta GROUP BY status;"
curl "http://localhost/tele_uzdub/api/tg-doc.php?posts=wcinemauz%3A71"
```

**Muhim — ijro kanaliga faqat `source='gram'` yozuvi ishlatiladi.** Bazadagi `file_reference` **BOT** sessiyasidan olinadi va tomoshabbin akkauntida `FILE_REFERENCE_INVALID` bilan rad etiladi (pastga qarang). Shuning uchun `assets/js/tg-stream.js` da `USE_SERVER_DOC_META = true` bo'lsa-da, server/inline metama'lumot **faqat** `source='gram'` (tomoshabbin GramJS sessiyasidan kelgan) bo'lgandagina qabul qilinadi; `source='bot'` yozuvlari brauzerda rad etiladi. Birinchi marta video foydalanuvchining o'z sessiyasi bilan ochiladi, so'ngra uning `file_reference` / `access_hash` va h.q. `api/tg-meta-write.php` orqali **gram writeback** qilinadi — keyingi ochilishda tez yo'l (25 KB minimal klient) ishlaydi. `TgMeta::save()` yangi `gram` yozuvini 12 soat davomida bot tomonidan ustiga yozilishdan himoya qiladi. Keyingi qismning birinchi ~1 MB ini oldindan olish (`warmNext()` / `warmNextEpisode()`) barcha turlarga (film, multfilm, serial, anime) bir xil qo'llanadi.

Natija: 55 ta video uchun backfill bajarildi (`ok=55, error=0, pending=0`); `api/tg-doc.php` javobi `cached:true, source:"bot"` va Telegram'ga murojaat qilmay ~270 ms da qaytadi; yangi video qo'shish yo'li (`fetchAndStore`) delete→re-create testida muvaffaqiyatli.

## Tuzatish 2: `file_reference` akkauntga bog'liq — server yo'li o'chirildi (2026-11-08)

`file_reference` **ruxsatnomani olgan akkauntga** bog'liq. `api/tg-doc.php` hujjatni **BOT** sessiyasi bilan yechadi; bot olgan ruxsatnoma **tomoshabbin** akkauntida `upload.getFile` da `FILE_REFERENCE_INVALID` bilan rad etiladi.

Shuning uchun `assets/js/tg-stream.js` da server metama'lumot yo'li yoqilgan, lekin **faqat `source='gram'`** (tomoshabbin o'z sessiyasida olgan) yozuvlar qabul qilinadi:

```js
var USE_SERVER_DOC_META = true;
```

`source='bot'` yozuvlari brauzerda rad etiladi. Tomoshabbin birinchi marta video o'z sessiyasi bilan ochadi, keyin uning havolasi `api/tg-meta-write.php` orqali **gram writeback** qilinadi — keyingi ochilishda tez yo'l ishlaydi. `TgMeta::save()` yangi `gram` yozuvini 12 soat bot tomonidan ustiga yozilishdan himoya qiladi.

### Bu qanday o'zgaradi

| | Avval | Hozir |
|---|---|---|
| Birinchi ochilish | server metama'lumoti (ishlamadi) | GramJS (5.4 MB bundle) — `findDoc()` hujjatni **foydalanuvchi sessiyasi** bilan yechadi |
| Qayta ochilish (30 daqiqa ichida) | server/kesh | **Tez yo'l**: localStorage'dagi `docMetaPut()` yozuvi (foydalanuvchining o'z ruxsatnomasi) + 25 KB minimal klient |
| `file_reference` eskirsa | serverga so'rov (ishlamadi) | GramJS orqali hujjat **qayta yechiladi** → yangi ruxsatnoma |

**Muhim oqibat:** birinchi ochilish tez yo'l bilan emas, GramJS bilan ochiladi. Tez yo'l faqat **localStorage keshi bor** hollarda ishlaydi (video bir marta ko'rilgan va 30 daqiqa ichida qayta ochilgan).

### Bu holatda "video ochilmaydi" belgisining ikkinchi sababi

`refreshDocLoc()` qo'shilingandan keyin `readOnce()` dagi `FILE_REFERENCE_*` xato yo'li **o'z-o'zidan "hali bir urinish" degan ma'noda o'zgarib ketdi**:

```js
if (isFileRefErr(eMsg) && !(ctx && ctx.frRetried)) {
  return refreshDocLoc(S.mountOpts).then(function (ok) {
    if (!ok) throw e;          // ← GRAMJS ZAXIRA YO'LI YO'Q EDI
```

Server yo'li o'chirilgani uchun `refreshDocLoc()` **doim** `false` qaytaradi → `throw e` → xato yuqoriga uzatiladi → SW 502 beradi → **video umuman ochilmaydi**. Xuddi shu holat `readOnceGram()` ichida ham bor edi.

Tuzatish:

- `gramFallback(e)` — yordamchi funksiya: tez yo'l ishlamasa, **eski (GramJS) yo'lga** qaytadi va hujjatni qayta yechadi.
- `readOnce()` va `readOnceGram()` — `FILE_REFERENCE_*` xatolarida **har doim** `gramFallback()` chaqiriladi (server yangilash muvaffaqiyatsiz bo'lsa ham).
- `fastFallback()` — joriy hujjatning eskirgan yozuvlari (`S.pvCache` + localStorage) tozalanadi, shuning uchun qayta mount **eskirgan** yozuvga qaytmaydi.
- `purgeCurrentDocMeta()` — joriy `(kanal, post)` ning localStorage yozuvi o'chiriladi (eskirgan havola qayta ishlatilmasligi uchun).
- `isFileRefErr()` — `/FILE_REFERENCE/` ga kengaytirildi (xato nomi o'zgarsa ham).

## Tuzatish: "video ochmayapti" — `file_reference` bo'sh va fallback sikligi (2026-11-05)

Tez ochilish yo'li ishga tushgandan keyin **video umuman ochilmasligi** xurushi kuzatildi. Tizimli izchillik (`superpowers:systematic-debugging`) va dalillar yig'ish natijasida **uchta real sabab** topildi va tuzatildi.

### Sabab 1 (server): `file_reference` har doim bo'sh qolardi

`api/tg-doc.php` MadelineProto'dan kelgan `document` massivini **noto'g'ri** o'qiyapti:

| Maydon | Haqiqiy qiymat | Eski kod |
|---|---|---|
| `file_reference` | `danog\MadelineProto\TL\Types\Bytes` **obyekti** | `is_string($fr)` → `false` → `fr = ''` |
| atribut sinfi | `documentAttributeVideo` / `documentAttributeFilename` (kichik harfli) | `DocumentAttributeVideo` → mos kelmaydi |
| fayl nomi | `file_name` (snake_case) | `fileName` → mos kelmaydi |

Natija: `upload.getFile` **bo'sh** `file_reference` bilan yuborilardi → Telegram `FILE_REFERENCE_INVALID` beradi → video oqimi ishlamaydi.

Tuzatish: `Bytes` obyekti `(string)` bilan xom binary satrga aylantirilib base64 qilinadi; atribut nomlari **kichik harfli**, `file_name`/`fileName` — ikkalasi ham qo'llab-quvvatlanadi. `fr` bo'sh bo'lsa endpoint **502** qaytaradi (noto'g'ri metama'lumotni berish o'rniga — brauzer eski yo'lga qaytadi). Kesh formatiga `v=2` versiyasi qo'shildi — eski (buzilgan) kesh fayllari avtomatik bekor qilinadi.

### Sabab 2 (brauzer): `fr`siz metama'lumot "ishlatilgan" deb hisoblanardi

`docMetaGet()` / `docMetaFromServer()` / `fastPrefetch()` / `run()` — barchasi `file_reference` **bo'sh** bo'lsa ham metama'lumotni qabul qilardi. Endi `fr` bo'sh yozuvlar **butunlay rad etiladi** (`hasFileRef()` yordamchi funksiyasi).

### Sabab 3 (brauzer): GramJS fallback'i **yetib borolmaydi** edi

Bu — "video umuman ochilmaydi" belgisining asosiy sababi:

1. Tez yo'l `upload.getFile` rad etildi → `fastFallback()` → `mount()` → `run()`.
2. `run()` yana **o'zining eski `S.pvCache` yozuviga** qaytdi (tez yo'ldan kelgan, buzilgan yozuv).
3. `stop()` `S.pvCache` ni tozalashmaydi → **aylanma siklik**: video hech qachon ochilmaydi, `Telegram SDK yuklanmagan` xatosi chiqadi.

Tuzatish:

- `fastFallback()` — buzilgan yozuvlarni tozalaydi (`purgeBrokenDocMeta()`), tez yo'ldan kelgan yozuvlar `fromFast: true` belgisi bilan ajratiladi.
- `run()` — `file_reference`siz **va** `S.fastBroken` holatidagi tez yo'l yozuvlari ishlatilmaydi.
- `fastFallback()` da `mount(node, opts).catch(...)` → `mount(node, opts)` (mount promise **qaytarmaydi** — `.catch` TypeError berardi).
- `prefetch()` — tez yo'l `false` qaytarsa (Telegram rad etdi) avtomatik eski (GramJS) yo'lga qaytadi; `S.prefetchKey` / `S.prefetchAbort` tez yo'lda ham to'g'ri o'rnatiladi.
- `ensureSession()` — GramJS klienti yaratilishidan OLDIN tez klient yopiladi: **bir auth_key bilan ikki parallel sessiya** Telegram'da `AUTH_KEY_DUPLICATED` beradi va sessiyani butunlay bekor qiladi.
- `fastPrefetch()` — `upload.getFile` limiti **1 MB** va 4096 ga bo'linishi shart (oldin 4 MB so'ralardi → `LIMIT_INVALID`).

### Sabab 4 (server): JSON javob ogohlantirish bilan ifloslanardi

MadelineProto Windows uchun ogohlantirishni to'g'ri STDOUT ga yozadi:

```
WARNING: MadelineProto runs around 10x slower on windows due to OS and PHP limitations...
```

Bu matn JSON bodisi bilan aralashib, brauzerdagi `response.json()` ni **"Unexpected token 'W'"** bilan buzardi — ya'ni tez yo'l butunlay ishlamagan. `api/tg-doc.php` endi chiqishni bufferlaydi va javobni chiqarishdan oldin buffer'ni tozalaydi (`apiOk()` / `apiFail()`).

### Regressiya testi

`.work/tools/stream-regression.test.mjs` — **19/19**: brauzer muhiti `vm` sandbox'ida simulyatsiya qilinadi (Document, localStorage, Service Worker, MessageChannel, fake GramJS va fake minimal MTProto klienti).

```bash
node .work/tools/stream-regression.test.mjs   # 19/19
```

Test **buzilgan kodda 8 ta assertni yiqitiradi** (`node .work/tools/make-buggy.mjs` — tuzatishlarni qaytarib beradi), ya'ni xato haqiqatan ushlanadi.

## HLS: tayyor va sovuq kesh farqi

`.env`-dagi `HLS_ENABLED=1` HLS imkoniyatini yoqadi. HLS worker Telegram'dan manba videoni to'liq yuklab olgach FFmpeg `-c copy` bilan segmentlar yaratadi; shu sababli bo'sh keshga ega 1 GB film birinchi marta ochilganda bir necha daqiqa kutish va server resurslarini talab qilishi mumkin.

Ommaviy `t.me` havolalarida HLS faqat `meta.json` holati `done` bo'lib, manifest va segmentlar tayyor bo'lsa tanlanadi. Sovuq kesh bo'lsa, sahifa worker'ni ishga tushirib butun filmni serverga tortmaydi: player bevosita Telegram oqimiga o'tadi. `localhost` sinovlarida ham ommaviy Telegram postlari bevosita oqadi. `t.me/c/...` kabi private kanal havolasini foydalanuvchi brauzeri ocholmasligi mumkin; bunday manbada production HLS yo'li saqlanadi, demak keshni oldindan tayyorlash zarur.

Oldindan tayyorlangan HLS va CDN ko'p tomoshabinga xizmat qilishda foydali. Segmentlar uchun Cloudflare cache to'g'ri sozlanmasa, tayyor HLS ham origin serverdan trafik olishi mumkin. Birinchi marta ko'rishdan oldin videolarni oldindan HLS'ga tayyorlash yoki cold transcode'ni oqimli manifest bilan bosqichma-bosqich chiqaradigan arxitekturaga o'tish kerak. FFmpeg bo'lmasa HLS cache yaratilmaydi.

## FFmpeg sozlamasi

Linux server uchun `.env` namunasi:

```env
HLS_ENABLED=1
FFMPEG_BIN=/usr/bin/ffmpeg
PHP_CLI_BIN=/usr/bin/php
HLS_SEG_SEC=10
```

Windows XAMPP'da `FFMPEG_BIN=C:\ffmpeg\bin\ffmpeg.exe` va `PHP_CLI_BIN=C:\xampp\php\php.exe` kabi amaldagi fayl yo'llarini kiriting. `api/hls.php` yoki CLI worker ishga tushishidan oldin FFmpeg o'rnatilgan, PHP jarayoniga esa cache katalogiga yozish huquqi berilgan bo'lishi kerak.

## Nginx: PHP-FPM'ni video baytlaridan bo'shatish

`api/hls.php` segmentlari va `api/stream.php` yuklangan fayllari huquq tekshiruvidan keyin `NGINX_INTERNAL_MEDIA=1` sozlamasi bilan `X-Accel-Redirect` orqali ichki Nginx alias'ga o'tishi mumkin. Nginx fayl baytlarini o'zi uzatadi; bu uzoq download vaqtida PHP-FPM child process'ini band qilib turmaslikka yordam beradi. Apache/XAMPP'da bu flag yoqilmasa, mavjud PHP oqim yo'li ishlayveradi.

Namuna: [`deploy/nginx/tele_uzdub.conf.example`](../deploy/nginx/tele_uzdub.conf.example). Bu Linux production shabloni: domen, document root, TLS sertifikatlari va PHP-FPM socket yo'lini serveringizga moslang, so'ng `nginx -t` bilan tekshiring. `worker_processes auto` protsessor yadrolariga mos keladi. `worker_connections 4096` bitta worker ulanishlari soni bo'lib, proxied upstream ulanishlari va OS file-descriptor limiti ham hisobga olinadi. `4096 × worker` — bir vaqtdagi tomoshabinlar uchun kafolatlangan raqam emas.

`/uploads/videos/` va `/uploads/reels/` kabi maxfiy manbalarni Nginx orqali ochiq katalog qilib bermang. PHP ruxsatni tekshirgachgina internal alias ishlatilishi kerak.

## PHP-FPM

Namuna pool: [`deploy/php-fpm/tele_uzdub.conf.example`](../deploy/php-fpm/tele_uzdub.conf.example). `pm.max_children=16` faqat misol. Qiymatni PHP process'ining o'lchangan p95 xotira sarfi, OS, MySQL/MariaDB, Redis va FFmpeg uchun qoldiriladigan RAM asosida tanlang. Juda past qiymat request navbatini oshiradi; juda yuqori qiymat RAM tugatib butun serverni sekinlashtirishi mumkin.

PHP-FPM socket'ini Unix socket'da saqlang, FastCGI portini internetga chiqarmang. Pool konfiguratsiyasini amaldagi PHP-FPM versiyasi bilan tekshirib, Nginx va PHP-FPM'ni reload qiling.

## Cloudflare cache

HLS segment endpoint'i `api/hls.php?key=...&seg=seg_00001.ts` uchun `Cache-Control: public, max-age=31536000, immutable` qaytaradi. Cloudflare Cache Rule'ni faqat `/api/hls.php` yo'lida `key` va `seg` query parametrlari ikkalasi mavjud bo'lganda cache eligible qilish ma'qul. Cache key'da query parametrlarini to'liq saqlang: `key` yoki `seg`ni olib tashlash turli segmentlarni bitta kesh kalitiga birlashtirishi mumkin. `json=1` status so'rovlari hamda foydalanuvchiga bog'liq yoki `no-store` javoblarni bu qoidaga kiritmang.

Misol (ilova domen ildizida joylashgan bo'lsa; subpath bo'lsa URL path'ni moslang):

```text
http.request.uri.path eq "/api/hls.php" and http.request.uri.query contains "key=" and http.request.uri.query contains "seg="
```

Cloudflare'da **Eligible for cache** ni tanlang va Edge TTL'ni origin header'ini kuzatadigan qilib sozlang. Cache hit segmentni origin'ga qayta yubormaydi; cold miss va cache miss esa origin'ga boradi. Cache hit ratio, origin egress va disk sarfini haqiqiy trafikda o'lchang.

## 1,000+ bir vaqtdagi tomoshabin haqida

Cheksiz bir vaqtdagi foydalanuvchini faqat Nginx yoki PHP sozlamalari bilan kafolatlab bo'lmaydi. Agar video origin'dan to'g'ridan-to'g'ri yuborilsa, kerakli chiqish o'tkazuvchanligi taxminan tomoshabinlar soni × o'rtacha bitrate bo'ladi: 1,000 × 2 Mbit/s ≈ 2 Gbit/s. Telegram direct-stream video baytlarini tomoshabin brauzeridan Telegram'ga yo'naltiradi; sayt esa sahifa, JavaScript va API so'rovlarini xizmat qiladi. HLS tanlansa, ko'p segment Cloudflare edge'dan kelishi kerak. Telegram API/MTProto cheklovlari, foydalanuvchilarning tarmog'i, saytning metadata/API'si va CDN kesh hit ko'rsatkichi baribir muhim.

Sinovni bosqichma-bosqich (50 → 100 → 250 → 500 → 1,000) va ruxsat etilgan test kontenti bilan o'tkazing. CPU/RAM/disk, origin tarmoq, Cloudflare cache hit, Nginx 5xx/kechikish, PHP-FPM queue hamda DB javob vaqtini kuzating. Telegram servislariga sun'iy ravishda ortiqcha so'rov yubormang.

## Joriy kompyuterda tekshirilgan chegaralar

Ish muhiti Windows XAMPP/Apache'da; bu kompyuterda Nginx va PHP-FPM production serveri ishga tushirilmagan. `.env`da `HLS_ENABLED` yoqilgan, ammo tekshiruvda `FFMPEG_BIN` amaldagi bajariluvchi faylga topilmadi, shuning uchun sovuq HLS yaratishni oxirigacha tasdiqlab bo'lmaydi. `Catalog.php` va `watch.php` PHP sintaksisi, Telegram JavaScript va Service Worker sintaksisi tekshiruvlaridan o'tdi. DB yoki tarmoqqa chiqmaydigan smoke test sovuq ommaviy `t.me` havolasi uchun `telegram` yo'lini tanlashini tasdiqladi; bu test haqiqiy video tezligini o'lchamaydi. Nginx va PHP-FPM fayllari production serverga moslanishi kerak bo'lgan namunalar, bu kompyuterda faol konfiguratsiya emas. Linux Nginx/FPM va ko'p foydalanuvchili yuk sinovi production Linux serverda bajarilishi kerak.

## Tezlashtirish 1–3: gram writeback, poster, inline konfiguratsiya (2026-11-17)

Besh bosqichli tezlashtirishning dastlabki uch qismi:

1. **Gram writeback** — `api/tg-meta-write.php` tomoshabbinning GramJS sessiyasidan olingan hujjat ma'lumotini (`id`, `access_hash`, `file_reference`, DC, hajm, MIME, nom, w/h/dur) bazaga `source='gram'` sifatida yozadi. Bu **fire-and-forget**: ijro kanaliga hech qachon to'sqinlik qilmaydi. Endpoint `clientUserId()` orqali `wc_cs` tomoshabbinlariga ham yozishga ruxsat beradi.
2. **Thumb poster** — Telegram thumb JPEG'lari bot MTProto sessiyasi bilan **bir marta** olinib `uploads/tg_thumbs/` ga keshlaydi va `api/tg-thumb.php` orqali beriladi. Metadata alohida `telegram_thumb` jadvalida (asosiy `telegram_meta` ga ALTER qilinmaydi). Video baytlari bu yo'ldan **o'tmaydi**. `watch.php` kesh bo'lsa `playback.poster` ni shu endpointga o'rnatadi.
3. **Inline konfiguratsiya / docmeta** — sahifa HTML ichida `window.__WCSITECFG` (`api/site-config.php`) va `window.__WCDOCMETA` (joriy + qo'shni qismlarning `source='gram'` yozuvlari, `t*1000`, kalit `channel/post`) beriladi. Bu ikki qo'shimcha RTT ni yo'q qiladi.

## Tezlashtirish 4: ommaviy Telegram embed yo'li (2026-11-17)

Ommaviy `t.me/<kanal>/<post>` manbalari uchun `watch.php` `tgEmbed` qiymatini o'rnatadi va foydalanuvchi o'z pleyerini tanlamagan hamda `#t=` / davom etish nuqtasi kerak bo'lmaganda **tez embed** (`https://t.me/<kanal>/<post>?embed=1&mode=tme&discussion=0`) afzal ko'riladi. Video baytlari to'g'ridan-to'g'ri Telegram CDN'idan keladi — sayt origin'i ishtirok etmaydi.

- `api/tg-embed.php?channel=..&post=..` postning embed qilishga yaroqliligini tekshiradi; katta fayllar (`too_big`) va xatolar bo'lsa jim o'z pleyerimizga qaytamiz.
- Xususiy `t.me/c/...` havolalari uchun `tgEmbed = null` — ular uchun `Catalog::playbackTelegram()` kanal nomini bermaydi, shuning uchun MTProto yo'li ishlaydi.
- Tanlov kalitlari: `wc_pmode`, `wc_embed_bad`, `wc_embed_ok`; pleyer rejimi `fast` / `own`.

## Tezlashtirish 5: kichik faststart preview (2026-11-17)

Katta fayl birinchi kadrgacha sekin ochilganda, avval 20 soniyalik engil **preview** ko'rsatiladi, so'ngra asl videoga o'tiladi. Ikkala video ham brauzer ← Telegram CDN'idan keladi.

- Yaratish: `cli/tg-preview.php` (`--ch`, `--post`, `--all`, `--force`, `--limit`, `--queue`) va `includes/TgPreview.php`. Admin panelga yangi video qo'shilganda navbat avtomatik yaratiladi va fon worker'i (`--queue`) uni bajaradi.
- Strategiya: avval 32 MB **bosh** olinadi (`downloadToCallable`, offset/exclusive-end). Ko'p filmlarda `moov` oxirida bo'lgani uchun keyin 12 MB **oxir** olinadi va `buildSparse()` bilan bosh+oxir qismlardan to'liq hajmli sparse fayl yasaladi — FFmpeg birinchi 20 s ni oladi. Faqat oxirgi chora sifatida to'liq yuklash.
- FFmpeg: 480p→360p→240p, `-movflags +faststart`, audio (240p da ovozsiz). Chiqarish `storage/cache/preview/` da vaqtinchalik, so'ngra Bot API `sendVideo` bilan ommaviy preview kanalga yuklanadi.
- Saqlash: `migrations/telegram_preview.sql` — alohida `telegram_preview` jadvali. `api/tg-preview.php` metadata beradi; `watch.php` uni `window.__WCPREVIEW` qilib inline qiladi; `tg-stream.js` `mountIntro()` preview'ni ko'rsatadi, `watch.js` `S.introDoneFor` loop'ning oldini oladi.
- Preview **mustaqil** Telegram posti bo'lgani uchun asl videoning `file_reference` ga bog'liq emas va `source='gram'` tekshiruvidan qat'i nazar qo'shiladi. Preview xatosi jim yutiladi — asl video ochilaveradi.

### Preview kanali sozlash

`.env` da `TG_PREVIEW_CHANNEL` (bosh `@` siz) beriladi. Berilmasa `REELS_CHANNEL` ga qaytadi — **e'tiborli bo'ling**: bu holda preview'lar reel kanaliga yuboriladi. Ishlab chiqarishda alohida ommaviy kanal ajrating va botni unga admin qiling:

```env
TG_PREVIEW_CHANNEL=wcinema_previews
TG_PREVIEW_SEC=20
TG_PREVIEW_HEIGHT=480
TG_PREVIEW_MAX_MB=5
```

`TG_PREVIEW_CHANNEL` bo'sh bo'lsa `TG_PREVIEW_ENABLED=false` bo'ladi va preview yaratish butunlay o'chadi (asl video hech qanday holatda bloklanmaydi).

## Server-side MTProto gateway (ixtiyoriy prototip)

Bu yo'l **standart holatda o'chiq**. U Telegram videolarini brauzerdagi MTProto o'rniga sayt serveri orqali HTTP Range sifatida beradi:

```text
brauzer <video src="api/tg-gateway.php?t=<chipta>">
   → PHP endpoint chiptani tekshiradi
   → loopback 127.0.0.1:8099 (cli/tg-gateway.php)
   → Telegram DC (upload.getFile)
   → 206 Partial Content → brauzer
```

### Yoqish

`.env`:

```env
TG_GATEWAY_ENABLED=1
TG_GATEWAY_MODE=primary
TG_GATEWAY_HOST=127.0.0.1
TG_GATEWAY_PORT=8099
TG_GATEWAY_TTL=3600
# TG_GATEWAY_SECRET=uzun-tasodifiy-qiymat
```

Alohida jarayon (bir marta ishga tushiriladi, `systemd`/`supervisor` bilan tirik tutiladi):

```bash
php cli/tg-gateway.php --port=8099
```

- `TG_GATEWAY_MODE=primary` bo'lsa `watch.php` `assets/js/tg-gateway.js` ni yuklaydi va **faqat private/Telegram postlar** uchun avval gateway'dan chipta so'raydi. Gateway javob bermasa, `watch.js` avtomatik brauzer-MTProto yo'liga qaytadi (`S.gwTriedFor` qayta urinish loop'ini to'sadi).
- `TG_GATEWAY_MODE=off` (standart) bo'lsa gateway mijozi umuman yuklanmaydi.
- Ommaviy `t.me/<kanal>/<post>` videolari gateway'ga **yo'naltirilmaydi** — ular avvalgidek to'g'ridan-to'g'ri Telegram CDN'idan keladi.

### Xavfsizlik va cheklovlar

- Chipta `HMAC-SHA256` bilan imzolanadi, `uid` ga bog'lanadi va `TG_GATEWAY_TTL` (standart 3600 s) dan keyin eskiradi. `file_reference` faqat chipta ichida va gateway xotirasida yuradi; **SQL'ga yozilmaydi**.
- Gateway alohida sessiya papkasini (`storage/mtproto/gateway`) va `storage/mtproto/gateway.lock` ni ishlatadi — `live-worker`/`deliver-worker` sessiyalariga tegmaydi.
- Faqat loopback'da tinglaydi. Portni tashqi tarmoqqa ochmang; `X-GW-Key` bo'lmasa `/ticket` 403 qaytaradi.
- **Bu prototip so'rovlarni ketma-ket bajaradi.** Ko'p bir vaqtdagi tomoshabin uchun bir nechta jarayon yoki async server kerak; hozirgi ko'rinish yuk sinovidan o'tkazilmagan.
- Gateway video baytlarini **sayt serveridan o'tkazadi**: trafik va CPU sarfi oshadi. Shu sababli u tezlik yo'li emas, zaxira/eksperimental yo'l. Asosiy yutuq baribir CDN, Service Worker chunk keshi, `moov`/faststart va Range oqimidan keladi.
- `TG_GATEWAY_SECRET` berilmasa, kalit mavjud maxfiy qiymatlardan deterministik hosil qilinadi; baribir production'da alohida uzun secret berish tavsiya etiladi.
- `api/tg-gateway.php?action=ticket` javobi **SQL keshga yozilmaydi**: chipta vaqtga bog'liq va foydalanuvchiga xos.

### Tekshirish

```bash
php .work/tools/tg-gateway.test.php      # 38/38 (offline)
node .work/tools/stream-tuning.test.mjs  # 53/53 (chunk/HLS/lazy/gateway sozlamalari)
```

Gateway'ni Telegram'siz tekshirish uchun: `php cli/tg-gateway.php --no-telegram --port=8099` — bu rejim faqat `/health` beradi.

## Rasmiy manbalar

- [Telegram upload.getFile](https://core.telegram.org/method/upload.getFile)
- [Telegram shifrlangan CDN'lari](https://core.telegram.org/cdn)
- [FFmpeg format va faststart hujjatlari](https://ffmpeg.org/ffmpeg-formats.html)
- [MDN video elementi va preload](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video)
- [MDN HTTP Range so'rovlari](https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests)
- [NGINX core module](https://nginx.org/en/docs/ngx_core_module.html)
- [NGINX HTTP core module](https://nginx.org/en/docs/http/ngx_http_core_module.html)
- [NGINX FastCGI module](https://nginx.org/en/docs/http/ngx_http_fastcgi_module.html)
- [PHP-FPM configuration](https://www.php.net/manual/en/install.fpm.configuration.php)
- [Cloudflare Cache Keys](https://developers.cloudflare.com/cache/how-to/cache-keys/)
- [Cloudflare Cache Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/)
