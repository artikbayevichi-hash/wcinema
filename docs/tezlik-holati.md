# Tezlik holati — hisobotdagi mexanizmlar kodda

Bu hujjat `Telegram video va rasmlar tezligi` hisobotidagi har bir mexanizmning
**hozirgi holatini** kod bilan bog'laydi. Maqsad: "nima bor", "nima ataylab
o'chirilgan" va "nimani va'da qilish mumkin emas"ni bir joyda saqlash.

> Oxirgi tekshiruv: 2026-11-21. Testlar: `.work/tools/` (12 ta suite) +
> deterministik A/B: `.work/tools/ab-local.mjs`.
> Oxirgi sessiya-qulfi tuzatishi hali commit qilinmagan (oldingi o'zgarishlar
> `1aeb5d7` da yuborilgan).

---

## 1. Qisqa jadval

| Mexanizm | Holat | Kod | Real foyda |
|---|---|---|---|
| To'g'ridan-to'g'ri MTProto (PHP vositachisiz) | ✅ bor | `assets/js/tg-mtproto.js`, `assets/js/tg-stream.js` | Eng katta yutuq |
| Issiq WebSocket + keepalive | ✅ bor | `tg-mtproto.js` (pool, `wc_media`) | 300–600 ms handshake yo'q |
| MTProto — Dedicated Worker | bor | `assets/js/tg-mtproto-worker.js`, `tg-stream.js` | Kripto asosiy oqimdan chiqadi — UI qotmaydi |
| 4 lane / 512 KB / 1 MB blok | ✅ bor | `tg-stream.js` (`readRange`, 4 lanes) | Butun yuklashda shartli |
| `precise` flag | ✅ bor | `tg-mtproto.js` → `buildGetFile()` flags = 1 | Seek'da ortiqcha bayt yo'q |
| `cdn_supported` / `upload.getCdnFile` | ⛔ **ataylab o'chirilgan** | `buildGetFile()` izohi | Brauzerda ≈ 0 yoki minus |
| Edge CDN (HTML/API/static) | ✅ bor | `.htaccess`, `includes/HttpCache.php` | TTFB −50…150 ms (edge) |
| SPA / instant navigatsiya | ✅ bor | `assets/js/watch.js`, `includes/perf-head.php` | 1–3 s → 0.1–0.3 s |
| faststart (`moov` oldinda) | ✅ bor | `includes/FastStart.php`, `cli/video-prep.php` | Faqat lokal MP4 uchun |
| SW `206` + Cache Storage | ✅ bor | `tg-cdn-worker.js` | Qayta ko'rishda ≈ 0 ms |
| Thumbnail / poster / preview | ✅ yaxshilandi | `watch.php` (`$PERF_POSTER`), `TgPreview` | Qora ekran yo'q, LCP tezroq |
| Public `t.me` anon CDN URL | ✅ bor | `includes/TgResolve.php`, `stream-cache.test.php` | Ochiq postlarda RTT kamayadi |
| Video bo'lmagan so'rovlarning DB keshi | ✅ bor | `includes/StreamCache.php`, `includes/StreamBootstrap.php` | 2-chi tomoshabinda API/embed so'rovlari yo'q |
| MP4 indeks (`moov`) xaritasi DB'da | ✅ bor | `includes/VideoIndex.php`, `api/video-index.php` | Issiq ochilishda qo'shimcha `moov` qidiruv yo'q |
| Keyframe (`stss`) xaritasi + seek prefetch | ✅ bor | `tg-cdn-worker.js` (`parseKeyframes`), `tg-play.js` | Seek'da keyframe bo'lagi keshdan olinadi |
| Mahalliy bosh/dum prefiksi (R2'siz) | ✅ bor | `api/prefix-save.php`, `api/prefix.php`, `api/r2-sign.php` | Keyingi tomoshabin 1–2 MB ni DC'dan so'ramaydi |
| Deterministik A/B o'lchov | ✅ bor | `.work/tools/ab-local.mjs` | DC'siz ham mexanizm tasdiqlanadi |
| O'zgaruvchan meta: eski o'chadi | ✅ bor | `includes/PrefixStore.php`, `StreamBootstrap::fp` | Video almashtirilsa eski kesh ishlamaydi |
| Sessiya qulfi erta bo'shatiladi | ✅ bor | `includes/bootstrap.php` | Parallel prerender/API tiqilmaydi |

---

## 2. Nima o'zgardi (shu qadamda)

### 2.1. Poster preload — `watch.php`

Pleer ochilganda foydalanuvchi birinchi bo'lib **poster**ni ko'radi. Ilgari
poster faqat CSS `--wposter` ichida bo'lgani uchun brauzer uni kechroq
topardi: qora ekran + layout siljishi (CLS).

Endi `watch.php` `<head>` ichida, `perf-head.php` dan **oldin**:

```php
$PERF_POSTER = $playback['poster'] ?: $watchPoster;
```

va `perf-head.php` quyidagini chiqaradi:

```html
<link rel="preload" as="image"
      href="/tele_uzdub/api/tg-thumb.php?ch=wcinemauz&amp;post=33"
      fetchpriority="high">
```

Tekshirilgan: `watch.php?id=40&e=53` HTML'ida aynan shu qator bor.
Bu **birinchi kadrni** tezlashtiradi; video baytlari tezligiga ta'sir qilmaydi.

### 2.1.1. Avtomatik poster — Telegramnikidek, faylsiz

Admin panelga video (yoki anime qismi) havolasiz poster bilan qo'shilsa, endi
`api/tg-thumb.php?ch=<kanal>&post=<raqam>` manzili avtomatik yoziladi. Bu Telegram
video hujjatining **o'zi saqlagan kadr** — biz rasm yuklamaymiz va CDN imzoli
URL'ini bazaga saqlamaymiz (u ~1 kunda o'lib qolardi).

- `create_content`, `add_episode`, `update_episode`, `bulk_episodes` — hammasi.
- `Catalog::getPlayback()` ichida player posteri shu kadr bilan tanlanadi;
  `watch.php` endi diskdagi kesh bor-yo'qligini tekshirmaydi.
- Kadr hujjatda yo'q/olinsa, `api/tg-thumb.php` postning `og:image` ga 302 qiladi.
- Eski qismlar uchun: `php cli/tg-poster-backfill.php` (tarmoqsiz, faqat DB).
- Admin UI'dagi rasm yuklash maydoni o'chirildi (`upload_image` → 410).

Texnik kesh (`uploads/tg_thumbs/`) faqat server tomonida, bir marta yoziladi;
bu **admin fayl yuklash emas**. Video baytlari bu yerdan o'tmaydi.

### 2.2. `cdn_supported` — izoh bilan qulflandi

`tg-mtproto.js` → `buildGetFile()` endi flags = **1** (faqat `precise`)
yuboradi va sababni kod ichida yozib qo'yadi:

- CDN DC manzili `help.getConfig` → `dc_options.cdn` da faqat `ip:port`;
- brauzer raw TCP ocholmaydi, CDN uchun `apiws` endpoint hujjatlashtirilmagan;
- redirect kelsa, uni bajara olmaymiz → `cdn_supported=0` bilan qayta so'rov
  = **+1 RTT**.

Shu sababli CDN faqat **server-side gateway** (TCP) yo'lida ma'noga ega.
Brauzerda yoqish — sekinlashtirish. Buni `speed-mechanisms.test.mjs` qo'riqlaydi.

### 2.3. Guard testlar

Yangi ikki suite:

- `.work/tools/speed-mechanisms.test.mjs` — 47 tekshiruv: SPA, Edge CDN,
  `cdn_supported` o'chirilganligi, faststart, poster preload, keyframe,
  mahalliy prefiks va o'zgaruvchan meta himoyasi.
- `.work/tools/faststart.test.php` — 5 tekshiruv: `moov`/`mdat` atomlari
  (qo'lda yasalgan MP4 bilan), MP4 bo'lmagan fayl, `prepare()` fallback.

### 2.4. Bir video uchun kontent keshi + `moov` xaritasi

Foydalanuvchi talab qilgan narsa aniq: **video baytlaridan tashqari** hamma
so'rov/context birinchi tomoshabinda bazaga yozilib, keyingilarida tayyor
keladi. bundan tashqari, ilgari "fizika" deb hisoblangan 1–2 MB lik
`moov`/dum so'rovi ham endi Telegram DC'ga ketmaydi: birinchi tomoshabin uni
mahalliy prefiks keshiga yozadi, keyingilari shu yerdan oladi.

**Qanday ishlaydi:**

1. `watch.php` / `api/episode.php` → `StreamBootstrap::load()` →
   `video_stream_cache` jadvalidagi **bitta** `boot` yozuvi (`cache=hit`).
   Ichida: embed natijasi, anonim CDN URL, poster, preview, doc id/dc/size,
   HLS holati, izoh topic'i.
2. `sessionDoc` (foydalanuvchining `file_reference`) HTML ichida alohida va
   **SQL'ga yozilmaydi**. `api/r2-sign.php?info=1` ham keshlanmaydi — undagi
   HMAC imzo vaqtga bog'liq.
3. Birinchi tomoshabin SW orqali MP4 `moov` qutisinining o'rnini topganda
   `tg-cdn-worker.js` `indexfound` xabari bilan sahifaga qaytaradi; sahifa
   `api/video-index.php` orqali `{doc, size, moov, kf, dur}` ni yozadi
   (`scope=index`, 7 kun). `kf` — `stss/stsz/stsc/stco` jadvallaridan olingan
   haqiqiy keyframe ofsetlari.
4. Keyingi ochilishda xarita `__WCBOOT.index` ichida keladi →
   `WCStreamBoot.indexInfo()` → `tg-stream.js` SW ga `type:'index'` yuboradi.
   SW `IDX_WIN` ga oladi va `waitIndex()` endi **kutmaydi**: moov bo'lagi
   dum oynasi bilan bir vaqtda o'qiladi. Qo'shimcha 1200 ms `headWait` yo'q.
5. Kalit — `doc_id + size`. Film almashtirilsa eski xarita o'z-o'zidan
   ishlamaydi. `known()` faqat katalogdagi (kanal, post) juftligini qabul
   qiladi; soxta yozuv yuborib bo'lmaydi.

### 2.5. Keyframe xaritasi va mahalliy prefiks yozuvi

**Keyframe.** SW `moov` ichidagi `stss` (sync sample), `stsz`, `stsc`,
`stco/co64` va `stts/mdhd` jadvallarini o'qiyp, `[[sekund, bayt], ...]`
xaritasini tuzadi (`parseKeyframes()`). U `indexfound` orqali DB'ga yoziladi,
`__WCBOOT.index.kf` bilan qaytadi va SW `KF_MAP` ga olinadi. `tg-play.js`
qayta qurilishdan **oldin** `prefetchSeek()` chaqiradi; SW `seekhint` xabari
bo'yicha eng yaqin keyframe bo'lagini oldindan oladi. Xarita bo'lmasa oddiy
o'qish yo'li ishlaydi — hech narsa buzilmaydi.

**1–2 MB lik DC so'rovi yo'q qilindi.** R2 sozlanmagan bo'lsa ham mahalliy
prefiks ishlaydi:

1. `api/r2-sign.php?doc=<id>&size=<bayt>` faqat shu kontent uchun 15 daqiqalik
   imzoli `head` va `tail` yozish URL'larini beradi (`PUTPX` imzosi).
2. SW birinchi ochilishda 128 KB bosh bo'lakni va 1 MB dum oynasini
   Telegram'dan o'qib, ularni `api/prefix-save.php` ga yozadi. Fayl nomi
   `<doc>.head` / `<doc>.tail`, manifest faqat `doc/size/head/tail` saqlaydi.
3. Keyingi ochilishda `api/r2-sign.php?info=1` `docs` xaritasi bilan tayyor
   prefiksni e'lon qiladi; SW bosh bo'lakni `api/prefix.php` dan oqib
   beradi, `moov` uchun alohida DC so'rovi yuborilmaydi.
4. `file_reference`, sessiya, cookie, IP yoki foydalanuvchi ID'si na imzoga,
   na faylga, na manifestga kirmaydi. Kesh 500 doc bilan cheklangan.

**Deterministik A/B.** `node .work/tools/ab-local.mjs` mahalliy zanjirni
haqiqatda ishga tushuradi (PUT 200 → `info.docs` → Range 206, baytlar bir
xil), keyin 10 ta ochilish uchun so'rovlar sonini hisoblaydi:
Telegram DC 20 → 2, katalog/embed API 40 → 4. Video oqimining qolgan MB'lari
o'zgarishsiz. Bu **real DC tezligi o'lchovi emas** — DC mavjud bo'lmaganda
mexanizmning ishlashini tasdiqlaydigan takrorlanadigan dalil.

### 2.6. O'zgaruvchan metama'lumot: eskisi o'chadi, yangisi saqlanadi

- `boot` keshining ichida **barmoq izi** (`fp`) saqlanadi: Telegram uchun
  `doc_id + size`, lokal kontent uchun `content_id + episode_id + URL`.
  Post tahrirlanib video almashtirilsa barmoq izi o'zgaradi → eski yozuv
  `forget()` bilan o'chirilib, yangi ma'lumot qayta quriladi va saqlanadi.
- Shu paytda eski `doc_id` ga tegishli **MP4 indeksi** (`VideoIndex::forget`)
  va **prefiks fayllari** (`PrefixStore::forget`) ham o'chiriladi — eski
  xarita yangi videoga noto'g'ri qo'llanilmaydi.
- Mahalliy prefiks endi **7 kunlik TTL** va **500 doc** limitiga ega
  (`includes/PrefixStore.php`). Muddati tugagani yoki eng eskisi avtomatik
  o'chiriladi; yangi yozuv "joy yo'q" deb rad etilmaydi.
- `file_reference` hech qachon bu keshlarga kirmaydi — u faqat bot sessiyasida
  yangilanadi. 6 soatlik muddat ichida ham barmoq izi tekshiruvi ishlaydi.

**Qolgan halol chegaralar:**

- Noto'g'ri koordinata yuborilsa ham video baytlari buzilmaydi: SW faqat
  qo'shimcha bo'lakni oldindan oladi, asl Range normal yo'l bilan bajariladi.
- `?boot=0` probasi o'zgarishsiz: `window.__WCBOOT` umuman chiqmaydi.
- Ommaviy kanal uchun anonim CDN URL bir marta yechiladi; keyin `<video src>`
  to'g'ridan-to'g'ri CDN'ga Range so'rov yuboradi, SW/MTProto ishtirok
  etmaydi.
- Video almashtirilganda eski kesh keyingi ochilishda aniqlanib o'chiriladi;
  o'chirish "darhol" emas, "keyingi so'rovda" sodir bo'ladi (buning uchun
  qo'shimcha fon jarayoni yo'q).

---

## 3. Allaqachon bor bo'lgan mexanizmlar (o'zgartirilmadi)

### 3.1. SPA / instant navigatsiya

- **Qism almashishi** — `watch.js`: `switchEpisode()` + `history.pushState`
  + `popstate`. Sahifa qayta yuklanmaydi, faqat pleer va ro'yxat yangilanadi.
- **Kross-sahifa** — `perf-head.php`: Speculation Rules
  `prerender` → `a[href*="watch.php"]`, `eagerness: 'moderate'`.
  `saveData` yoki `2g` bo'lsa o'chadi (trafik bekorga ketmaydi).
- Safari/Firefox prerender'ni qo'llab-quvvatlamaydi — ular oddiy navigatsiya
  qiladi, xatti-harakat buzilmaydi.

### 3.2. Edge CDN

- `.htaccess`: JS/CSS — `public, max-age=31536000, immutable`;
  `tg-cdn-worker.js` — `no-store`; PHP uchun `setifempty` (API'ning
  `s-maxage` sarlavhasini bosmaydi).
- `includes/HttpCache.php`: `s-maxage`, `stale-while-revalidate`, stampede
  himoyasi (`flock`), foydalanuvchiga xos javob uchun `private, no-store`.
- **Muhim:** Edge CDN video baytlariga tegmaydi. Video Telegram DC'dan
  to'g'ridan-to'g'ri ketadi.

### 3.3. faststart

- `includes/FastStart.php` — `moov`/`mdat` atomlarini o'qiydi, `-c copy
  -movflags +faststart` bilan qayta kodlamasdan tuzatadi, xatoda asl faylni
  qaytaradi.
- `cli/video-prep.php --fix --mode=remux` — ommaviy tuzatish (dry-run default).
- **Cheklov:** Telegram'dagi faylni o'zgartirib bo'lmaydi. Bazadagi 51 ta
  `episodes.video_url` — `https://t.me/...`, `uploads/` da MP4 yo'q.
  Ya'ni hozircha bu mexanizmning amaliy foydasi ≈ 0; yangi yuklanadigan
  lokal MP4'lar uchun ishlaydi.

---

## 4. Nimani va'da qilmaslik kerak

1. **150 MB video, 10 Mbit/s → ~120 s.** Buni kod "sehr" bilan 10 s ga
   tushirmaydi. `vaqt ≈ hajm / real tezlik`.
2. **4 lane** faqat bitta connection to'liq ishlamayotganda yordam beradi.
   Internet to'yingan bo'lsa, yutuq 0.
3. **CDN** 100 000+ obunachili ommaviy kanal va "mashhur" fayl shart.
   Bizning kanallarda ishlamasligi ehtimoli yuqori.
4. **faststart** Telegram fayllariga ta'sir qilmaydi.
5. **Edge CDN** video baytlarini tezlashtirmaydi.

---

## 5. O'lchovlar (shu muhit)

| Ko'rsatkich | Qiymat |
|---|---|
| `watch.php` birinchi (sovuq) so'rov | ~3 974 ms |
| `watch.php` ikkinchi (issiq) so'rov | ~126 ms |
| Node suite'lari (8 ta) | 419 PASS, 0 FAIL |
| PHP suite'lari (4 ta) | 102 PASS, 0 FAIL |
| Guard suite'lar (6–8-bo'lim) | 47 PASS, 0 FAIL |
| Deterministik A/B (`ab-local.mjs`) | 5/5 tasdiq, exit 0 |
| **Jami** | **521 PASS, 0 FAIL** |

> Sovuq/issiq farqi asosan **server tomondagi HTML keshidan** (`StreamCache`)
> keladi, tarmoqdan emas. Shuning uchun birinchi foydalanuvchi uchun
> `prefetch`/`prerender` muhim: u keshni oldindan isitadi.

---

## 6. Keyingi qadamlar (agar kerak bo'lsa)

1. **LQIP / blurhash** — kartalar uchun 20–40 baytlik asosiy rang/rasm;
   `nav.php` dagi `<img loading="lazy">` yoniga inline `style="background:..."`
   qo'shish.
2. **`video_thumbs` (`v`) preview** — `TgPreview` allaqachon 20 s kichik MP4
   yasaydi; uni ro'yxat kartalarida ishlatish (hover'da).
3. **Server-side gateway'da CDN** — faqat TCP yo'lida; video serverdan
   o'tadi, shuning uchun faqat fallback sifatida.

---

## 7. Panellar orasidagi 2 daqiqlik qotish — sessiya qulfi

### Sabab

`config.php` deyarli har so'rovda `session_start()` chaqiradi. PHP sessiya
fayli **eksklyuziv qulflanadi** va faqat skript tugaganda (yoki
`session_write_close()` chaqirilganda) bo'shatiladi. `watch.php` sessiyani
faqat `$auth->getCurrentUser()` uchun o'qiydi, lekin uni oxirigacha ushlab
turardi. Shu vaqt ichida:

- `perf-head.php` dagi Speculation Rules bir nechta `watch.php` ni fonda
  prerender qiladi;
- `tg-prefetch.js` qo'shimcha so'rovlar yuboradi;
- `watch.php` bir vaqtda `tg-doc`, `video-index`, `r2-sign`, `progress`,
  `views`, `tg-thumb` kabi API'larga murojaat qiladi.

Agar ulardan bittasi `t.me` ga so'rov yuborsa (`TgResolve`: 8 s ulanish +
15 s jami, ikki marta), qolganlari `session_start()` da navbatga turadi.
`error.log` da bir vaqtda (4 ms ichida) 6 ta fatal qayd etilgan:

```
Maximum execution time of 120 seconds exceeded in config.php on line 781
```

`781` — bu `APP_DEBUG` o'qiladigan satr, ya'ni birinchi bajariladigan kod;
as muammo **qulf kutish**, o'sha satrning o'zi emas.

### Tuzatish

`includes/bootstrap.php` da `$user`/`$auth` yuklanib, `LoginGate::enforce()`
ishlagach, sessiya darhol yopiladi:

```php
$_wcKeepSession = in_array(basename($_SERVER['SCRIPT_FILENAME'] ?? ''), [
    'client-session.php', 'mediaflow-url.php', 'login.php',
    'logout.php', 'admin-login.php', 'bot.php',
], true);
if (!$_wcKeepSession && session_status() === PHP_SESSION_ACTIVE) {
    session_write_close();
}
```

`$_SESSION` xotirada o'qish uchun qolaveradi. Faqat sessiyaga **yozadigan**
6 endpoint istisno qilingan. `watch.php` da alohida yopish olib tashlangan,
chunki bootstrap allaqachon yopadi.

### Natija (shu muhit, bir xil `PHPSESSID` bilan 4 parallel `watch.php`)

| Holat | Eng sekin so'rov | Jami |
|---|---|---|
| Tuzatishdan oldin (sovuq kesh) | 31 122 ms | 31 125 ms |
| Tuzatishdan keyin (sovuq kesh) | 386 ms | 388 ms |
| Tuzatishdan keyin (issiq kesh) | 345 ms | 347 ms |

19:05 dan keyin yangi `Maximum execution time` xatolari yo'q. `login.php` va
`admin-login.php` hali ham 200 qaytaradi.

### Test

`.work/tools/speed-mechanisms.test.mjs` ga 9-bo'lim qo'shildi: bootstrap
sessiyani erta yopishi, 6 istisno va `watch.php` da takroriy yopish yo'qligi
tekshiriladi. Shuningdek `codeOnly()` yordamchisi tuzatildi: avval bir satrli
izohlar olinadi, aks holda `api/*..php` dagi `/*` haqiqiy kodni "izoh" deb
yutib yuborardi.

Barcha suite'lar yashil: **Node 128 PASS, PHP 102 PASS, 0 FAIL**.

---

## 8. MTProto Dedicated Worker

MTProto klienti (`assets/js/tg-mtproto.js`) endi **Dedicated Worker** ichida
ishlaydi: AES-256-IGE/CTR, SHA-256 va WebSocket oqimi asosiy oqimni band
qilmaydi. Bu Service Worker emas — brauzer SW'ni ~30 s bo'sh turganda
o'chiradi, Dedicated Worker esa sahifa yopilmaguncha yashaydi.

- `assets/js/tg-mtproto-worker.js` — `importScripts('tg-mtproto.js?v=…')`
  + `init/call/close` protokoli; `Uint8Array` transferable uzatiladi.
- `assets/js/tg-stream.js` — `createFastWorkerClient()` proxy'si; Worker
  yaratilmasa yoki yiqilsa — main thread'dagi eski klientga qaytadi.
- `includes/perf-head.php` — `__WCMTPROTOV` / `__WCMTWORKERV` versiyalari
  (immutable kesh uchun).
- O'chirish: `localStorage.setItem('wc_mtproto_worker','0')`.
- Tekshirish: `TgStream.boshqarish.ulanish().worker` — `true` bo'lsa
  kripto worker'da.

Batafsil: [`docs/worker-mtproto.md`](worker-mtproto.md).

Test: `node .work/tools/tg-mtproto-worker.test.mjs` — 42 PASS (tarmoqsiz,
fake `TgFast` bilan).

---

## 9. App Shell (PJAX) router

`index.php` / `watch.php` / `reels.php` orasida yurishda hujjat endi QAYTA
YUKLANMAYDI: faqat `#wc-page` bloki almashadi (`assets/js/app-shell.js`).
Shu tufayli MTProto Dedicated Worker, issiq WebSocket va Service Worker
kesh zanjiri uzilmaydi.

- Sahifa shartnomasi: `$WC_SPA = true;` nav'dan oldin, mazmun
  `<div id="wc-page" data-wc-page="...">` ichida, `WCApp.beginPage()`
  darhol ichkarida (sahifa skriptlaridan oldin).
- `PERSIST_RE` dagi kutubxonalar (`tg-stream`, `tg-mtproto`, `player`,
  `wc-lib` ...) bir marta yuklanadi; `app.js` / `watch.js` / `reels.js` /
  `tg-comments.js` har o'tishda yangi `<script>` bilan qayta ishga tushadi.
- `Scope` sahifa listener/taymer/observerlarini yig'adi va keyingi
  o'tishda tozalaydi. Nav darajasidagi skriptlar (`tv-mode`, `badge-poll`,
  `notifications`, `tg-persist`) `DOMContentLoaded` capture bosqichida
  scope'siz ishlaydi -- ularning keep-alive taymerlari o'chmaydi.
- `WCApp.untracked(fn)` -- doimiy funksiyalar uchun (masalan
  `TgStream.init()`); `tg-persist.php` shundan foydalanadi.
- Xato/redirect/timeout bo'lsa -- `location.href` orqali to'liq yuklash
  (xavfsiz zaxira). Foydalanuvchi "o'lik" sahifada qolmaydi.
- `watch.php?c=..&e=..` da faqat `e` o'zgarsa, router `wc:watchpop`
  yuboradi va `watch.js` qismni joyida almashtiradi (sahifa qayta
  chizilmaydi).
- O'chirish: `localStorage.setItem('wc_spa','0')` + reload.

Batafsil: [`docs/app-shell.md`](app-shell.md).

Test: `node .work/tools/app-shell.test.mjs` -- 106 PASS (`vm` + minimal DOM,
tarmoqsiz). `Scope` tozalashi, `untracked()`, capture tartibi, marshrutlar,
`PERSIST_RE` va sahifa shartnomasi tekshiriladi.
