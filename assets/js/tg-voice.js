/* ==========================================================================
 * tg-voice.js - Telegram uslubidagi ovozli xabar (voice message)
 * --------------------------------------------------------------------------
 * Chat va reels izohlari uchun UMUMIY modul:
 *   - mikrofon orqali yozish (MediaRecorder);
 *   - "yozilmoqda" holati: qizil nuqta + timer + to'xtatish/bekor qilish;
 *   - Telegram'ga yuborish uchun `InputMediaUploadedDocument`
 *     (`DocumentAttributeAudio { voice: true }`).
 *
 * Brauzer `MediaRecorder` faqat ogg/webm/mp4 chiqaradi; Telegram bularni
 * qabul qiladi (voice atributi orqali "ovozli xabar" ko'rinishida saqlanadi),
 * shuning uchun qo'shimcha konvertatsiya kerak emas.
 * ========================================================================== */
(function (global) {
  'use strict';

  // Brauzerlar qo'llaydigan formatlar (afzal tartibda).
  var MIMES = [
    'audio/ogg;codecs=opus',
    'audio/webm;codecs=opus',
    'audio/ogg',
    'audio/webm',
    'audio/mp4'
  ];

  function pickMime() {
    if (typeof global.MediaRecorder === 'undefined') return '';
    for (var i = 0; i < MIMES.length; i++) {
      try { if (global.MediaRecorder.isTypeSupported(MIMES[i])) return MIMES[i]; } catch (e) {}
    }
    return '';
  }

  /** codecs=... qismini olib tashlaymiz - Telegram `mime_type` sodda kutadi. */
  function baseMime(m) {
    return String(m || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
  }

  function isSupported() {
    return !!(global.navigator && global.navigator.mediaDevices
      && global.navigator.mediaDevices.getUserMedia && global.MediaRecorder);
  }

  function permissionMsg(e) {
    var n = (e && (e.name || e.errorMessage || e.message)) || '';
    n = String(n).toUpperCase();
    if (n.indexOf('NOTALLOWED') >= 0 || n.indexOf('PERMISSION') >= 0) {
      return 'Mikrofonga ruxsat berilmadi (brauzer sozlamasidan yoqishingiz mumkin)';
    }
    if (n.indexOf('NOTFOUND') >= 0 || n.indexOf('DEVICE') >= 0) {
      return 'Mikrofon topilmadi';
    }
    return 'Yozib bo‘lmadi';
  }

  /** Soniyani "0:07" ko'rinishiga keltiradi. */
  function mmss(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = (m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return h ? (h + ':' + mm + ':' + ss) : (m + ':' + ss);
  }

  /** Tekis (flat) to'lqin - audioni ochib bo'lmaganda ishlatiladi. */
  function flatWave(n) {
    var a = new Uint8Array(n);
    for (var i = 0; i < n; i++) a[i] = 70;
    return a;
  }

  /**
   * Yozilgan audiodan 64 ta "ustun" (0..255) - Telegram shuni
   * `DocumentAttributeAudio.waveform` sifatida saqlaydi.
   */
  function computeWaveform(blob, samples) {
    samples = samples || 64;
    return new Promise(function (resolve) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC || !blob || !blob.arrayBuffer) return resolve(flatWave(samples));
      var ctx = null;
      try { ctx = new AC(); } catch (e) { return resolve(flatWave(samples)); }
      var giveUp = function () {
        try { if (ctx && ctx.close) ctx.close(); } catch (x) {}
        resolve(flatWave(samples));
      };
      var p;
      try { p = ctx.decodeAudioData(blob.arrayBuffer(), onOk, giveUp); }
      catch (e) { return giveUp(); }
      if (p && p.then) p.then(onOk, giveUp);

      function onOk(buf) {
        try {
          var ch = buf.getChannelData(0);
          var step = Math.max(1, Math.floor(ch.length / samples));
          var out = new Uint8Array(samples);
          for (var i = 0; i < samples; i++) {
            var s = i * step, mx = 0;
            for (var j = 0; j < step && (s + j) < ch.length; j++) {
              var a = Math.abs(ch[s + j]);
              if (a > mx) mx = a;
            }
            out[i] = Math.max(2, Math.min(255, Math.round(mx * 255)));
          }
          try { ctx.close(); } catch (x) {}
          resolve(out);
        } catch (e) { giveUp(); }
      }
    });
  }

  /** "To'lqin" uchun HTML (ikkita qatlam: asos + progress). */
  function waveHtml(wave) {
    var n = 32, out = '', i, v, pct;
    for (i = 0; i < n; i++) {
      if (wave && wave.length) {
        v = Number(wave[Math.floor(i * wave.length / n)]) || 0;
        pct = Math.max(14, Math.min(100, Math.round(v / 255 * 100)));
      } else {
        // To'lqin ma'lum bo'lmasa - tabiiy o'zgaruvchi naqsh.
        pct = 26 + ((i * 53) % 74);
      }
      out += '<i style="height:' + pct + '%"></i>';
    }
    return out;
  }

  function playIco() {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">'
      + '<path d="M8.6 5.1v13.8c0 .8.9 1.3 1.6.8l9.7-6.9a1 1 0 0 0 0-1.6L10.2 4.3c-.7-.5-1.6 0-1.6.8z"/></svg>';
  }

  /**
   * Ovozli xabar uchun "bubblik": o'ynatish tugmasi, to'lqin, davomiylik.
   * `TgVoice.wireVoice(box, d)` bilan bog'lanadi.
   */
  function voiceHtml(d) {
    var dur = (d && d.duration) || 0;
    var bars = waveHtml(d && d.wave);
    return '<div class="reels-c-media tv-voice" data-kind="voice" style="--p:0">'
      + '<button type="button" class="tv-play" aria-label="Eshitish">' + playIco()
      + '<span class="tv-play-load" hidden></span></button>'
      + '<span class="tv-wave"><i class="tv-wave-b">' + bars + '</i>'
      + '<i class="tv-wave-p">' + bars + '</i></span>'
      + '<span class="tv-dur" data-dur="' + dur + '">' + mmss(dur) + '</span>'
      + '<audio preload="none"></audio>'
      + '<span class="reels-c-media-fail" hidden>Ko‘rsatib bo‘lmadi</span>'
      + '</div>';
  }

  /** Yuklash + o'ynatishni boshqaradi. `downloadInto(node, d, true)` ishlatadi. */
  function wireVoice(box, d, downloadInto) {
    if (!box || !d) return;
    if (box.getAttribute('data-wired')) return;
    box.setAttribute('data-wired', '1');
    var audio = box.querySelector('audio');
    var btn = box.querySelector('.tv-play');
    var load = box.querySelector('.tv-play-load');
    var durEl = box.querySelector('.tv-dur');
    if (!audio || !btn) return;

    // To'lqin balandligi kerak bo'lmasa - atributdan to'ldiramiz.
    if (!d.duration) {
      var a0 = 0;
      (d.media && d.media.attributes || []).forEach(function (a) {
        if (a && a.className === 'DocumentAttributeAudio' && a.duration) a0 = Number(a.duration) || 0;
      });
      if (a0 && durEl) { d.duration = a0; durEl.textContent = mmss(a0); }
    }

    function state(name) {
      box.setAttribute('data-play', name);
      if (load) load.hidden = (name !== 'load');
      // Har doim enabled qaytaramiz - aks holda tugma birinchi yuklashda
      // `disabled` bo'lib qolib, xabarni qayta eshitib bo'lmas edi
      // (faqat sahifa yangilanganda qayta ishlardigan bo'lib qolardi).
      if (btn) btn.disabled = (name === 'load');
    }

    function fail(msg) {
      state('fail');
      var ph = box.querySelector('.reels-c-media-fail');
      if (ph) { ph.hidden = false; ph.textContent = 'Eshitib bo‘lmadi: ' + msg; }
      btn.disabled = false;
    }

    btn.addEventListener('click', function () {
      if (!audio.paused && audio.src) { audio.pause(); return; }
      if (!audio.src) {
        btn.disabled = true;
        state('load');
        if (downloadInto) downloadInto(audio, d, true);
        // Yuklash tugagach o'ynatamiz.
        var guard = 0;
        var iv = setInterval(function () {
          if (audio.src || ++guard > 60) {
            clearInterval(iv);
            if (!audio.src) fail('yuklanmadi'); else state('play');
          }
        }, 250);
        audio.addEventListener('loadedmetadata', function () {
          clearInterval(iv);
          state('play');
          if (audio.duration && isFinite(audio.duration) && durEl) {
            durEl.textContent = mmss(audio.duration);
          }
          audio.play().catch(function () {});
        }, { once: true });
        audio.addEventListener('error', function () {
          clearInterval(iv);
          if (!audio.src) fail('format qo‘llab-quvvatlanmaydi');
        }, { once: true });
        return;
      }
      state('play');
      audio.play().catch(function () { fail('ijro etilmadi'); });
    });

    audio.addEventListener('timeupdate', function () {
      var d0 = audio.duration || d.duration || 0;
      if (!d0) return;
      box.style.setProperty('--p', String(Math.min(1, audio.currentTime / d0)));
    });
    audio.addEventListener('ended', function () {
      box.style.setProperty('--p', '0');
      state('pause');
    });
    audio.addEventListener('pause', function () {
      if (audio.src) state('pause');
    });
    audio.addEventListener('play', function () { state('play'); });
  }

  // ================================================================ RECORDER
  /**
   * Yozuvchi. Telegram'dagi kabi:
   *   var rec = new TgVoice.Recorder({ onTick: fn, onError: fn });
   *   rec.start();  rec.stop() -> { blob, mime, duration } | null
   */
  function Recorder(opts) {
    opts = opts || {};
    this.onTick = opts.onTick || function () {};
    this.onError = opts.onError || function () {};
    this.state = 'idle';
    this.rec = null;
    this.stream = null;
    this.chunks = [];
    this.mime = '';
    this.t0 = 0;
    this.timer = null;
  }

  Recorder.prototype.isActive = function () { return this.state === 'rec'; };

  Recorder.prototype.start = function () {
    var self = this;
    if (this.state === 'rec') return Promise.resolve(true);
    if (this.state === 'busy') return Promise.resolve(false);
    if (!isSupported()) { this.onError('Bu brauzer mikrofonni qo‘llamaydi'); return Promise.resolve(false); }
    this.state = 'busy';
    return global.navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (stream) {
        self.stream = stream;
        self.mime = pickMime();
        var rec = null;
        try { rec = self.mime ? new global.MediaRecorder(stream, { mimeType: self.mime }) : new global.MediaRecorder(stream); }
        catch (e) { try { rec = new global.MediaRecorder(stream); } catch (e2) { rec = null; } }
        if (!rec) throw new Error('MediaRecorder ishlamadi');
        self.rec = rec;
        self.chunks = [];
        rec.ondataavailable = function (ev) { if (ev && ev.data && ev.data.size) self.chunks.push(ev.data); };
        // 250 ms da bo'laklab olamiz: to'xtatilganda ham ma'lumot qoladi.
        rec.start(250);
        self.state = 'rec';
        self.t0 = Date.now();
        self.onTick(0);
        if (self.timer) clearInterval(self.timer);
        self.timer = setInterval(function () { self.onTick(self.seconds()); }, 200);
        return true;
      })
      .catch(function (e) {
        self.cleanup();
        self.state = 'idle';
        self.onError(permissionMsg(e));
        return false;
      });
  };

  Recorder.prototype.seconds = function () {
    return Math.max(0, (Date.now() - this.t0) / 1000);
  };

  Recorder.prototype.stop = function () {
    var self = this;
    if (this.state !== 'rec') return Promise.resolve(null);
    this.state = 'busy';
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    var dur = Math.max(1, Math.round(this.seconds()));
    return new Promise(function (resolve) {
      var settled = false;
      var finish = function () {
        if (settled) return;
        settled = true;
        var type = self.mime || (self.chunks[0] && self.chunks[0].type) || 'audio/ogg';
        var blob;
        try { blob = new global.Blob(self.chunks, { type: type }); } catch (e) { blob = null; }
        self.cleanup();
        self.state = 'idle';
        resolve(blob && blob.size ? { blob: blob, mime: baseMime(type), duration: dur } : null);
      };
      // Xavfsizlik: `stop()` hech qachon javob bermasa.
      var guard = setTimeout(finish, 3000);
      try {
        self.rec.onstop = function () { clearTimeout(guard); finish(); };
        self.rec.stop();
      } catch (e) { clearTimeout(guard); finish(); }
    });
  };

  /** Bekor qilish - yozilgan ma'lumot tashlanadi. */
  Recorder.prototype.cancel = function () {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.state = 'idle';
    try { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); } catch (e) {}
    this.cleanup();
    return true;
  };

  Recorder.prototype.cleanup = function () {
    try {
      if (this.stream && this.stream.getTracks) {
        this.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      }
    } catch (e) {}
    this.rec = null;
    this.stream = null;
    this.chunks = [];
  };

  // ============================================================ IKONKALAR
  function micIco() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"'
      + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
      + '<rect x="9" y="2.6" width="6" height="11" rx="3"/>'
      + '<path d="M5.6 11.3a6.4 6.4 0 0 0 12.8 0"/>'
      + '<path d="M12 17.8v3.4M8.8 21.2h6.4"/></svg>';
  }
  /** Telegram'dagi "skripka" (fayl biriktirish). */
  function clipIco() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"'
      + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
      + '<path d="M20.4 11.1 12 19.5a5 5 0 0 1-7.1-7.1l8.4-8.4a3.4 3.4 0 0 1 4.8 4.8l-8.3 8.3a1.8 1.8 0 0 1-2.5-2.5l7.6-7.6"/></svg>';
  }
  function sendIco() {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">'
      + '<path d="M3.5 11.15 19.9 4.3a.55.55 0 0 1 .72.7l-7 15.6a.55.55 0 0 1-1 .05l-2-5.6'
      + '-5.55-1.95a.55.55 0 0 1-.07-.99z"/></svg>';
  }
  function trashIco() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"'
      + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
      + '<path d="M4.6 6.6h14.8"/>'
      + '<path d="M9.5 6.6V5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5v1.6"/>'
      + '<path d="M6.5 6.6 7.3 19a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5l.8-12.4"/></svg>';
  }

  /**
   * Kompozitorni Telegram uslubida bog'lash:
   *   matn BO'LMASA -> mikrofon tugmasi (bosilsa yozish boshlanadi),
   *   matn BO'LSA   -> yuborish tugmasi.
   *
   * @param {Object} o
   *   o.form   - <form> elementi
   *   o.input  - kiritish maydoni
   *   o.send   - yuborish/mikrofon tugmasi
   *   o.host   - panelga joylash (default: form.parentNode)
   *   o.onSend - function (blob, duration, mime)
   *   o.onError- function (msg)
   */
  function bindComposer(o) {
    o = o || {};
    var form = o.form || null;
    var input = o.input || null;
    var send = o.send || null;
    var host = o.host || (form ? form.parentNode : null);
    var onSend = o.onSend || function () {};
    var onError = o.onError || function () {};

    // ------------------------------------------------- "yozilmoqda" paneli
    var bar = document.createElement('div');
    bar.className = 'tv-rec off';
    bar.hidden = true;
    bar.innerHTML =
        '<button type="button" class="tv-rec-x" title="Bekor qilish" aria-label="Bekor qilish">'
      + trashIco() + '</button>'
      + '<span class="tv-rec-dot"></span>'
      + '<span class="tv-rec-time">0:00</span>'
      + '<span class="tv-rec-bars">' + new Array(10).join('<i></i>') + '</span>'
      + '<button type="button" class="tv-rec-ok" title="Yuborish" aria-label="Yuborish">'
      + sendIco() + '</button>';
    if (host && form && form.parentNode) host.insertBefore(bar, form);

    var timeEl = bar.querySelector('.tv-rec-time');
    var okEl = bar.querySelector('.tv-rec-ok');
    var xEl = bar.querySelector('.tv-rec-x');

    var rec = new Recorder({
      onTick: function (sec) { if (timeEl) timeEl.textContent = mmss(sec); },
      onError: function (msg) { onError(msg); }
    });

    // ------------------------------------------- tugma holatlari (3 ta holat)
    //   mic    - matn yo'q, ovoz yozish
    //   attach - mikrofon TEZ bosilgan -> endi "skripka" (fayl biriktirish)
    //   send   - matn yozilgan -> yuborish
    var file = o.file || null;          // <input type="file">
    var onAttach = o.onAttach || null;  // file bo'lmasa chaqiriladigan funksiya
    var attached = false;
    var armedFresh = false;             // hozirgina skripkaga o'tgan bosilish
    var holdTimer = null;
    var HOLD_MS = 260;                  // shundan uzoq ushlansa - yozish

    function mode() {
      if (input && String(input.value || '').trim()) return 'send';
      return attached ? 'attach' : 'mic';
    }

    function syncBtn() {
      if (!send) return;
      var m = mode();
      send.setAttribute('data-mode', m);
      var lbl = (m === 'send') ? 'Yuborish' : (m === 'attach' ? 'Rasm yuborish' : 'Ovozli xabar');
      send.setAttribute('aria-label', lbl);
      send.setAttribute('title', lbl);
      var a = send.querySelector('.tv-send-mic');
      var b = send.querySelector('.tv-send-clip');
      var c = send.querySelector('.tv-send-ico');
      if (a) a.hidden = (m !== 'mic');
      if (b) b.hidden = (m !== 'attach');
      if (c) c.hidden = (m !== 'send');
    }

    function show(on) {
      if (form) {
        if (on) form.classList.add('off');
        else form.classList.remove('off');
      }
      if (on) { bar.classList.remove('off'); bar.hidden = false; }
      else { bar.classList.add('off'); bar.hidden = true; }
      syncBtn();
    }

    function start() {
      if (rec.isActive() || rec.state === 'busy') return;
      rec.start().then(function (ok) { show(!!ok); });
    }

    function openFile() {
      attached = false;
      armedFresh = false;
      syncBtn();
      if (file) { try { file.click(); return; } catch (e) { /* quyidagiga */ } }
      if (onAttach) { try { onAttach(); } catch (e2) {} }
    }

    function stopAndSend() {
      if (okEl) okEl.classList.add('busy');
      rec.stop().then(function (out) {
        if (okEl) okEl.classList.remove('busy');
        show(false);
        if (!out) return;
        onSend(out.blob, out.duration, out.mime);
      });
    }

    function cancel() {
      rec.cancel();
      show(false);
      if (input) { try { input.focus(); } catch (e) {} }
    }

    if (xEl) xEl.addEventListener('click', function (e) { e.preventDefault(); cancel(); });
    if (okEl) okEl.addEventListener('click', function (e) { e.preventDefault(); stopAndSend(); });

    // ---- tugma: mikrofon (bosing) -> skripka (uzoq ushlang = yozish) --------
    // 1) MIKROFON:  tez bosilsa (bosib darhol qo'yib yuborilsa) -> SKRIPKA
    // 2) SKRIPKA:   bosilsa -> fayl/rasm tanlash dialogi
    // 3) SEND:      matn yozilgan -> oddiy yuborish
    if (send) {
      send.addEventListener('pointerdown', function () {
        armedFresh = false;                     // yangi bosilish
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        if (rec.isActive() || mode() !== 'mic') return;
        holdTimer = setTimeout(function () { holdTimer = null; start(); }, HOLD_MS);
      });
      var release = function () {
        if (!holdTimer) return;                 // allaqachon yozish boshlandi
        clearTimeout(holdTimer);
        holdTimer = null;
        if (mode() !== 'mic') return;
        attached = true;                        // mikrofon -> skripka
        armedFresh = true;                      // shu bosilish faqat almashirdi
        syncBtn();
      };
      send.addEventListener('pointerup', release);
      send.addEventListener('pointercancel', function () {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      });
      send.addEventListener('click', function (e) {
        if (rec.isActive()) return;
        var m = mode();
        if (m === 'send') return;               // matn bor -> form submit qilsin
        e.preventDefault();
        if (m === 'attach') {
          if (armedFresh) { armedFresh = false; return; }   // hozirgina o'tgan bosilish
          openFile();
          return;
        }
        if (holdTimer) { release(); return; }   // klaviatura/assistiv faqat
        start();
      });
    }
    if (input) {
      input.addEventListener('input', function () { attached = false; syncBtn(); });
      // Kompozitorga qaytish (chatdan chiqib yana kirsak) - mikrofonga qaytamiz.
      form && form.addEventListener('focusin', syncBtn);
    }
    syncBtn();

    return {
      bar: bar,
      recorder: rec,
      isRecording: function () { return rec.isActive(); },
      mode: mode,
      openFile: openFile,
      start: start,
      stopAndSend: stopAndSend,
      cancel: cancel,
      close: function () {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        attached = false;
        armedFresh = false;
        if (rec.isActive()) rec.cancel();
        show(false);
      }
    };
  }

  // ============================================================ TELEGRAMGA
  /**
   * GramJS `bytes` maydoni faqat `Buffer` yoki `string` qabul qiladi
   * (`serializeBytes`: "Bytes or str expected, not object") - oddiy
   * `Uint8Array` ISHLAMAYDI. GramJS brauzerda `globalThis.Buffer` ni o'zi
   * qo'yadi (shim/buffer-global.js), shuning uchun undan foydalanamiz.
   * @param {Uint8Array} u8
   * @returns {Object|String} GramJS Buffer yoki satr
   */
  function toBytes(u8) {
    var g = global;
    var B = g.Buffer;
    if (B && typeof B.from === 'function') {
      try { return B.from(u8.buffer ? new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength) : new Uint8Array(u8)); }
      catch (e) { /* quyidagi zaxiraga */ }
    }
    // Zaxira: `Buffer.from(str)` ichida utf8 ishlatiladi, shuning uchun
    // har bir belgi 1 baytga sig'ishi uchun 0..127 oralig'iga cheklaymiz.
    var s = '';
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i] > 127 ? 127 : u8[i]);
    return s;
  }

  /**
   * Blob'ni Telegram'ga yuklab, `InputMediaUploadedDocument` (voice) qaytaradi.
   * @returns {Promise<Object>} GramJS `Api.InputMediaUploadedDocument`
   */
  function uploadMedia(blob, duration) {
    var M = global.TgMedia;
    if (!M) return Promise.reject(new Error('Telegram tayyor emas'));
    var api = M.api();
    if (!api) return Promise.reject(new Error('Telegram tayyor emas'));
    var mime = baseMime(blob && blob.type);
    var ext = (mime === 'audio/webm') ? 'webm' : (mime === 'audio/mp4') ? 'm4a' : 'ogg';
    var file = new global.File([blob], 'voice.' + ext, { type: mime });
    return computeWaveform(blob, 64).then(function (wave) {
      return M.client().then(function (c) {
        return c.uploadFile({ file: file, workers: 1 });
      }).then(function (up) {
        // GramJS bundle shu yerda yuklangan bo'ladi -> globalThis.Buffer mavjud.
        return new api.InputMediaUploadedDocument({
          file: up,
          mimeType: mime,
          attributes: [new api.DocumentAttributeAudio({
            voice: true,
            duration: Math.max(0, Math.round(Number(duration) || 0)),
            waveform: toBytes(wave)
          })]
        });
      });
    });
  }

  global.TgVoice = {
    isSupported: isSupported,
    Recorder: Recorder,
    mmss: mmss,
    micIco: micIco,
    sendIco: sendIco,
    waveform: computeWaveform,
    waveHtml: waveHtml,
    voiceHtml: voiceHtml,
    wireVoice: wireVoice,
    bindComposer: bindComposer,
    uploadMedia: uploadMedia
  };
})(window);