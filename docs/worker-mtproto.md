# MTProto — Dedicated Web Worker

Bu hujjat `assets/js/tg-mtproto-worker.js` (MTProto klientni asosiy oqimdan
tashqariga chiqarish) qanday ishlashini, qanday o'chirishni va qanday
tekshirishni tushuntiradi.

---

## 1. Nima uchun

`tg-mtproto.js` ichida AES-256-IGE/CTR, SHA-256 va WebSocket oqimi bor.
Ilgari bu ish **asosiy oqimda** (main thread) bajarilardi:

- 512 KB–1 MB bo'lakni shifrlash/deshifrlash bir necha o'n millisekundni
  egallaydi;
- shu payt scroll, hover-preview va CSS animatsiyalar "qotadi";
- 4–6 parallel lane ishlaganda bu sekinlashuv yig'iladi.

Endi klient **Dedicated Worker** ichida yashaydi. Bu **Service Worker emas**:

| | Dedicated Worker | Service Worker |
|---|---|---|
| Kim yaratadi | sahifa (`new Worker`) | brauzer (`register`) |
| Qachon o'chadi | sahifa yopilganda | ~30 s bo'sh turganda |
| WebSocket | sahifa tirik ekan — tirik | uxlab qoladi, socket uziladi |
| MTProto uchun | ✅ | ❌ |

Service Worker (`tg-cdn-worker.js`) o'z vazifasini bajarishda davom etadi:
`206 Partial Content` qaytaradi va kerakli baytlarni **sahifadan** so'raydi.
Sahifa esa ularni worker'dagi MTProto klient orqali oladi.

```
<video> ──Range──▶ Service Worker ──read──▶ sahifa ──call──▶ Dedicated Worker
                        ▲                                        │
                        └──────────── 206 ◀──── baytlar ◀────────┘
```

Ya'ni kripto va tarmoq ishi asosiy oqimdan chiqadi, lekin SW arxitekturasi
o'zgarmaydi.

---

## 2. Protokol

Sahifa (`tg-stream.js` → `createFastWorkerClient`) va worker o'rtasidagi
xabarlar:

| Xabar | Yo'nalish | Ma'no |
|---|---|---|
| `init { opts }` | sahifa → worker | `TgFast.createClient(opts)` |
| `ready { dcId, keyId }` | worker → sahifa | klient tayyor |
| `call { id, method, args }` | sahifa → worker | metod chaqiruvi |
| `done { id, result }` | worker → sahifa | natija (baytlar transferable) |
| `fail { id, error }` | worker → sahifa | xato matni |
| `open { dc }` | worker → sahifa | shu DC'ga socket ochildi |
| `fatal { error }` | worker → sahifa | import/init halokatli xatosi |
| `close` | sahifa → worker | klientni yopib, worker'ni tugatish |

Qo'llab-quvvatlanadigan metodlar: `warm`, `getFile`, `readRange`,
`keepAlive`, `setDcKey`, `dropDcKey`, `hasDcKey`, `isOpen`.

`getFile` / `readRange` natijasi `Uint8Array` bo'lib, **transferable** sifatida
uzatiladi — 512 KB bo'lak uchun qo'shimcha nusxa olinmaydi. Agar natija
boshqa buffer'ning ko'rinishi (subarray) bo'lsa, worker xavfsiz nusxa oladi:
buffer'ning boshqa qismlari detach bo'lib qolmasligi kerak.

---

## 3. Xavfsizlik qoidalari

### 3.1. `AUTH_KEY_DUPLICATED`

Telegram bitta `auth_key` bilan ikki parallel WebSocket ochilsa, sessiyani
bekor qiladi. Shuning uchun:

- worker socket ochgandan keyin (`open` xabari yoki `warm` javobi) sahifa
  **main thread'dagi klientga avtomatik qaytmaydi**;
- `isOpen(dc)` sinxron javob beradi — `warmDcList()` GramJS orqali o'sha
  DC'da ikkinchi ulanish ochmasligi uchun;
- worker butunlay yiqilsa va **hech qanday socket ochmagan** bo'lsa
  (`!everOk && !everOpen`) — `switchToDirect()` xavfsiz ishlaydi;
- aks holda odatdagi `S.fastBroken` → GramJS yo'li ishlaydi (u avval
  socketni yopadi).

### 3.2. `file_reference`

Worker bu mantiqni o'zgartirmaydi: havola ~1 soatda eskiradi, `FILE_REFERENCE_*`
xatosida sahifa yangi havola oladi va so'rovni bir marta takrorlaydi.

### 3.3. Flood

Worker ichida ham `tg-mtproto.js` ning o'z chegaralari saqlanadi:
`upload.getFile` ≤ 1 MB, `netLanes()` 2–6 lane, `FLOOD_WAIT` da qayta
urinilmaydi.

---

## 4. O'chirish va kuzatish

Butun worker qatlamini o'chirish (eski, main thread yo'liga qaytish):

```js
localStorage.setItem('wc_mtproto_worker', '0');
location.reload();
```

Qayta yoqish:

```js
localStorage.removeItem('wc_mtproto_worker');
```

Holatni konsoldan tekshirish:

```js
TgStream.boshqarish.ulanish();
// { active: true, fast: true, worker: true, sw: true, chan: true }
```

`worker: true` — MTProto alohida Worker'da. `worker: false` bo'lsa ham
`fast: true` bo'lishi mumkin: bu main thread fallback'i.

Worker ichidagi xatolar konsolda `[Worker]` prefiksi bilan ko'rinadi; sahifa
tomonidagi xatolar avvalgidek qoladi.

---

## 5. Keshlash / versiyalash

`.htaccess` JS fayllarni `immutable` bilan keshlaydi. Shuning uchun:

- `includes/perf-head.php` `window.__WCMTPROTOV` va
  `window.__WCMTWORKERV` ni `filemtime` bo'yicha beradi;
- worker URL'i `?v=<worker>&p=<mtproto>` bilan yuklanadi;
- worker ichida `importScripts('tg-mtproto.js?v=<mtproto>')` ishlatiladi.

Fayl o'zgarsa, ikkala versiya ham avtomatik yangilanadi — qo'lda kesh
tozalash shart emas.

---

## 6. Testlar

```bash
node .work/tools/tg-mtproto-worker.test.mjs
```

Test tarmoqsiz ishlaydi: `importScripts` fake `TgFast` bilan almashtiriladi.
Tekshiriladi:

- `init` → `ready`, takroriy `init` yangi klient yaratmasligi;
- `getFile` / `readRange` → `done` + transferable `ArrayBuffer`;
- `warm` → `open` xabari `done` dan oldin;
- `FLOOD_WAIT_5` → `fail` (matn saqlanadi);
- noma'lum metod va `init`siz chaqiruv → `fail`;
- `close` → klient yopiladi, keyingi chaqiruvlar e'tiborsiz;
- statik qo'riq: `wc_mtproto_worker` bayrog'i, `switchToDirect` sharti,
  `perf-head.php` versiyalari.

MTProto matematikasi alohida tekshiriladi:

```bash
node .work/tools/tg-mtproto.test.mjs
node .work/tools/tg-mtproto-pool.test.mjs
node .work/tools/tg-mtproto-ws.test.mjs
```

---

## 7. Chegaralar

- Worker bitta sahifa uchun bitta; har bir tab o'z worker'iga ega.
- `localStorage` worker'da mavjud emas — `wc_pool` / `wc_media` sozlamalari
  `try/catch` ichida o'qiladi va sukut qiymat bilan ishlaydi.
- Worker SW'ni almashtirmaydi: `206`, Cache Storage va R2 prefiksi
  avvalgidek `tg-cdn-worker.js` da.
- `file_reference` muddati va Telegram flood chegaralari o'zgarmaydi.
