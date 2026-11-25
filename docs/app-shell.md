# App Shell (PJAX) router

`assets/js/app-shell.js` -- barcha ichki sahifalar (`index.php`, `watch.php`,
`reels.php`, `profile.php`, `settings.php`, `history.php`, `saved.php`,
`watch-later.php`, `chat.php`) orasida yurishda hujjat **qayta yuklanmaydi**.
Faqat `#wc-page` bloki almashadi; `<head>`, navigatsiya joyida qoladi.

Bu nima uchun kerak:

* `tg-stream.js` dagi **MTProto Dedicated Worker** va issiq WebSocket
  tirik qoladi -- yangi sahifada qayta `AUTH_KEY_DUPLICATED` / TLS
  handshake bo'lmaydi;
* `tg-cdn-worker.js` (Service Worker) va uning 206 kesh zanjiri uzilmaydi;
* CSS/JS qayta parse qilinmaydi -- o'tish ~50-150 ms.

## 1. Sahifa shartnomasi

Har bir SPA sahifa o'z mazmunini bitta blok ichiga oladi:

```php
<?php $WC_SPA = true; require __DIR__ . '/includes/nav.php'; ?>

<div id="wc-page" data-wc-page="home">
<script>if (window.WCApp) window.WCApp.beginPage();</script>

<!-- ... sahifa mazmuni ... -->
</div>
</body>
</html>
```

Talablar:

1. `$WC_SPA = true;` **nav.php dan oldin** -- shunda `nav.php` oxirida
   `app-shell.js` yuklanadi (boshqa sahifalarda yuklanmaydi).
2. `#wc-page` faqat bitta bo'ladi va `data-wc-page` qiymati
   `home` | `watch` | `reels` | `profile` | `settings` | `history` |
   `saved` | `later` | `chat` dan biri.
3. `WCApp.beginPage()` -- nav'dan keyin, sahifa skriptlaridan **oldin**.
   Shu tufayli sahifa modulining listener/taymer/observerlari qayd etiladi.
4. `#wc-page` ichidagi skriptlar oddiy `<script>` bo'lib qoladi: agar
   `app-shell.js` yuklanmasa, sahifa avvalgidek to'liq ishlaydi.

## 2. Doimiy kutubxonalar va sahifa modullari

`runScripts()` `#wc-page` ichidagi skriptlarni DOM tartibida qayta ishga
tushiradi. Istisno -- `PERSIST_RE` ro'yxati:

| Bir marta yuklanadi (qayta ishga tushmaydi) | Har navigatsiyada qayta ishga tushadi |
|---|---|
| `tg-mtproto.js`, `tg-mtproto-worker.js` | `app.js` |
| `tg-stream.js`, `stream-bootstrap.js` | `watch.js` |
| `tg-probe.js`, `wc-lib.js` | `reels.js` |
| `player.js` (ikkala nusxa) | `tg-comments.js` |
| `tg-gateway.js`, `tg-voice.js` | `tv-watch.js` |
| `tg-format.js`, `tg-emoji.js`, `lottie.min.js` | `watch-ambient.js` |
| `prefetch-hover.js`, `tg-notify-prompt.js` | `profile.js`, `settings.js` |
| | `wc-list.js`, `tg-chat.js`, barcha inline skriptlar |

Doimiy kutubxona ikkinchi marta ishga tushsa, `tg-stream.js` yangi MTProto
klient ochib `AUTH_KEY_DUPLICATED` berardi. Shuning uchun ular
`loadExternal()` orqali faqat hali yuklanmagan bo'lsa qo'shiladi.

Sahifa modullari esa **yangi `<script>` elementi** bilan qayta yuklanadi
(brauzer keshidan) -- IIFE yangi closure oladi, eski nusxa scope bilan
birga o'chadi.

## 3. Scope: listener / taymer / observer

`beginPage()` `Scope` ochadi va vaqtincha quyidagilarni patch qiladi:

* `window.addEventListener` / `removeEventListener`
* `document.addEventListener` / `removeEventListener`
* `setTimeout` / `clearTimeout` / `setInterval` / `clearInterval`
* `requestAnimationFrame` / `cancelAnimationFrame`
* `MutationObserver` / `IntersectionObserver` / `ResizeObserver`

Keyingi o'tishda `scope.destroy()` hammasini tozalaydi -- eski `watch.js`
yoki `reels.js` "arvoh" bo'lib qolmaydi.

### Doimiy kutubxonalar modul darajasida

`tg-stream.js` / `player.js` kabi kutubxonalar `#wc-page` ichida ham
yuklanadi. Ular o'z ishga tushishida (masalan `document.addEventListener
('ended', ...)`) listener ro'yxatdan o'tkazishi mumkin. Bunday listenerlar
sahifa bilan o'chmasligi kerak.

Scope buni `document.currentScript` orqali aniqlaydi: agar listener
`PERSIST_RE` dagi skript bajarilayotganda qo'shilgan bo'lsa -- yozilmaydi.
Inline skriptlar va async callback'lar (`currentScript === null`) esa
kuzatilaveradi.

### Nav darajasidagi skriptlar

`tv-mode.js`, `badge-poll.js`, `notifications.js`, `dm-badge.js`,
`site-banner.js`, `tg-persist.php` -- bular `nav.php` da, ya'ni `#wc-page`
tashqarisida. Ular `DOMContentLoaded` da boot qiladi va ularning
keep-alive taymerlari sahifa bilan o'chmasligi kerak.

Yechim: `app-shell.js` `DOMContentLoaded` ni **window capture** bosqichida
ushlaydi va scope'ni uxlatadi. Nav skriptlari kuzatilmaydi. `boot()` esa
(hujjat listeneri, sahifa modullaridan oldin ro'yxatdan o'tgan) kuzatuvni
qayta yoqadi -- `watch.js` / `reels.js` kuzatilaveradi.

### `WCApp.untracked(fn)`

Ba'zi doimiy funksiyalar keyinroq (masalan skript `onload`ida) ishga
tushadi. Ular uchun:

```js
WCApp.untracked(function () { window.TgStream.init(); });
```

`tg-persist.php` shu usuldan foydalanadi -- `init()` ochgan keep-alive
taymeri birinchi SPA o'tishida o'chib qolmaydi.

## 4. Navigatsiya

1. `click` delegatsiyasi: faqat bir xil origin + SPA marshrut + modifier
   tugmalarsiz chap klik. `data-no-spa`, `download`, `target=_blank`,
   `rel=external` -- brauzerga qoldiriladi.
2. Hover (~140 ms) da `prefetch()` -- sahifa fonda yuklanadi (15 s kesh).
3. `fetch(..., {headers:{'X-WC-PJAX':'1'}})`.
4. `DOMParser` bilan yangi hujjat; `#wc-page` topilmasa -- **to'liq
   yuklash** (xavfsiz zaxira).
5. Yangi CSS `syncStyles()` + `syncInlineStyles()`, `title`/meta/canonical/
   `body.className` `syncHead()`, aktiv nav linklari `syncNav()`.
   `data-wc-config` li head skriptlari (`__WCSITECFG`, `__WC_HLS_*`,
   `__WCMTPROTOV`, `__WCPERF`) qayta bajariladi; eski HLS qiymatlari
   tozalanadi. `wcServerData` kabi `type="application/json"` skriptlari
   DOM'da qoldiriladi, bajarilmaydi. Eski sahifaning `data-wc-list` kabi
   `data-*` atributlari olib tashlanadi.
6. `history.pushState({wc:1, page, y}, '', url)` -- **skriptlardan oldin**,
   chunki `watch.js` `location.search` dan `?e=` ni o'qiydi.
7. `runScripts()` -- sahifa modullari.
8. Scroll/hash tiklanadi, `wc:navigate` hodisasi yuboriladi.

Xato bo'lsa (HTTP xato, `#wc-page` yo'q, skript yuklanmadi, timeout) --
`location.href = target`, ya'ni oddiy to'liq o'tish. Foydalanuvchi hech
qachon "o'lik" sahifada qolmaydi.

## 5. `watch.php?c=..&e=..` -- qismlar

Orqaga/oldinga tugmasi faqat `e` ni o'zgartirsa, sahifa qayta chizilmaydi:
router `wc:watchpop` hodisasini yuboradi, `watch.js` esa qismni joyida
almashtiradi (`/api/episode.php`). `e` butunlay olib tashlansa -- oddiy
soft-nav.

`watch.js` ning o'z `popstate` handleri SPA rejimida ishlamaydi (router
boshqaradi), aks holda qism ikki marta yuklanardi.

## 6. Bayroqlar va diagnostika

| Kalit | Ma'nosi |
|---|---|
| `localStorage.wc_spa = '0'` | App Shell butunlay o'chadi (to'liq yuklash) |
| `localStorage.wc_mtproto_worker = '0'` | MTProto worker o'chadi (main thread) |

Konsolda:

```js
WCApp.state()
// { enabled:true, page:'watch', url:'...', route:'watch', scope:true, cached:2 }

TgStream.boshqarish.ulanish()
// { fast:true, worker:true, ... }  <- SPA o'tishdan keyin ham shunday
```

`WCApp.state().route === null` bo'lsa, joriy manzil SPA marshruti emas.

## 7. Yangi SPA sahifa qo'shish

1. `$WC_SPA = true;` ni nav'dan oldin qo'ying.
2. Mazmunni `<div id="wc-page" data-wc-page="yangi">` ichiga oling.
3. `WCApp.beginPage()` ni darhol ichkariga qo'ying.
4. `routeOf()` ga marshrutni qo'shing (`app-shell.js`).
5. Sahifa moduli `DOMContentLoaded` ga tayanmasin:

```js
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();   // soft-nav: DOM allaqachon tayyor
}
```

6. Modul qayta ishga tushganda eski resurslarni yopadi (masalan
   `TGComments.dispose()`).
7. PHP configlari global `const` bilan emas, `window.*` bilan uzatilsin
   (`profile.js` shunday qilingan), aks holda ikkinchi ishga tushishda
   `SyntaxError: Identifier ... has already been declared` bo'ladi.
8. `.work/tools/app-shell.test.mjs` ni yangilang.

## 8. Test

```bash
node .work/tools/app-shell.test.mjs
```

Test `vm` ichida minimal DOM bilan ishlaydi: `Scope` tozalashi,
`untracked()` himoyasi, capture tartibi, 9 ta marshrut, `PERSIST_RE`,
sahifa shartnomasi, head config / inline style sinxronizatsiyasi va
`wc:watchpop` ko'prigi tekshiriladi. Tarmoq talab qilinmaydi.
Oxirgi natija: **170 PASS, 0 FAIL**.
