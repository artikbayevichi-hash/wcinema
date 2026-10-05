// ============================================================================
// TELEGRAM CDN SERVICE WORKER
// ============================================================================
//
// VAZIFA
//   Brauzerdagi <video> odaticha ishlaydi: `src` bilan, `preload` bilan,
//   seek bilan, to'xtatish/payqatish bilan. Farq shundaki, manba URL'i
//   "soxta" — /tele_uzdub/tgfile/...
//   Bu Service Worker so'rovni ushlab, Telegram CDN dan aynan so'ralgan
//   baytlarni MTProto orqali oladi va 206 Partial Content qaytaradi.
//
// NIMA UCHUN SHUNDAY?
//   1) MSE (MediaSource) ISHLAMAYDI.
//      Chrome'ning MSE qatlami faqat FRAGMENTLANGAN MP4 (moof+mdat) qabul
//      qiladi. Telegram videolari mo's (fragmentlanmagan) MP4 bo'lgani uchun
//      MSE ularni rad etadi: video.error = 4 (SRC_NOT_SUPPORTED).
//      Bu brauzerda tekshirilgan (mp4 atom tahlili + MSE sinovi).
//
//   2) Oddiy <video> esa ISHLAYDI — hatto indeks (moov) fayl oxirida
//      bo'lsa ham. Chunki brauzer o'zi kerakli joylarni Range so'rovi bilan
//      so'raydi: avval boshidan boshlaydi, so'ng oxiridan mo'ov'ni oladi.
//      Bizning vazifamiz — shu so'rovlarni Telegram ga yetkazib berish.
//
//   3) Shundagina SERVER GA UMUMAN VIDEO YUQMAYDI.
//      Sayt serveri faqat HTML/JS beradi. Butun video trafik —
//      brauzer <-> Telegram CDN orasida. Foydalanuvchining auth_key esa
//      faqat shu brauzerda (localStorage) saqlanadi.
//
// NIMA UCHUN MTPROTO SW ICHIDA EMAS?
//   GramJS paketi 5 MB va Node.js ekvivalentlariga (fs, net, os) tayanadi —
//   Service Worker muhitida ishlashi ishonchsiz. Shu sababli MTProto
//   SAHIFADA qoladi, SW esa faqat "HTTP server" rolini o'ynaydi va
//   kerakli baytlarni sahifadan so'rab oladi (MessageChannel orqali).
//
// UMR BOYI (bu MUHim)
//   Service Worker xotirasi (Map, Array) ISHONCHSIZ — brauzer uni
//   ixtiyoriy paytda o'chirib tashlaydi. Shuning uchun bu faylda saqlanadigan
//   narsa YO'Q. Har bir so'rovda ma'lumot sahifadan so'raladi. Kelganda
//   sahifa darhol qayta ulanadi (`postMessage({type:'provide'})`).
//
//   Sahifada `provider` yo'q bo'lsa, SW sabr qilib turadi (2.5 s) va o'zi
//   sahifaga `needProvider` deb murojaat qiladi. Sahifa javobgar bo'lib,
//   `provide` yuboradi — so'rov davom etadi.
//
//   ESKI OBYEKT HAQIDA (jimgina xato — bu yerda yozib qo'ydim):
//     `navigator.serviceWorker.controller` ni bir marta olib saqlab qo'yish
//     XATO. SW yangilanganda yoki sahifa qayta yuklanganda controller obyekti
//     ALMASHADI. Eski obyektga yuborilgan `postMessage` JIMGINA yo'qoladi —
//     na xato, na log. Sahifada har doim `navigator.serviceWorker.controller`
//     ni HOZIROQ olishi kerak, va `controllerchange` hodisasida qayta ulanish.
//
//   `provide` kelganda KUTAYOTGAN so'rovlarni rad etish XATO — bu xabar
//   tez-tez keladi (har bir SW yangilanishi, qayta ulanishda) va u har
//   kelganida <video> ning joyida turgan so'rovlarni ham xotim buzardi.
//   Faqat eski port yopiladi.
//
// ISHLATISH (tg-proof.php ichida):
//   1. navigator.serviceWorker.register('tg-cdn-worker.js', { scope: './' })
//   2. navigator.serviceWorker.controller mavjudligini tekshirish
//   3. controller.postMessage({ type: 'provide', size }, [port2])
//   4. video.src = 'tgfile/?size=...'   → brauzer Range so'raydi
// ============================================================================

// --------------------------------------------------------------- holat (vaqtincha)
// Faqat "qaysi port javobgar" degan minimal ma'lumot. SW o'chsa ham
// sahifa darhal qayta ulanadi (postMessage orqali).
let provider = null;                 // MessagePort — sahifaga so'rov yuborish uchun
const waiting = [];                  // javob kutayotgan so'rovlar

// Bitta Telegram so'rovida so'raydigan bayt miqdori.
//
// DIQQAT: Telegram 4 MB so'rovni RAD ETADI ("LIMIT_INVALID") — buni amalda
// ko'rdik. Rasmiy mijozlar va GramJS standartida 512 KB ishlatiladi, ana shu
// ishonchli qiymat. (Telegramning hujjatida aytilgan maksimum 1 MB.)
let CHUNK = 512 * 1024;
const MIN_CHUNK = 64 * 1024;   // shundan kichikga tushmaymiz

// Bitta HTTP javobida qancha bayt qaytaramiz?
//
// Nega bir necha Telegram so'rovini birlashtiramiz? Sabab - MP4 indeksi
// (moov qutisi). Katta filmlarda u bir necha yuz KB dan MB gacha bo'ladi va
// faylning OXIRIDA turadi. Agar brauzer so'raganda biz faqat bitta bo'lak
// (512 KB) qaytarsak, indeks to'liq kelmaydi - brauzer uni tushunmaydi va
// "format qo'llab-quvvatlanmaydi" (error 4) xatosi beradi.
const MAX_RESPONSE = 8 * 1024 * 1024;

// "bytes=0-" (ya'ni butun faylni so'rash) da javobni KICHIK qilib beramiz.
// Aks holda foydalanuvchi birinchi kadrni ko'rish uchun o'nlab soniya kutadi.
// Qolganini brauzer o'zi so'raydi.
const FIRST_CHUNK = 2 * 1024 * 1024;

const STATS = { requests: 0, bytes: 0, seeks: 0, par: 0 };
let PROVIDES = 0;                    // sahifa necha marta "ulangan" — diagnostika

// Sahifadagi log oynasiga xabar yuborish (diagnostika)
function say(msg) {
  self.clients.matchAll()
    .then((list) => {
      for (const c of list) c.postMessage({ type: 'log', msg: msg });
    })
    .catch(() => { /* sahifa yopilgan bo'lishi mumkin */ });
}

// "Qayta ulan" degan murojaat: SW'ning xotirasi bo'shaganda chaqiriladi.
function askForProvider() {
  self.clients.matchAll()
    .then((list) => {
      for (const c of list) c.postMessage({ type: 'needProvider' });
    })
    .catch(() => { /* sahifa yopilgan bo'lishi mumkin */ });
}

// ---------------------------------------------------------------------- lifecycle
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// ---------------------------------------------------------------------- xabarlar
self.addEventListener('message', (e) => {
  const d = e.data || {};

  // --- Sahifaga o'zimizni yetkaz (claim) ------------------------------
  //
  // Nima uchun? `activate` da `clients.claim()` bor, lekin agar sahifa
  // SW faollashgandan KEYIN yuklansa, `activate` hodisasi o'tib ketgan
  // bo'ladi va sahifa hech qachon boshqarilmay qoladi. Bu holatda
  // `<video>` so'rovi butunlay serverga (404) ketadi.
  //
  // Shuning uchun sahifa istalgan payt `claim` so'raydi — bu har doim
  // ishlaydi va ishonchli.
  if (d.type === 'claim') {
    if (e.waitUntil) e.waitUntil(self.clients.claim());
    return;
  }

  // --- Sahifa o'zini javobgar deb e'lon qildi ------------------------
  if (d.type === 'provide') {
    // Muhim: bu yerda KUTAYOTGAN so'rovlarni rad etmASLIK kerak.
    // `provide` xabari tez-tez keladi (SW yangilandi, SW qayta ishga
    // tushdi, sahifa qayta ulandi) — va u har kelganida yana keladigan
    // so'rovlarni ham yopib qo'yishi kerak edi. Aksincha: eski portni
    // yopamiz, yangisini olamiz, davom etayotgan so'rovlarga tegmaymiz.
    const old = provider;
    provider = e.ports && e.ports[0];
    if (old && old !== provider) {
      try { old.close(); } catch (err) { /* allaqachon yopilgan */ }
    }
    PROVIDES++;
    say('Sahifa javobgar bo\'ldi · fayl hajmi: ' + d.size + ' bayt'
      + (PROVIDES > 1 ? ' · #' + PROVIDES + '-ulash' : ''));
    return;
  }

  // --- So'rov natijasi keldi (sahifadan) -----------------------------
  if (d.type === 'result') {
    const i = waiting.findIndex((j) => j.id === d.id);
    if (i < 0) return;                       // kechikkan javob (bekor qilingan)
    const job = waiting.splice(i, 1)[0];
    clearTimeout(job.timer);
    if (d.error) job.reject(new Error(d.error));
    else job.resolve(d.bytes);
    return;
  }

  // --- Diagnostika ---------------------------------------------------
  if (d.type === 'stats') {
    const p = e.ports && e.ports[0];
    const s = 'so\'rov: ' + STATS.requests + ' · ' + (STATS.bytes / 1048576).toFixed(1)
      + ' MB · seek: ' + STATS.seeks + ' ta · parallel: ' + STATS.par
      + ' · ulash: ' + PROVIDES;
    say('📊 ' + s);
    if (p) p.postMessage({ type: 'stats', text: s });
  }
  if (d.type === 'reset') { STATS.requests = 0; STATS.bytes = 0; STATS.seeks = 0; STATS.par = 0; }
});

// ------------------------------------------------------------- sahifadan bayt olish
// DIQQAT: har bir so'rov uchun ALOHIDA MessageChannel yaratamiz, chunki
// javobni qaytarish uchun port kerak — boshqalar chalkashmasligi uchun.
function readFromPage(offset, length) {
  return new Promise((resolve, reject) => {
    if (!provider) {
      // SW qayta ishga tushgan (brauzer bo'sh turgan SW'ni o'chirib
      // tashlaydi) va xotirasi bo'shgan. Darhol xato bermaslik uchun
      // kutamiz: sahifa `provide` xabarini yuborgach `provider` to'lib qoladi.
      //
      // 2.5 s chegarasi YETMAYDI: katta faylda brauzer o'nlab sekund
      // davomida so'rov yuboradi, SW esa shu paytda bo'sh bo'lsa
      // `NO_PROVIDER` butun o'ynashni birdan buzadi. 8 s kutamiz.
      const waitStart = Date.now();
      let lastAsk = 0;
      const iv = setInterval(() => {
        if (provider) {
          clearInterval(iv);
          readFromPage(offset, length).then(resolve, reject);
          return;
        }
        // Sahifaga yana murojaat qilamiz: "qayta ulan". Bitta marta so'rash
        // YETMAYDI — xabar navbatda turib qolishi mumkin, shuning uchun
        // har 700 ms da takrorlaymiz.
        const now = Date.now();
        if (now - lastAsk > 700) { lastAsk = now; askForProvider(); }
        if (now - waitStart > 8000) {
          clearInterval(iv);
          // Hali ham yo'q - so'rovni bekor qilamiz; <video> o'zi qayta
          // so'raydi.
          reject(new Error('NO_PROVIDER'));
        }
      }, 700);
      lastAsk = Date.now();
      askForProvider();
      return;
    }

    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const chan = new MessageChannel();
    const timer = setTimeout(() => {
      const i = waiting.findIndex((j) => j.id === id);
      if (i >= 0) waiting.splice(i, 1);
      reject(new Error('Telegram 30 s ichida javob bermadi'));
    }, 30000);

    waiting.push({ id: id, resolve: resolve, reject: reject, timer: timer });

    // port1 -> sahifaga (javob uchun), port2 -> o'zimizda (natija uchun)
    chan.port1.onmessage = (ev) => {
      const r = ev.data || {};
      chan.port1.close();
      const i = waiting.findIndex((j) => j.id === id);
      if (i < 0) return;
      waiting.splice(i, 1);
      clearTimeout(timer);
      if (r.error) reject(new Error(r.error));
      else resolve(r.bytes);
    };

    try {
      provider.postMessage(
        { type: 'read', id: id, offset: offset, length: length },
        [chan.port2]
      );
    } catch (err) {
      const i = waiting.findIndex((j) => j.id === id);
      if (i >= 0) waiting.splice(i, 1);
      clearTimeout(timer);
      reject(new Error('sahifaga yetkazib bo\'lmadi: ' + err.message));
    }
  });
}

// ============================================================================
// Kerakli oraliqni yig'ish
// ============================================================================
//
// Telegram'dan bir so'rovda CHUNK baytdan ko'pi kelmaydi, lekin bizga bitta
// HTTP javobida ko'proqni qaytarish kerak bo'lishi mumkin (katta moov indeks
// holati). Shuning uchun keraklicha bo'laklarni yig'amiz.
//
// `size` - fayl hajmi. U kerak, chunki QISQA javob endi har doim ham
// "fayl tugadi" degani EMAS: sahifa 4096 ga tegilash uchun limitni yuqoriga
// tekislaydi va shuning uchun so'ramandek qaytaradi. EOF ni faqat haqiqiy
// fayl chegarasidan aniqlaymiz.
//
// ---------------------------------------------------------------------------
//  TEZLIK: PARALLEL O'QISH
// ---------------------------------------------------------------------------
//
// Avval har bir bo'lak KETMA-KET so'ranardi: bitta so'rov kelishini kutib,
// keyin keyingisini yuborish. Bu bitta RTT (round-trip time) da bitta bo'lak
// degani - ya'ni tezlik RTT ga bog'liq. 720p oqim uchun sekundiga ~1.5 MB
// kerak, bitta RTT esa odatda 60-150 ms. Ya'ni ketma-ket usul ko'pincha
// 4-10 MB/s dan oshmasligi mumkin edi.
//
// Endi bir vaqtda PARALLEL ta so'rov yuboramiz. Bu xuddi Telegram Desktop
// qiladigan narsa (u katta fayllar uchun 4 ta parallel ulanish ochadi), demak
// Telegram tomonida bu NORMAL va FLOOD_WAIT bermaydi.
//
// MUHIM: parallel usul "tez, lekin nozik" - bitta bo'lak xato bo'lsa butun
// guruh to'xtaydi. Shuning uchun parallel muvaffaqiyatsiz bo'lsa, ISHONCHLI
// ketma-ket usulga QAYTAMIZ. Olingan ma'lumot YO'QOLMAY, faqat qayta o'qiladi
// (bu holat kam uchraydi - 512 KB allaqachon ishlaydigan qiymat).
const PARALLEL = 4;

// Uint8Array ga aylantirish (MessagePort strukturaviy nusxa beradi)
function toU8(b) {
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

// Bo'laklarni bitta massivga yig'ish
function concat(parts, total) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(total);
  let p = 0;
  for (const u8 of parts) { out.set(u8, p); p += u8.length; }
  return out;
}

// Telegram bo'lak HAJMI bilan bog'liq xatoni rad etdimi?
function isSizeRejected(err) {
  const m = String((err && err.message) || '');
  return /LIMIT_INVALID|FILE_PART_TOO_BIG|REQUEST_LARGE_INVALID/.test(m);
}

// TELEGRAM QOIDASI (amalda o'lchandi): bitta `upload.getFile` so'rovi
// 1 MB BLOK chegarasidan oshib ketmasligi shart. Agar 512 KB bo'lak
// chegarani kesib o'tsa, Telegram `LIMIT_INVALID` qaytaradi (natijada
// `<video>` 502 oladi). Shu funksiya `off` turgan 1 MB blokda qolgan
// bayt sonini beradi — har doim 4096 ga karrali va kamida 4096.
const TG_BLOCK = 1024 * 1024;
function roomInBlock(off) {
  const a = off - (off % 4096);
  return TG_BLOCK - (a % TG_BLOCK);
}

// --- Tez yo'l: bo'laklarni PARALLEL yig'ish -------------------------------
function readRangeParallel(start, goal) {
  return (async function () {
    const parts = [];
    let got = 0;

    while (got < goal) {
      const remaining = goal - got;
      const n = Math.min(PARALLEL, Math.ceil(remaining / CHUNK));

      // Bo'laklarni oldindan REJA qilamiz. Har birining boshlanishi
      // aniq belgilangan, shuning uchun ular parallel kelganda tartibini
      // saqlab qo'yishimiz mumkin.
      const jobs = [];
      let plan = 0;
      for (let k = 0; k < n; k++) {
        const off = start + got + plan;
        // 1 MB blok chegarasini kesib o'tmaymiz (aks holda LIMIT_INVALID).
        const piece = Math.min(CHUNK, roomInBlock(off), remaining - plan);
        if (piece <= 0) break;
        jobs.push({ off: off, want: piece });
        plan += piece;
      }
      if (jobs.length === 0) break;

      // DIQQAT: Promise.all BUTUN guruhni birdan rad etadi - kelgan
      // natijalarni yo'qotib yuboradi. Shuning uchun har bir bo'lakni
      // alohida ushlab, natijani yig'iz.
      const res = await Promise.all(jobs.map(async function (j) {
        try { return { u8: await readFromPage(j.off, j.want).then(toU8) }; }
        catch (err) { return { err: err }; }
      }));

      STATS.par += jobs.length;

      for (let k = 0; k < res.length; k++) {
        if (res[k].err) {
          const e = res[k].err;
          // Telegram hajmi rad etdi - bu ma'lumot, CHUNK ni kichiklashtiramiz.
          if (isSizeRejected(e)) throw e;
          // Boshqa xato (internet uzildi, vaqtout, Telegram xatosi).
          if (got > 0) {
            say('! parallel ' + jobs[k].off + '+' + jobs[k].want + ': ' + e.message
              + ' - qisman javob (' + got + ' bayt)');
            return concat(parts, got);
          }
          throw e;
        }
        const u8 = res[k].u8;
        if (u8.length) { parts.push(u8); got += u8.length; }
      }
    }

    if (!parts.length) throw new Error('Telegram hech narsa bermadi');
    return concat(parts, got);
  })();
}

// --- Ishonchli yo'l: KETMA-KET o'qish (avvalgi, tekshirilgan usul) --------
function readRangeSerial(start, goal) {
  return (async function () {
    const parts = [];
    let got = 0;

    while (got < goal) {
      // 1 MB blok chegarasini kesib o'tmaymiz (aks holda LIMIT_INVALID).
      const piece = Math.min(goal - got, CHUNK, roomInBlock(start + got));

      let u8;
      try {
        u8 = toU8(await readFromPage(start + got, piece));
      } catch (err) {
        // Telegram bo'lak hajmini rad etgan - kichiklashtirib, aynan
        // shu o'lchamdagi qiymatni TOPAMIZ.
        if (isSizeRejected(err) && CHUNK > MIN_CHUNK) {
          CHUNK = Math.max(MIN_CHUNK, CHUNK >> 1);
          say('! Telegram hajmini rad etdi - ' + (CHUNK / 1024) + ' KB bilan qayta urinaman');
          continue;
        }
        if (got === 0) throw err;
        say('! ' + (start + got) + '+' + (goal - got) + ': ' + err.message
          + ' - qisman javob qaytarilyapti');
        break;
      }

      if (!u8.length) break;
      parts.push(u8);
      got += u8.length;
    }

    if (!parts.length) return new Uint8Array(0);
    return concat(parts, got);
  })();
}

// --- Umumiy kirish nuqtasi -------------------------------------------------
//
// Avval tez (parallel) yo'lni sinaymiz. Muvaffaqiyatsiz bo'lsa - sababiga
// qarab ikki xil qaror:
//   * Telegram hajmini rad etgan  -> CHUNK ni kichiklashtirib, parallel
//                                    yo'lni qayta sinab ko'ramiz.
//   * Boshqa xato                  -> ishonchli ketma-ket yo'lga o'tamiz.
async function readRange(start, want, size) {
  const goal = Math.min(want, size - start);
  if (goal <= 0) return new Uint8Array(0);

  try {
    return await readRangeParallel(start, goal);
  } catch (err) {
    const msg = String((err && err.message) || err);

    // NO_PROVIDER - SW o'z-o'zini qayta ishga tushganda sahifaga
    // yetib borolmagandik. Qayta urinish ma'nosiz (u ham sahifaga bog'liq),
    // lekin SW allaqachon `needProvider` yuborgan.
    if (msg === 'NO_PROVIDER') throw err;

    if (isSizeRejected(err) && CHUNK > MIN_CHUNK) {
      CHUNK = Math.max(MIN_CHUNK, CHUNK >> 1);
      say('! Telegram bo\'lak hajmini rad etdi - ' + (CHUNK / 1024)
        + ' KB bilan qayta urinaman');
      try {
        return await readRangeParallel(start, goal);
      } catch (err2) {
        if (String((err2 && err2.message) || '') === 'NO_PROVIDER') throw err2;
        say('! ' + err2.message + ' - ketma-ket o\'qishga o\'taman');
      }
      return readRangeSerial(start, goal);
    }

    say('! tez yo\'l ishlamadi (' + msg + ') - ketma-ket o\'qishga o\'taman');
  }

  return readRangeSerial(start, goal);
}

// ------------------------------------------------------------- Range so'rovini o'qish
// "bytes=0-"      → boshidan oxirigacha   (ochiq — `open: true`)
// "bytes=100-200" → aynan shu oraliq
// "bytes=-500"    → oxirgi 500 bayt
//
// `open` alohida belgilanadi, chunki u "hammasini ber" degan so'rov —
// bunday javobni KICHIK qilib berish kerak (tez kuzatish uchun), aks holda
// foydalanuvchi birinchi kadrni ko'rish uchun o'nlab soniya kutadi.
function parseRange(header, size) {
  if (!header) return null;
  const m = /bytes=(\d*)-(\d*)/.exec(header);
  if (!m) return null;
  if (m[1] === '' && m[2] === '') return null;

  let start, end, open = false;
  if (m[1] === '') {
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    if (m[2] === '') { end = size - 1; open = true; }
    else end = Math.min(Number(m[2]), size - 1);
  }
  if (!(start >= 0) || start > end || start >= size) return null;
  return { start: start, end: end, open: open };
}

// ---------------------------------------------------------------------- asosiy
//
// Range siz so'rov uchun progressiv oqim: 200 OK + to'liq `Content-Length`.
//
// Oqim qanday ishlaydi:
//   * Brauzer `<video>` boshlanganda Range SIZ so'rov yuboradi. Shu yerda
//     biz 200 + Content-Length: <hajm> qaytaramiz va haqiqiy ReadableStream
//     ochamiz. Endi brauzer "bu 546 MB li video" deb biladi va o'zi
//     xohlagancha (backpressure) tortib oladi.
//   * Brauzer to'xtatganda (seek yoki sahifa yopilganda) `cancel()` chaqiriladi
//     va biz o'qishni darhol to'xtatamiz — ortiqcha trafik sarflanmaydi.
//
// ---------------------------------------------------------------------------
//  IKKITA BOSQICH: DARHOL BIR BO'LAK, KEYIN QOLGANI
// ---------------------------------------------------------------------------
//
// NIMA UCHUN: avval har bir `pull` 1 MB so'raydi, ya'ni `readRangeParallel`
// ichida 2 ta parallel Telegram so'rovi (512 KB + 512 KB). Ikkalasi ham
// tugagandan KEYIN brauzerga birinchi bayt yetib boradi. Sekundiga 3-4 MB
// tezlikda bu bitta qadam ~0.5 s, sekin internetda bir necha sekun — ya'ni
// video "ochilishi" sezilarli kechikadi.
//
// Endi oqim IKKITA QADAMDA ishlaydi:
//
//   1-BOSQICH (darhol) — bitta 512 KB bo'lak. Bitta Telegram so'rovi, bitta
//     RTT. MP4 sarlavhasi (`ftyp` + `moov`) shu yerda bo'lsa, brauzer birinchi
//     kadrni deyarli darhol ko'rsatadi.
//
//   2-BOSQICH (2 sekundan keyin) — qolgan butun fayl. Endi tezlik muhim:
//     har tortish 2 MB va ichida 4 ta parallel so'rov (PARALLEL).
//
// NIMA UCHUN "FON ISHLOVCHI" (producer) va NAVBAT:
//
// Oqimning o'zini to'xtatib kutsa — brauzer `pull()` ga to'xtamaydi
// chaqirib turadi va video 2 soniya "tosib" qoladi. Shuning uchun:
//
//   * `produce()` — FONDA ishlaydi: Telegram'dan o'qib, navbatga soladi.
//     1-bosqichni darhol, 2-bosqichni 2 s dan keyin boshlaydi va
//     NAVBAT TO'LMAY turib davom etadi (foydalanuvchi ko'rayotgan paytda
//     keyingi qism oldindan tayyor bo'lib turadi — "buffer" qisqa bo'lmaydi).
//   * `pull(controller)` — faqat navbatdan oladi. Navbat bo'sh bo'lsa
//     `produce()` tugashini kutadi, lekin o'z-o'zidan Telegram'ga
//     so'rov YUBORMAYDI.
//
// XOTIRA: navbat chegaralanadi (QUEUE_MAX). Aks holda 546 MB li fayl
// butunlay RAM ga yig'ilib, telefonda brauzerni o'ldirardi. Chegara
// oshilganda `produce` kutadi — bu aynan `backpressure` roli.
const FIRST_PULL = 512 * 1024;      // 1-bosqich: bitta bo'lak, darhol
const REST_PULL = 2 * 1024 * 1024;   // 2-bosqich: katta bo'lak, tez
const REST_DELAY = 2000;             // ms — qolgani shundan keyin yuklanadi
const QUEUE_MAX = 2;                 // navbatda nechta bo'lak (2 x 2 MB = 4 MB)

async function progressiveResponse(size, mime, baseHeaders) {
  let off = 0;                       // Telegram'dan o'qilgan bayt soni
  let dead = false;                  // brauzer bekor qilgan (yopilgan/seek)
  let done = false;                  // fayl to'liq o'qib bo'ldi
  let err = null;                    // oxirgi xato
  let part = 1;
  const queue = [];                  // tayyor baytlar (Uint8Array)
  const waiters = [];                // navbat bo'sh bo'lishini kutayotganlar

  // Kimdir navbatga keldi yoki shart o'zgarganda — barcha kutuvchilarni
  // uyg'otamiz. Ro'yxat bo'lgani uchun `pull` ham, `produce` ham bir vaqtda
  // kuta oladi (oldingi bitta `wake` sloti ikkinchisini yo'qotardi).
  function notify() {
    while (waiters.length) waiters.shift()();
  }
  function waitTick() {
    return new Promise(function (r) { waiters.push(r); });
  }
  function pause(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // --- FON ISHLOVCHI -------------------------------------------------------
  async function produce() {
    try {
      // ---- 1-BOSQICH: darhol bitta kichik bo'lak --------------------------
      const first = await readRange(0, Math.min(FIRST_PULL, size), size);
      if (dead) return;
      if (first && first.length) {
        off += first.length;
        STATS.requests++;
        STATS.bytes += first.length;
        queue.push(first);
        say('~ oqim #1 ' + (first.length / 1024).toFixed(0) + ' KB — darhol');
        notify();
      }
      part++;                              // keyingi bo'lak "#2" bo'lib hisoblanadi

      // ---- 2-BOSQICH: 2 sekunddan keyin qolgan fayl ----------------------
      // `dead` bo'lsa kutmaymiz — brauzer allaqachon yopgan bo'lsa 2 sekun
      // bekor qilib turish ortiqcha. 50 ms da bo'lib `dead` ga tez javob beramiz.
      if (!dead && !done && REST_DELAY > 0) {
        let left = REST_DELAY;
        while (left > 0 && !dead) {
          const step = left > 50 ? 50 : left;
          await pause(step);
          left -= step;
        }
      }
      if (dead) return;

      // ---- fayl oxirigacha (navbat to'lmasdan oldin to'xtaydi) -----------
      while (!dead && !err && off < size) {
        // Navbat to'lgan — bu BACKPRESSURE: brauzer o'z tezligida ko'rayapti,
        // biz esa ortiqcha yuklamaymiz. Bo'sh joy bo'lganda `notify` uyg'otadi.
        while (!dead && !err && queue.length >= QUEUE_MAX) await waitTick();

        const want = Math.min(REST_PULL, size - off);
        const u8 = await readRange(off, want, size);
        if (!u8 || !u8.length) break;      // Telegram kamroq berdi / fayl tugadi
        off += u8.length;
        STATS.requests++;
        STATS.bytes += u8.length;
        queue.push(u8);
        if (part <= 2 || part % 20 === 0) {
          say('~ oqim #' + part + ' ' + (off / 1048576).toFixed(1) + ' / '
            + (size / 1048576).toFixed(1) + ' MB'
            + (part === 2 ? '  (2 s dan keyin — qolgani)' : ''));
        }
        part++;
        notify();
      }
    } catch (e) {
      if (!dead) {
        err = e;
        say('✗ oqim ' + off + ': ' + ((e && e.message) || e));
      }
    } finally {
      done = true;
      notify();                            // `pull` buni kutayotgan bo'lishi mumkin
    }
  }

  // Fon ishlovchini shu yerda ishga tushiramiz — javob darhol qaytariladi
  // (200 OK + sarlavhalar), baytlar esa `stream` orqali keladi.
  produce();

  const stream = new ReadableStream({
    async pull(controller) {
      // Navbat bo'sh bo'lsa `produce` tugashini yoki yangi baytni kutamiz.
      while (!queue.length && !dead && !done && !err) await waitTick();
      if (dead) return;
      if (err && !queue.length) {
        try { controller.error(err); } catch (e) { /* allaqachon yopilgan */ }
        return;
      }
      if (!queue.length) { controller.close(); return; }

      const u8 = queue.shift();
      notify();                            // bo'sh joy bo'ldi — produce davom etsin
      controller.enqueue(u8);
    },
    cancel() {
      // Brauzer to'xtadi — Telegram'dan yana o'qimaymiz.
      dead = true;
      notify();                            // kutayotgan `pull` ni uyg'otamiz
      say('~ oqim to‘xtatildi (' + (off / 1048576).toFixed(1) + ' MB o‘qilgan)');
    }
  });

  return new Response(stream, {
    status: 200,
    headers: { ...baseHeaders, 'Content-Type': mime, 'Content-Length': String(size) }
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (!/(^|\/)tgfile(\/|$)/.test(url.pathname)) return;   // boshqa so'rovlarga tegma

  e.respondWith((async () => {
    const size = Number(url.searchParams.get('size')) || 0;

    // Konteyner turi. Sahifa buni `?mime=` orqali yuboradi (probe aniqlagan
    // haqiqiy tur). MKV/HEVC fayllar uchun `video/mp4` deb yuborish brauzerni
    // darhol rad etishga majbur qilardi — MIME haqiqiy bo'lishi SHART.
    const MIME_OK = /^(video|audio)\/[a-z0-9.+-]+$/i;
    const mimeQ = url.searchParams.get('mime') || '';
    const mime = MIME_OK.test(mimeQ) ? mimeQ : 'video/mp4';

    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    };

    if (!size) {
      return new Response('O\'lcham ko\'rsatilmagan', {
        status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const rg = parseRange(e.request.headers.get('Range'), size);

    // --- Range YO'Q bo'lsa: TO'G'RI HTTP javobi ---------------------------
    //
    // Nima uchun? RFC 9110 §15.5.7 bo'yicha `206 Partial Content` faqat
    // Range sarlavhali so'rovga BERILISHI mumkin. `<video>` ning birinchi
    // so'rovi Range siz keladi — biz esa baribek 206 + Content-Range
    // qaytardik. Bu qoidabuzarlik: brauzer "men so'ramaganman, sen nima
    // qaytarding?" deb qaror qabul qiladi va demuxlashni to'xtatadi.
    //
    // To'g'ri yechim: `200 OK` + `Content-Length: <hajm>` + ReadableStream.
    // Brauzer shunda odatiy video javobini oladi, oqimni o'zi xohlagancha
    // (backpressure) tortadi — 520 MB fayl ham xuddi shu yo'l bilan ishlaydi.
    // Seek uchun alohida Range so'rovlari keladi, ular 206 bilan xizmat qiladi.
    // Boshidan ochiq so'rov ("bytes=0-" yoki Range umuman yo'q) — PROGRESSIV
    // oqim. Shunda brauzer videoning boshini darhol oladi, qolganini esa
    // ko'rish davomida oqib keladi. Ilgari bu holatda faqat 2 MB berilib,
    // brauzer qayta-qayta so'rardi — birinchi kadr kechikardi.
    if (!rg || (rg.open && rg.start === 0)) {
      return progressiveResponse(size, mime, headers);
    }

    const start = rg.start;

    // Qancha bayt qaytaramiz?
    //
    // Asosiy g'oya: MP4 indeksi (moov) faylning OXIRIDA turadi. Agar biz
    // shu so'rovga yetarli bayt qaytarmasak, indeks kesilib qoladi va
    // brauzer uni tushunmaydi -> "format qo'llab-quvvatlanmaydi" (error 4).
    // Shuning uchun fayl CHUQURIDAN kelayotgan ochiq so'rovlarga katta javob
    // beramiz.
    //
    // Aksincha, fayl boshidagi ochiq so'rov ("bytes=0-") ga javobni
    // KICHIK qilib beramiz — aks holda foydalanuvchi birinchi kadrni
    // ko'rish uchun o'nlab soniya kutadi. Qolganini brauzer o'zi so'raydi.
    const toEnd = size - start;              // fayl oxirigacha qancha bayt bor
    let want;
    if (!rg) {
      want = Math.min(toEnd, FIRST_CHUNK);               // Range umuman yo'q
    } else if (rg.open) {
      want = start < FIRST_CHUNK
        ? Math.min(toEnd, FIRST_CHUNK)                   // boshidan — tez kuzatish
        : Math.min(toEnd, MAX_RESPONSE);                 // chuqurdan — indeks izlanmoqda
    } else {
      want = Math.min(rg.end - rg.start + 1, MAX_RESPONSE);
    }

    // Telegram'dan mavjud bo'lmagan bayt so'rash xato beradi.
    want = Math.min(want, toEnd);
    if (want <= 0) {
      return new Response(null, { status: 416, headers: {
        ...headers,
        'Content-Range': 'bytes */' + size,
      }});
    }

    let bytes;
    try {
      bytes = await readRange(start, want, size);
    } catch (err) {
      say('✗ ' + start + '+' + want + ': ' + err.message);
      return new Response('Telegram CDN dan oqib bo\'lmadi: ' + err.message, {
        status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

    // Telegram kamroq bayt qaytarsa (internet uzilib qolsa) - faqat olinganini
    // qaytaramiz, zero to'ldirilgan "soxta" baytlarni YUBORMAYMIZ.
    if (u8.length === 0) {
      return new Response(null, { status: 502, headers: {
        'Content-Type': 'text/plain; charset=utf-8' }});
    }

    STATS.requests++;
    STATS.bytes += u8.length;
    if (start > 1024 * 1024) STATS.seeks++;
    say('→ #' + STATS.requests + ' bayt ' + start + '…' + (start + u8.length - 1)
      + ' (' + (u8.length / 1048576).toFixed(2) + ' MB)'
      + (start > 1048576 ? '  ← seek' : ''));

    return new Response(u8, { status: 206, headers: {
      ...headers,
      'Content-Range': 'bytes ' + start + '-' + (start + u8.length - 1) + '/' + size,
      'Content-Length': String(u8.length),
    }});
  })());
});
