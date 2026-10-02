/*!
 * tg-play.js — brauzer ichidagi video oqimi.
 *
 * NIMA UCHUN BU MODUL BOR?
 *
 * Telegram kanallaridagi filmlar turli xil:
 *   MP4/H.264  — brauzer to'g'ridan-to'g'ri ochadi (1-bosqich).
 *   MKV/H.264  — konteyner begona, LEKIN video kodi H.264. Faqat
 *                qayta o'ramish (kodlashsiz) yetarli.
 *   MKV/HEVC  — konteyner ham, kodek ham begona. HEVC platforma
 *                dekoderiga bog'liq (Android/Safari/ko'pchilik Windows).
 *   MKV/VP9, AV1 — odatda to'g'ri chiqadi.
 *   MPEG-2, VC-1, DivX (eski .avi/.ts) — hech qanday brauzer
 *                to'g'ridan-to'g'ri ochmaydi. Qayta KODLASH kerak.
 *
 * Bu modul shu ketma-ketlikni boshqaradi:
 *
 *   1) TABEIIY      — konteyner ham, kodek ham tanilgan. Hech narsa
 *                     qilinmaydi, `<video>` to'g'ridan-to'g'ri oqadi.
 *   2) QAYTA O'RAMISH (remux) — konteynerni MP4 ga solamiz, video
 *                     kodi O'ZGARMAYDI. Hech qanday hisoblash yo'q:
 *                     tez, sifat yo'qotilmaydi. MKV/AVI/TS/MOV uchun.
 *   3) QAYTA KODLASH (transcode) — konteyner ham, kodek ham begona.
 *                     WebCodecs orqali (apparat tezligida).
 *   4) FALLBACK — hech qanday kodlash mumkin bo'lmasa, ffmpeg.wasm
 *                    (dasturiy). Sekin, lekin HECH QACHON "ochilmaydi"
 *                    degan javob qolmaydi.
 *
 * MUHIM: butun oqim BRAUZER ichida. Video baytlari Telegram CDN dan
 * to'g'ridan-to'g'ri foydalanuvchi brauzeriga oqadi. Sayt serveri
 * hech qanday video baytini ko'rmaydi.
 *
 *   CustomSource ──read()──▶ tgfile/?size=…  (service worker)
 *        │                                    │
 *        │                            Telegram MTProto
 *        ▼                                    ▼
 *   mediabunny demux/remux ──▶ fMP4 ──▶ MediaSource ──▶ <video>
 *
 * Katta fayllar uchun xotira muammosi yo'q: `fastStart: 'fragmented'`
 * fMP4 yaratadi — ma'lumot "bo'lak" bo'lib ketma-ket yoziladi. Butun
 * 800 MB fayl xotiraga sig'maydi, faqat SourceBuffer oynasi turadi.
 */

// ---------------------------------------------------------------- konstantalar
const VENDOR_MB = new URL('../vendor/mediabunny.min.js', import.meta.url).href;
const VENDOR_FF_DIR = new URL('../vendor/ffmpeg/', import.meta.url).href;

// Qancha oldinga konvertatsiya qilamiz (soniya). Katta qiymat — tez
// o'tish, kichik qiymat — kam xotira. 90 s yaxshi muvozanat.
const BUFFER_AHEAD = 90;

// Konvertatsiya oynasi (soniya). Kichik oyna boshqaruvni aniq qiladi:
// to'xtatish va "seek" tez ishlaydi.
const WINDOW = 15;

// Ikki nusxa (double) ishlatmasligimiz uchun manba keshi (cache).
const SOURCE_CACHE = 24 * 1024 * 1024;

// SourceBuffer'da saqlanayotgan ma'lumot chegarasi.
//
// NIMA UCHUN BU SHART? MSE hech narsani o'zi yo'qmaydi. 800 MB li
// film konvertatsiya qilinsa, butun fayl xotirada qoladi va film
// bir necha daqiqadan keyin TO'XTAB QOLADI (konvertatsiya chegaraga
// tegib, hech qachon bo'shamaydi). Shu sababdan biz eskirgan
// bo'laklarni `remove()` bilan o'chamiz (pump ichida).
//
// 192 MB ≈ 8 Mbit/s da taxminan 3 daqiqa. Telefon va eski
// kompyuterlarda ham sig'adi.
const MAX_BUFFER_BYTES = 192 * 1024 * 1024;

// O'ynash nuqtasi ORQASIDA qancha vaqtni saqlab qolamiz. Orqaga
// seek shu qadar tez bo'ladi.
const KEEP_BEHIND = 45;

// Kodek -> RFC 6381 codec string (qayta kodlash paytida MSE ga beriladi).
const VIDEO_CODEC_STRING = {
  avc: 'avc1.640028',
  hevc: 'hvc1.1.6.L93.B0',
  vp9: 'vp09.00.10.08',
  av1: 'av01.0.05M.08',
  vp8: null,
  prores: null
};
const AUDIO_CODEC_STRING = {
  aac: 'mp4a.40.2',
  opus: 'opus',
  mp3: 'mp4a.40.34',
  vorbis: null,
  flac: null,
  ac3: 'ac-3',
  eac3: 'ec-3',
  dts: null
};

let MB = null;
let mbPromise = null;

function loadMediabunny() {
  if (!mbPromise) {
    mbPromise = import(VENDOR_MB).then(function (m) { MB = m; return m; })
      .catch(function (e) { mbPromise = null; throw e; });
  }
  return mbPromise;
}

// ------------------------------------------------------------------- yordamchilar
function nowMs() { return (globalThis.performance && performance.now()) || Date.now(); }

export function fmtBytes(n) {
  if (!n) return '0 B';
  var u = ['B', 'KB', 'MB', 'GB'];
  var i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

export function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '--:--';
  var m = Math.floor(s / 60), x = Math.floor(s % 60);
  return (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/** MIME dan codec qismini ajratadi. */
function codecsOf(mime) {
  var m = /codecs\s*=\s*"([^"]*)"/i.exec(mime || '');
  return m ? m[1].trim() : '';
}

/**
 * MSE uchun eng mos MIME ni tanlaydi.
 *
 * Nima uchun `video/mp4` (kodeksiz) ham sinovga kiritiladi? MSE
 * spikasi bo'yicha `codecs` ixtiyoriy; ba'zi brauzerlar init segment
 * dan kodni o'zlari aniqlaydi. Bu — "aniq" deb yozilgan qaror
 * (masalan MP4 ichida Opus) sinovdan o'tmasa, ko'p hollarda ishlaydi.
 */
function pickMseMime(codecs) {
  var cands = [];
  if (codecs) cands.push('video/mp4; codecs="' + codecs + '"');
  cands.push('video/mp4');
  for (var i = 0; i < cands.length; i++) {
    try { if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(cands[i])) return cands[i]; }
    catch (e) { /* ba'zi brauzerlar isTypeSupportedsiz */ }
  }
  return cands[0];
}

/**
 * MSE bu turdagi codec satrini qabul qiladimi?
 *
 * Nima uchun alohida tekshiramiz? Konteyner "sig'ishi" bilan
 * brauzer "ko'rsata olishi" — turli narsa. Masalan DTS MP4 ga
 * yoziladi, lekin Chrome uni dekod qila olmaydi: `isTypeSupported`
 * "yo'q" deydi. Shu tekshiruvsiz fayl "muvaffaqiyatli" ochilib,
 * keyin ovozsiz yoki umuman xatosiz oʻynamay qolardi.
 */
function mseAccepts(mimeType, codecs) {
  if (!codecs) return true;            // satr yo'q — tekshirmaymiz
  if (typeof MediaSource === 'undefined') return true;
  try { return MediaSource.isTypeSupported(mimeType + '; codecs="' + codecs + '"'); }
  catch (e) { return false; }
}

/** Shart ro'y bo'lguncha kutadi (bekor qilishni hurmat qiladi). */
function waitFor(ok, timeoutMs, signal) {
  return new Promise(function (resolve, reject) {
    var t0 = nowMs();
    function onAbort() {
      try { clearInterval(timer); } catch (e) {}
      reject(abortError());
    }
    var timer = setInterval(function () {
      if (signal && signal.aborted) { onAbort(); return; }
      if (ok()) { clearInterval(timer); resolve(); return; }
      if (nowMs() - t0 > timeoutMs) { clearInterval(timer); reject(new Error('Kutish vaqti tugadi')); return; }
    }, 200);
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** Bekor qilindi (nomi `AbortError` — standart kabi). */
function abortError() {
  var e = new Error('bekor qilindi');
  e.name = 'AbortError';
  return e;
}

function isAborted(signal) { return !!(signal && signal.aborted); }

/**
 * SourceBuffer ga ketma-ket yozish.
 *
 * Nima uchun Promise zanjiri? `appendBuffer` faqat `updating === false`
 * bo'lganda ishlaydi va `updateend` kelgach bo'shadi. Navbatni
 * saqlamasak yozuvlar bir-birining ustiga tushadi.
 */
function Appender(sourceBuffer) {
  this.sb = sourceBuffer;
  this.chain = Promise.resolve();
  this.error = null;
}
Appender.prototype.push = function (chunk) {
  var self = this;
  var sb = this.sb;
  this.chain = this.chain.then(function () {
    return new Promise(function (resolve, reject) {
      if (self.error) { reject(self.error); return; }
      function cleanup() {
        sb.removeEventListener('updateend', onEnd);
        sb.removeEventListener('error', onErr);
      }
      function onEnd() { cleanup(); resolve(); }
      function onErr(e) {
        cleanup();
        var m = new Error('SourceBuffer xatosi: ' + (e && e.type ? e.type : 'noma'));
        self.error = m;
        reject(m);
      }
      sb.addEventListener('updateend', onEnd);
      sb.addEventListener('error', onErr);
      try { sb.appendBuffer(chunk); }
      catch (e) { cleanup(); reject(e); }
    });
  });
  return this.chain;
};

/**
 * Eskirgan bo'laklarni SourceBuffer dan olib tashlash.
 *
 * NIMA UCHUN BU SHART?
 *
 * MSE `appendBuffer` hech narsani o'zi yo'qmaydi. 800 MB li film
 * konvertatsiya qilinsa, butun fayl xotirada qoladi — brauzer
 * "eviction" qilsa ham kech, ko'pincha kerak bo'lganda emas, xotira
 * bosilib qolganda bo'ladi. Natijada film 1–2 daqiqadan keyin
 * TO'XTAB QOLADI: konvertatsiya oldinga yig'ilgan hajm chegarasiga
 * tegib, hech qachon bo'shamaydi.
 *
 * Yechim: o'ynash nuqtasi orqasidagi bo'laklarni `remove()` bilan
 * o'chamiz. Video oqimida bu zararli emas — `buffered` da teshik
 * paydo bo'ladi, lekin foydalanuvchi shu teshikka qaytmaydi
 * (biz `seekNeeded()` orqali qayta qaytarib yuboramiz).
 *
 * Muhim: `remove()` ham `appendBuffer` kabi navbatda turadi, shuning
 * uchun bir xil zanjirga qo'shiladi.
 */
Appender.prototype.remove = function (start, end) {
  var self = this;
  var sb = this.sb;
  this.chain = this.chain.then(function () {
    return new Promise(function (resolve, reject) {
      if (self.error) { reject(self.error); return; }
      function cleanup() {
        sb.removeEventListener('updateend', onEnd);
        sb.removeEventListener('error', onErr);
      }
      function onEnd() { cleanup(); resolve(); }
      function onErr(e) {
        cleanup();
        reject(new Error('SourceBuffer.remove xatosi: ' + (e && e.type ? e.type : 'noma')));
      }
      sb.addEventListener('updateend', onEnd);
      sb.addEventListener('error', onErr);
      try { sb.remove(start, end); }
      catch (e) { cleanup(); reject(e); }
    });
  });
  return this.chain;
};

/** SourceBuffer dagi barcha bo'laklar jami necha soniya. */
function bufferedRangeSeconds(sb) {
  var b = sb && sb.buffered;
  if (!b || !b.length) return 0;
  var sum = 0;
  for (var i = 0; i < b.length; i++) sum += b.end(i) - b.start(i);
  return sum;
}

// ============================================================ 1) TABEIIY OYNASH
/**
 * Konteyner ham, kodek ham brauzerga tanilganmi aniqlaydi.
 * @returns {boolean}
 */
export function canPlayDirectly(probe) {
  if (!probe) return false;
  var v = document.createElement('video');
  if (!v || typeof v.canPlayType !== 'function') return false;

  var container = String(probe.containerName || '').toLowerCase();
  var native = {
    mp4: 1, m4v: 1, mov: 1, qt: 1, mpeg4: 1,
    webm: 1, mkv: 0, avi: 0, mpegts: 0, ts: 0, wmv: 0, asf: 0, '3gp': 0
  };
  if (!native[container]) return false;

  var codecs = probe.videoCodecs || [];
  if (container === 'webm') {
    return v.canPlayType('video/webm; codecs="vp9"') !== ''
        || v.canPlayType('video/webm; codecs="vp8"') !== '';
  }
  if (codecs.length) {
    // Avval aniq moslik, keyin bo'sh javob.
    for (var i = 0; i < codecs.length; i++) {
      if (v.canPlayType('video/mp4; codecs="' + codecs[i] + '"') === 'probably') return true;
    }
    for (i = 0; i < codecs.length; i++) {
      if (v.canPlayType('video/mp4; codecs="' + codecs[i] + '"') !== '') return true;
    }
    return false;
  }
  return v.canPlayType('video/mp4') !== '';
}

// ============================================ 2/3) MEDIABUNNY ORQALI OQIM
/**
 * Asosiy ishchi funksiya.
 *
 * @param {Object} o
 * @param {HTMLVideoElement} o.video   `<video>` elementi
 * @param {number} o.size              fayl hajmi (bayt)
 * @param {function} o.read            (offset, length) => Promise<Uint8Array>
 * @param {function} [o.log]           (html) => void
 * @param {function} [o.progress]      (info) => void
 * @returns {Promise<Object>} { mode, label, stop, restartFrom, ... }
 */
export async function openWithMediabunny(o) {
  var video = o.video;
  var size = o.size;
  var read = o.read;
  var log = o.log || function () {};
  var progress = o.progress || function () {};

  await loadMediabunny();

  // ---------------------------------------------------------- manba (source)
  var source = new MB.CustomSource({
    getSize: function () { return size; },
    read: function (start, end) {
      if (end <= start) return new Uint8Array(0);
      // `end` chegarasiga (exclusive) — ichkarida 4096 ga tekislanadi.
      return read(start, end - start);
    },
    maxCacheSize: SOURCE_CACHE
  });

  var input = new MB.Input({ source: source, formats: MB.ALL_FORMATS });

  log('Fayl formati aniqlanmoqda…');
  if (!(await input.canRead())) throw new Error('FORMAT_UNKNOWN');

  var format = await input.getFormat();
  var vTrack = await input.getPrimaryVideoTrack();
  var aTrack = await input.getPrimaryAudioTrack();
  if (!vTrack) throw new Error('NO_VIDEO_TRACK');

  var vCodec = await vTrack.getCodec();
  var aCodec = aTrack ? await aTrack.getCodec() : null;
  var vCodecId = (await vTrack.getInternalCodecId()) || vCodec || '?';
  var width = await vTrack.getDisplayWidth();
  var height = await vTrack.getDisplayHeight();
  var duration = await input.getDurationFromMetadata();   // number | null

  // Metadata da duration yo'q bo'lsa, Telegram hujjatidan olingan
  // davomiylikni ishlatamiz. Bu `MediaSource.duration` ni to'g'ri
  // o'lramasligi uchun muhim — aks holda `<video>` "seek mumkin
  // emas" holatida qoladi va progress bar yo'q bo'ladi.
  if (!(duration && isFinite(duration) && duration > 0) &&
      o.durationHint && isFinite(o.durationHint) && o.durationHint > 0) {
    duration = o.durationHint;
  }

  // ------------------------------------------------- qaror: qaysi bosqich?
  //
  // MUHIM: "MP4 ga sig'adi" degani "brauzer ko'rsata oladi" degani
  // emas. Masalan DTS va TrueHD MP4 konteyneriga yoziladi, lekin
  // Chrome ularni dekod qila olmaydi. Shu sababli har bir yo'l
  // alohida tekshiriladi:
  //
  //   a) MP4 konteyneri bu kodekni saqlay oladimi?  (mediabunny)
  //   b) Brauzer dekodlay oladimi?                  (WebCodecs)
  //   c) MSE uni qabul qiladimi?                    (isTypeSupported)
  //
  // uchalasiga ham "ha" bo'lsa — qayta o'ramish (tez, sifat yo'qotilmaydi).
  // b) "ha", lekin a) yoki c) "yo'q" — qayta kodlash.
  // b) "yo'q" — ffmpeg.wasm.

  var mp4Format = new MB.Mp4OutputFormat({ fastStart: 'fragmented' });
  var mp4Codecs = mp4Format.getSupportedCodecs();

  // Kirish MIME sidan aniq codec satrlarini olamiz (metadata allaqachon
  // o'qilgan, hech narsani kutmaydi).
  var inMime = '';
  try { inMime = await input.getMimeType(); } catch (e) { /* yo'q bo'lishi mumkin */ }
  var inCodecs = codecsOf(inMime);

  // Yo'ldan aniq RFC 6381 satrlari. "avc1.4d401f", "mp4a.40.2" kabi.
  // Bular `input.getMimeType()` ga qaror aniqroq (kichik-kichik
  // o'xshash yozuvlar bor: "dtsc", "dtsh", "dtse").
  var vStr = '', aStr = '';
  try { vStr = (await vTrack.getCodecParameterString()) || ''; } catch (e) { /* yo'q */ }
  if (aTrack) { try { aStr = (await aTrack.getCodecParameterString()) || ''; } catch (e) { /* yo'q */ } }

  // (a) konteyner sig'ishi
  var fitsVideo = !!vCodec && mp4Codecs.indexOf(vCodec) >= 0;
  var fitsAudio = !aTrack || !aCodec || mp4Codecs.indexOf(aCodec) >= 0;

  // (b) brauzer dekodlash qobiliyati
  //
  // Video uchun `canDecodeVideo` yetarli. Audio uchun shunday
  // funksiya yo'q, shuning uchun konfiguratsiyani olib, bevosita
  // `AudioDecoder.isConfigSupported()` ga so'raymiz.
  var vDecodable = false;
  if (vCodec) {
    try {
      vDecodable = await MB.canDecodeVideo(vCodec, { width: width || 1280, height: height || 720 });
    } catch (e) { vDecodable = false; }
  }
  var aDecodable = false;
  if (aTrack && aCodec) {
    try {
      var aCfg = await aTrack.getDecoderConfig();
      if (aCfg) {
        if (typeof AudioDecoder !== 'undefined') {
          var sup = await AudioDecoder.isConfigSupported(aCfg);
          aDecodable = !!(sup && sup.supported);
        } else {
          aDecodable = true;   // WebCodecs yo'q — umid qilamiz
        }
      }
    } catch (e) { aDecodable = false; }
  }

  // (c) MSE qabuli
  var copyVideo = fitsVideo && (mseAccepts('video/mp4', vStr) || !vStr);
  var copyAudio = fitsAudio && (!aTrack || !aStr || mseAccepts('audio/mp4', aStr));

  var mode, vOpts = null, aOpts = null, outVideoStr = '', outAudioStr = '';

  if (copyVideo && copyAudio) {
    // ---- 2) FAQAT QAYTA O'RAMISH. Kodlash yo'q — faqat konteyner.
    mode = 'remux';
    outVideoStr = vStr;
    outAudioStr = aStr;
  } else if (vDecodable) {
    // ---- 3) QAYTA KODLASH. Brauzer o'qiy oladi, MP4/MSE uchun moslashtiramiz.
    mode = 'transcode';
    if (copyVideo) {
      vOpts = { codec: vCodec };
      outVideoStr = vStr;
    } else {
      var enc = await MB.getEncodableVideoCodecs(['avc', 'vp9', 'av1', 'hevc'], {
        width: width || 1280, height: height || 720
      });
      if (!enc || !enc.length) throw new Error('CANNOT_ENCODE:' + vCodecId);
      vOpts = { codec: enc[0], quality: MB.QUALITY_MEDIUM, keyFrameInterval: 4 };
      outVideoStr = VIDEO_CODEC_STRING[enc[0]] || outVideoStr;
    }
    if (!copyAudio && aTrack) {
      if (aDecodable) {
        var encA = await MB.getEncodableAudioCodecs(['aac', 'opus'], {
          numberOfChannels: 2, sampleRate: 48000
        });
        if (encA && encA.length) {
          aOpts = { codec: encA[0] };
          outAudioStr = AUDIO_CODEC_STRING[encA[0]] || outAudioStr;
        } else {
          aOpts = { discard: true };
          outAudioStr = '';
        }
      } else {
        // Hali ham dekod qilinmaydi — jimgina chiqaramiz. Film ko'rinadi,
        // ovozi bo'lmaydi. Butun faylni rad qilgandan yaxshiroq.
        aOpts = { discard: true };
        outAudioStr = '';
      }
    } else {
      outAudioStr = aStr;
    }
  } else {
    // ---- 4) Brauzer umuman o'qiy olmaydi.
    throw new Error('UNSUPPORTED_CODEC:' + vCodecId);
  }

  if (!outVideoStr) outVideoStr = vStr;
  var outCodecs = [outVideoStr, outAudioStr].filter(Boolean).join(', ');
  // Zaxira: agar hech narsa topilmasa, kirish satrlarini ishlatamiz.
  if (!outCodecs) outCodecs = inCodecs;

  var mime = pickMseMime(outCodecs);
  var label = (mode === 'remux' ? 'Qayta oʻramildi' : 'Qayta kodlandı')
    + ' · ' + vCodecId
    + (mode === 'remux' ? '' : ' → ' + (vOpts && vOpts.codec || vCodec));

  // ---------------------------------------------------------------- holat
  var state = {
    stopped: false,
    mediaSource: null, sourceBuffer: null, appender: null,
    conversion: null, output: null, input: input, source: source,
    objectUrl: null,
    convertedUpTo: 0,
    startedAt: 0,
    seekLock: null,     // qayta qurish paytida `seeking` ni bostirish
    seekLockAt: 0,
    mode: mode
  };

  var written = 0;

  // Bekor qilish signali (ixtiyoriy). Sahifa uni `stop()` chaqirilganda
  // otadi — shunda konvertatsiya darhol to'xtaydi.
  var signal = o.signal || null;
  if (isAborted(signal)) throw abortError();

  // Chegara va oyna sozlamalari. Standart qiymatlar ishlash uchun
  // yetarli; imkon bo'lsa o'zgartiriladi (sinov, kichik ekran yoki
  // sekin Telegram kanali uchun).
  var maxBuf = numOr(o.maxBufferBytes, MAX_BUFFER_BYTES);
  var keepBehind = numOr(o.keepBehind, KEEP_BEHIND);
  var bufAhead = numOr(o.bufferAhead, BUFFER_AHEAD);

  function numOr(v, d) {
    return (typeof v === 'number' && isFinite(v) && v > 0) ? v : d;
  }

  // ---------------------------------------------------- qayta qurish (build)
  //
  // `fromInputTime` — kirish faylidagi boshlanish sekundi. 0 dan
  // boshlanadi; orqaga "seek"da qayta chaqiriladi.
  async function build(fromInputTime) {
    var ms = new MediaSource();
    var url = URL.createObjectURL(ms);
    video.src = url;
    state.mediaSource = ms;
    state.objectUrl = url;
    state.appender = null;
    state.sourceBuffer = null;
    state.conversion = null;
    state.convertedUpTo = fromInputTime;

    await new Promise(function (resolve, reject) {
      var to = setTimeout(function () { reject(new Error('MediaSource ochilmadi')); }, 25000);
      ms.addEventListener('sourceopen', function () { clearTimeout(to); resolve(); }, { once: true });
    });

    if (typeof MediaSource.isTypeSupported === 'function'
        && !MediaSource.isTypeSupported(mime)) {
      throw new Error('Bu formatni brauzer koʻrsata olmaydi');
    }

    // Davomiylikni aytib beramiz. Aks holda fMP4 oqimida
    // `video.duration` = Infinity bo'lib, progress bar va seek
    // umuman ishlamaydi. `duration` ni shu yerda qo'yish `video`
    // ga "bu fayl shuncha davom etadi" signalini beradi va
    // brauzer `seekable` ni to'g'ri hisoblaydi.
    if (duration && isFinite(duration) && duration > 0) {
      try { ms.duration = duration; } catch (e) { /* allaqachon belgilangan */ }
    }

    var sb = ms.addSourceBuffer(mime);
    sb.mode = 'segments';
    state.sourceBuffer = sb;
    state.appender = new Appender(sb);

    // `AppendOnlyStreamTarget` — faqat ketma-ket yozish (qaytib
    // yozish yo'q). MSE ham shunday talab qiladi: avval init segment
    // (ftyp+moov), keyin moof+mdat bo'laklari.
    var appender = state.appender;
    var writable = new WritableStream({
      write: function (chunk) {
        written += chunk.byteLength;
        return appender.push(chunk);
      },
      abort: function (reason) { appender.error = reason; }
    });

    // Yo'llarni `Conversion.init()` o'zi bog'laydi. Qo'lda
    // `addVideoTrack(track)` chaqirish "source must be a VideoSource"
    // xatosini beradi (InputTrack — VideoSource emas, undan paket
    // oqimi yaratiladi).
    var output = new MB.Output({
      format: new MB.Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1 }),
      target: new MB.AppendOnlyStreamTarget(writable)
    });
    state.output = output;

    var cOpts = {
      input: input,
      output: output,
      tracks: 'primary',
      onProgress: function (p) {
        if (state.stopped) return;
        var span = Math.max(1, (duration || 0) - fromInputTime);
        var t = fromInputTime + p * span;
        if (t > state.convertedUpTo) state.convertedUpTo = t;
        progress({
          phase: mode, ratio: p, bytes: written,
          mediaTime: video.currentTime,
          duration: video.duration || duration || 0
        });
      }
    };
    if (vOpts) cOpts.video = vOpts;
    if (aOpts) cOpts.audio = aOpts;
    if (fromInputTime > 0) cOpts.trim = { start: fromInputTime };

    var conv = await MB.Conversion.init(cOpts);
    if (!conv.isValid) {
      var why = (conv.discardedTracks || []).join('; ');
      throw new Error('Konvertatsiya mumkin emas: ' + (why || 'noma sabab'));
    }
    state.conversion = conv;
    state.startedAt = fromInputTime;
    return conv;
  }

  // ------------------------------------------------- oynalar bo'yicha yuritish
  //
  // Nima uchun oyna? `execute()` ni bir marta chaqirsak, u fayl
  // oxirigacha bitta uzluksiz ishlaydi va to'xtatib bo'lmaydi. Oyna
  // bilan (a) oldinga yig'ilgan hajmni boshqaramiz, (b) seek da tez
  // to'xtatamiz, (c) xatoni tuzatishga imkon beramiz.
  async function pump(fromInputTime) {
    var conv = await build(fromInputTime);
    var t = fromInputTime;
    var dur = (duration && isFinite(duration)) ? duration : Infinity;

    while (!state.stopped) {
      // Modal yopilgan yoki boshqa film ochilgan bo'lsa — darhol to'xta.
      if (isAborted(signal)) { stop(); throw abortError(); }

      var target = (dur === Infinity) ? t + WINDOW : Math.min(t + WINDOW, dur);
      await conv.execute({ until: target });
      t = target;
      if (t > state.convertedUpTo) state.convertedUpTo = t;
      if (dur !== Infinity && t >= dur) return;

      // TARTIB MUHIM: AVVAL xotirani bo'shatamiz, KEYIN o'ynashni kutamiz.
      //
      // Aks holda o'zaro kutish (deadlock) bo'ladi: `waitForAhead` xotira
      // chegarasiga yetganda to'xtaydi, o'ynash esa yangi ma'lumot kutadi —
      // ikkalasi ham o'zidan chiqmaydi, film DOIMIY to'xtaydi.
      // Tozalash esa o'ynash nuqtasi orqasidagilarni o'chadi, ya'ni
      // hech qanday ma'lumotni yo'qotmaydi.
      await trim();
      await waitForAhead(signal);
    }
  }

  /** Konvertatsiya o'ynashdan oldinga yugurib ketmasligi uchun kutadi. */
  async function waitForAhead(sig) {
    var guard = 0;
    // Chegara: 240 soniya. Bu himoya uchun — agar shunga ham yetmasa,
    // konvertatsiyani to'xtamay qo'yamiz (film to'xtamaydi).
    while (!state.stopped && guard++ < 600 && bufferedAhead(video) > bufAhead) {
      if (isAborted(sig)) { stop(); throw abortError(); }
      await sleep(400);
    }
  }

  /**
   * SourceBuffer da hozir necha bayt turganini taxmin qiladi.
   *
   * Aniq o'lchov (framerate/borite) MSE da yo'q, shuning uchun
   * o'rtacha tezlikni (`written` / konvertatsiya qilingan soniya)
   * ko'rsatilgan bo'laklar soniyasiga ko'paytiramiz. Tartib va
   * chegaralar uchun yetarli.
   */
  function bufferedBytes() {
    var sb = state.sourceBuffer;
    if (!sb) return 0;
    var secs = bufferedRangeSeconds(sb);
    var converted = Math.max(1, state.convertedUpTo - state.startedAt);
    var bitrate = written / converted;           // bayt/soniya
    return secs * bitrate;
  }

  /**
   * O'ynash nuqtasi orqasidagi bo'laklarni o'chadi.
   *
   * Bu SHART funksiya, chунki aks holda katta film xotirani to'ldirib
   * to'xtab qoladi (batafsil tushuntirish `Appender.prototype.remove`
   * yonidagi izohda).
   */
  async function trim() {
    var sb = state.sourceBuffer;
    if (!sb || !state.appender) return;
    if (bufferedBytes() <= maxBuf) return;

    var cutTo = (video.currentTime || 0) - keepBehind;
    if (cutTo <= 0) return;

    // O'ynash nuqtasi ORQASIDAGI hammasini o'chamiz.
    //
    // Nima uchun `end` ni `cutTo` bilan chegaralaymiz va bo'lakning
    // oxirigacha yubirmaymiz? Chunki MSE `remove(start, end)` chegarani
    // BO'LAK ICHIDA qo'yilsa, qoldiq bo'lakni avtomatik saqlab qoladi.
    // Ya'ni `remove(0, 32)` — [0, 59] bo'lagining faqat 0–32 qismi
    // o'chadi, 32–59 o'ynish uchun butunligicha qoladi. Hech qanday
    // "bo'lak ichiga tegib ketish" xavfi yo'q.
    //
    // Muhim shart: `cutTo` har doim joriy o'ynash nuqtasidan KECH
    // (`keepBehind` > 0), demak biz o'ynayotgan ma'lumotni hech qachon
    // o'chirmaymiz.
    var b = sb.buffered;
    if (!b || !b.length) return;
    var from = b.start(0);
    var to = Math.min(cutTo, b.end(0));
    if (to - from < 0.5) return;              // o'chiradigan narsa yo'q

    try {
      await state.appender.remove(from, to);
    } catch (e) {
      // `remove` muvaffaqiyatsiz bo'lsa ham oqim davom etsin — bu
      // qulaylik masalasi, to'xtatishga sabab emas.
    }
  }

  // ------------------------------------------------------------------- to'xtatish
  function stop() {
    if (state.stopped) return;
    state.stopped = true;
    if (state.conversion) { try { state.conversion.cancel(); } catch (e) { /* tugagan */ } }
    try {
      if (state.mediaSource && state.mediaSource.readyState === 'open') state.mediaSource.endOfStream();
    } catch (e) { /* yopilgan */ }
    if (state.objectUrl) { try { URL.revokeObjectURL(state.objectUrl); } catch (e) {} }
    state.objectUrl = null;
  }

  // ------------------------------------------------------- orqaga qayta o'tish
  //
  // SourceBuffer allaqachon tozalandi (xotira uchun o'chgan) yoki
  // boshlanmagan bo'lsa, shu vaqtdan QAYTA quramiz.
  //
  // Nima uchun bu qiyin? `video.src` ga yangi MediaSource manzilini
  // belgilash brauzerni ikki narsani to'xtatishga majbur qiladi:
  //
  //   1) `currentTime` avtomatik NOLGA qaytadi;
  //   2) video PAUSED holatga o'tadi.
  //
  // Shu sababli quyida uchta narsa aniq qilinadi: konvertatsiya
  // kerakli vaqtdan boshlanadi, keyin `currentTime` qayta oʻrnatiladi,
  // va oʻynash davom ettiriladi. Bularni qisqa tushirib qoldirsa,
  // foydalanuvchi "orqaga bosdim — film 0 da toʻxtadi" deb koʻradi.
  var restarting = null;
  async function restartFrom(seconds) {
    if (state.stopped || isAborted(signal)) return;
    if (restarting) return restarting;

    restarting = (async function () {
      log('Qayta tayyorlanmoqda…');
      var start = Math.max(0, seconds);

      // O'ynash holatini eslab qolamiz — keyinchalik tiklash uchun.
      var wasPlaying = !video.paused;

      // Eski oqimni to'xtatamiz va video elementini vaqtincha
      // TO'XTATAMIZ. Aks holda eski manzil bo'shayotgan paytda
      // element o'z-o'zidan oldingi joyga (masalan 152-soniyaga)
      // "qaytib" ketishi mumkin — keyin bizning `currentTime` yozuvimiz
      // shuni ustidan yozib ketadi va natija tasodifiy bo'ladi.
      try { video.pause(); } catch (e) {}

      if (state.conversion) { try { await state.conversion.cancel(); } catch (e) {} }
      state.conversion = null;
      try {
        if (state.mediaSource && state.mediaSource.readyState === 'open') state.mediaSource.endOfStream();
      } catch (e) { /* allaqachon yopilgan */ }
      if (state.objectUrl) { try { URL.revokeObjectURL(state.objectUrl); } catch (e) {} }
      state.objectUrl = null;
      state.mediaSource = null;
      state.sourceBuffer = null;
      state.appender = null;
      state.convertedUpTo = start;
      state.stopped = false;
      written = 0;

      // Bu qiymat `onSeeking` ni vaqtincha o'chirib qo'yadi: qayta
      // o'rnatilgan `currentTime` o'zi ham `seeking` hodisasi tug'diradi
      // va biz o'sha hodisaga javoban yana qayta qurishni boshlashimiz
      // mumkin (chekilmaslik — tugallanmaydigan sikl).
      state.seekLock = start;
      state.seekLockAt = nowMs();

      run = pump(start);

      // YANGI manzil ochilishi va unga ma'lumot yozilishini kutamiz.
      // Konvertatsiya `start` dan boshlanadi, shuning uchun video
      // vaqti 0 dan qayta hisoblanadi — demak biz `currentTime` ni
      // albatta `start` ga qayta o'rnatishimiz kerak.
      await waitFor(function () {
        return state.sourceBuffer && bufferedRangeSeconds(state.sourceBuffer) > 0.3;
      }, 45000, signal);

      // Joylashuvni o'rnatamiz va HAQIQATGA tasdiqlaymiz.
      var ok = await seekTo(start, true);
      if (!ok) {
        log('Kechikib ketdi: ' + fmtTime(video.currentTime) +
            ' (natija ' + fmtTime(start) + ' emas)');
      }

      if (wasPlaying) {
        try { var p = video.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
      }
    })();
    try { await restarting; } finally { restarting = null; }
  }

  /**
   * `currentTime` ni oʻrnatadi va, `verify` berilgan boʻlsa, haqiqatga
   * mos kelishini tekshiradi.
   *
   * NIMA UCHUN TEKSHIRISH SHART?
   *
   * Yangi `MediaSource` ulangan zahoti brauzer bir necha narsani
   * "qayta tiklashi" mumkin: `currentTime` ni nolga tushirishi,
   * toʻxtatilgan oʻynashni davom ettirishi yoki — eng chalkash
   * holat — eski pozitsiyani (masalan 152-soniyani) qayta
   * oʻrnatishi. Biz bir marta yozsak, baʼzan u yozuvimizni
   * bekor qiladi. Shu sababdan bir necha marta qayta yozamiz va
   * har safar "haqiqat shu ekanmi?" degan savolga javob olamiz.
   *
   * @returns {Promise<boolean>} `true` — kerakli joyga tushdi
   */
  async function seekTo(t, verify) {
    if (!isFinite(t) || t < 0) return false;

    // 1) Metadata paydo bo'lguncha kutamiz. Undan oldin
    //    `currentTime` yozuvi brauzer tomonidan rad etiladi.
    try {
      await waitFor(function () { return video.readyState >= 1; }, 20000, signal);
    } catch (e) { return false; }

    var tries = verify ? 14 : 1;
    for (var i = 0; i < tries; i++) {
      if (state.stopped || isAborted(signal)) return false;
      try { video.currentTime = t; } catch (e) { /* keyingi urinish */ }
      if (!verify) return true;

      await sleep(160);
      // Brauzer qarzini to'lagan bo'lsa — muvaffaqiyat.
      if (Math.abs(video.currentTime - t) < 1.5) return true;
    }
    return Math.abs(video.currentTime - t) < 2;
  }

  /** Seek bo'lganda chaqiriladi: kerak bo'lsa qayta quradi. */
  function onSeeking() {
    if (state.stopped || mode !== 'remux' && mode !== 'transcode') return;
    var t = video.currentTime;
    var sb = state.sourceBuffer;
    if (!sb || !sb.buffered || !sb.buffered.length) return;

    // Qayta qurish o'zi `currentTime` ni o'zgartiradi va bu o'ziga
    // `seeking` hodisasi tug'diradi. Agar javob bermasak, sikl
    // tugallanmay qoladi (qayta qurish → seeking → qayta qurish → …).
    //
    // Vaqt bilan cheklangan: 4 sekunddan keyin o'z-o'zidan kuchsizlanadi,
    // chunki o'sha vaqt ichida haqiqiy foydalanuvchi seek'i kelishi
    // mumkin — uni biz o'zimizning deb adashmaslik.
    if (state.seekLock != null && nowMs() - state.seekLockAt < 4000
        && Math.abs(t - state.seekLock) < 2) return;

    // Keshda bormi? (bo'lsa — hech narsa qilish shart emas)
    for (var i = 0; i < sb.buffered.length; i++) {
      if (t >= sb.buffered.start(i) - 0.5 && t <= sb.buffered.end(i)) return;
    }

    // Keshda YO'Q. Endi ikki holat bor:
    //
    //  a) Konvertatsiya hali shu vaqtga yetib KELMAGAN — kelishini
    //     kutamiz, `pump` o'zi yetkazadi. (Kelajak)
    //  b) Konvertatsiya bu vaqtni O'TKAZIB YUBORGAN, lekin ma'lumot
    //     keyin tozalangan (xotira uchun o'chilgan) yoki umuman
    //     boshlanmagan. Kutish foyda bermaydi — qaytadan qurish kerak.
    //
    // (b) ni aniqlash SHART: aks holda `trim()` dan keyin foydalanuvchi
    // orqaga seek qilsa, film DOIMIY to'xtab qolardi.
    if (t > state.convertedUpTo + 1) return;      // kelajak — pump yetkazadi

    restartFrom(t).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      log('Qayta tayyorlashda xato: ' + e.message);
    });
  }

  var run = null;

  var api = {
    mode: mode,
    label: label,
    mime: mime,
    get convertedUpTo() { return state.convertedUpTo; },
    get written() { return written; },
    restartFrom: restartFrom,
    stop: stop,
    seekNeeded: onSeeking,
    done: Promise.resolve()
  };

  // ---------------------------------------------------------- ishga tushirish
  var started = nowMs();
  try {
    run = pump(0);
    api.done = run;
    await waitFor(function () {
      return state.sourceBuffer && bufferedAhead(video) > 0.5;
    }, 45000, signal);
    if (state.stopped || isAborted(signal)) throw abortError();
    if (!state.sourceBuffer) throw new Error('Konvertatsiya boshlanmadi');

    // Foydalanuvchi bu filmlarni ilgari ko'rib tugatgan bo'lsa —
    // o'sha joydan davom ettiramiz (`startAt`).
    if (o.startAt && o.startAt > 1) {
      await seekTo(o.startAt, true);
      state.seekLock = o.startAt;
      state.seekLockAt = nowMs();
    }

    api.elapsed = nowMs() - started;
    api.label = label + ' · tayyor';
    return api;
  } catch (e) {
    stop();
    throw e;
  }
}

// ------------------------------------------------------------------- yordam
/** `<video>` da jami necha soniya oldinga yig'ilgan (minus = orqada). */
export function bufferedAhead(video) {
  try {
    var b = video.buffered;
    var t = video.currentTime || 0;
    for (var i = 0; i < b.length; i++) {
      if (t >= b.start(i) - 0.5 && t <= b.end(i)) return b.end(i) - t;
    }
    var best = Infinity;
    for (i = 0; i < b.length; i++) {
      var d = b.start(i) - t;
      if (d > -1 && d < best) best = d;
    }
    return best === Infinity ? 0 : -best;
  } catch (e) { return 0; }
}

// ============================================================== 4) FALLBACK
/**
 * Hech qanday brauzer dekoderi ishlamasa — ffmpeg.wasm.
 *
 * DASTURIY dekoder: sekin (1 daqiqalik film bir necha daqiqa), lekin
 * shartnomasi yo'q. Faqat kerak bo'lganda yuklanadi (~31 MB), shuning
 * uchun ko'pchilik foydalanuvchilar uni hech qachon yuklamaydi.
 *
 * Cheklovni oldindan aytib qo'yamiz: butun fayl xotiraga sig'ishi
 * kerak, shuning uchun juda katta fayllarda bu yo'l ishlashi
 * ehtimoli past. Shunda ham xato matni to'g'ri bo'ladi.
 */
export async function openWithFfmpeg(o) {
  var video = o.video;
  var size = o.size;
  var read = o.read;
  var log = o.log || function () {};
  var progress = o.progress || function () {};
  var signal = o.signal || null;
  if (isAborted(signal)) throw abortError();

  // 1) FFmpeg yuklash (skript tag orqali — `document.currentScript`
  //    orqali worker manzilini o'zi topishi uchun).
  if (!globalThis.FFmpegWASM) {
    log('Kutubxona yuklanmoqda (31 MB)…');
    await injectScript(VENDOR_FF_DIR + 'ffmpeg.js');
  }
  var FF = globalThis.FFmpegWASM && globalThis.FFmpegWASM.FFmpeg;
  if (!FF) throw new Error('FFmpeg yuklanmadi');

  var ff = new FF();
  log('Dekoder tayyorlanmoqda…');
  await ff.load({
    coreURL: VENDOR_FF_DIR + 'ffmpeg-core.js',
    wasmURL: VENDOR_FF_DIR + 'ffmpeg-core.wasm'
  });

  var stopped = false;
  function stop() {
    stopped = true;
    try { ff.terminate(); } catch (e) { /* allaqachon to'xtagan */ }
  }
  if (signal) {
    signal.addEventListener('abort', function () { stop(); }, { once: true });
  }

  // 2) Butun faylni xotiraga olish
  log('Fayl Telegram dan olinmoqda (0%)…');
  var CH = 4 * 1024 * 1024;
  var parts = [];
  var got = 0;
  while (got < size && !stopped) {
    if (isAborted(signal)) { stop(); throw abortError(); }
    var n = Math.min(CH, size - got);
    parts.push(await read(got, n));
    got += n;
    log('Fayl Telegram dan olinmoqda (' + Math.round(got / size * 100) + '%)…');
  }
  if (stopped || isAborted(signal)) throw abortError();

  var whole = new Uint8Array(got);
  var off = 0;
  for (var i = 0; i < parts.length; i++) { whole.set(parts[i], off); off += parts[i].length; }

  var ext = /\.(\w+)$/.exec((o.filename || '').toLowerCase());
  var name = 'in.' + (ext ? ext[1] : 'mkv');
  await ff.writeFile(name, whole);
  log('Kodlanmoqda (0%) — bu sekin, sabr qiling…');

  var t0 = nowMs();
  ff.on('progress', function (ev) {
    if (ev && typeof ev.progress === 'number') {
      progress({ phase: 'transcode-ffmpeg', ratio: ev.progress, bytes: got, mediaTime: 0, duration: 0 });
    }
  });

  await ff.exec(['-i', name, '-c:v', 'libx264', '-preset', 'ultrafast',
                 '-crf', '28', '-c:a', 'aac', '-b:a', '128k',
                 '-movflags', '+faststart', 'out.mp4']);
  if (stopped || isAborted(signal)) throw abortError();

  var data = await ff.readFile('out.mp4');
  log('Tayyor. Bekat qilib qoʻyilmoqda…');
  var blob = new Blob([data], { type: 'video/mp4' });
  var url = URL.createObjectURL(blob);
  video.src = url;
  try { ff.terminate(); } catch (e) { /* xato emas */ }

  return {
    mode: 'ffmpeg',
    label: 'Qayta kodlandı · ffmpeg · ' + fmtTime((nowMs() - t0) / 1000) + ' sarflandi',
    mime: 'video/mp4',
    convertedUpTo: Infinity,
    get written() { return got; },
    restartFrom: function () { return Promise.resolve(); },
    seekNeeded: function () {},
    stop: function () { try { URL.revokeObjectURL(url); } catch (e) {} },
    done: Promise.resolve()
  };
}

/** <script> ni yuklaydi (jsdom/Worker'da ham ishlashi uch innerHTML yo'q). */
function injectScript(src) {
  return new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = function () { resolve(); };
    s.onerror = function () { reject(new Error('Yuklab boʻlmadi: ' + src)); };
    (document.head || document.documentElement).appendChild(s);
  });
}