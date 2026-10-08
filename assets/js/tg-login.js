/* ============================================================================
 * W CINEMA — TELEGRAM LOGIN SAHIFASI (web.telegram.org/k uslubida)
 * ============================================================================
 *
 *  Telegram Web K'ga o'xshash kirish ekrani:
 *    · QR kod darhol ko'rinadi (telefon bilan skanerlash)
 *    · "Telefon raqami bilan kirish" -> mamlakat tanlagichi + raqam
 *    · kod -> (bo'lsa) 2FA parol
 *    · Yuqori o'ng burchakda kun/tun mavzu tugmasi
 *
 *  Kirish mantiqi `tg-stream.js` da (`TgStream.login`). Bu fayl faqat UI va
 *  `view` interfeysini beradi: askPhone / askCode / needPassword / setState.
 *
 *  auth_key faqat localStorage'da (`wc_mtproto_auth_v1`) qoladi. Server
 *  kalitni ham, parolni ham HECH QACHON ko'rmaydi.
 * ========================================================================== */
(function (global) {
  'use strict';

  // Telegram rasmiy logotipi (web.telegram.org/k `#logo` yoli, 160x160).
  // Bitta `path`: tashqi doira + samolyot (evenodd tufayli samolyot "teshik").
  var LOGO_PATH = 'M80,0 C124.18278,0 160,35.81722 160,80 C160,124.18278 124.18278,160 80,160 '
    + 'C35.81722,160 0,124.18278 0,80 C0,35.81722 35.81722,0 80,0 Z '
    + 'M114.262551,46.4516129 L114.123923,46.4516129 C111.089589,46.5056249 106.482806,48.0771432 '
    + '85.1289541,56.93769 L81.4133571,58.4849956 C72.8664779,62.0684477 57.2607933,68.7965125 '
    + '34.5963033,78.66919 C30.6591745,80.2345564 28.5967328,81.765936 28.4089783,83.2633288 '
    + 'C28.0626453,86.0254269 31.8703852,86.959903 36.7890378,88.5302703 L38.2642674,89.0045258 '
    + 'C42.3926354,90.314406 47.5534685,91.7248852 50.3250916,91.7847532 C52.9151948,91.8407003 '
    + '55.7944784,90.8162976 58.9629426,88.7115451 L70.5121776,80.9327422 '
    + 'C85.6657026,70.7535853 93.6285785,65.5352892 94.4008055,65.277854 L94.6777873,65.216416 '
    + 'C95.1594319,65.1213105 95.7366278,65.0717596 96.1481181,65.4374337 '
    + 'C96.6344248,65.8695939 96.5866185,66.6880224 96.5351057,66.9075859 '
    + 'C96.127514,68.6448691 75.2839361,87.6143392 73.6629144,89.2417998 L73.312196,89.6016896 '
    + 'C68.7645143,94.2254793 63.9030972,97.1721503 71.5637945,102.355193 L73.3593638,103.544598 '
    + 'C79.0660342,107.334968 82.9483395,110.083813 88.8107882,113.958377 L90.3875424,114.996094 '
    + 'C95.0654739,118.061953 98.7330313,121.697601 103.562866,121.253237 '
    + 'C105.740839,121.052855 107.989107,119.042224 109.175465,113.09692 L109.246762,112.727987 '
    + 'C112.002037,98.0012935 117.417883,66.09303 118.669527,52.9443975 '
    + 'C118.779187,51.7924073 118.641237,50.318088 118.530455,49.6708963 L118.474159,49.3781963 '
    + 'C118.341081,48.7651315 118.067967,48.0040758 117.346762,47.4189793 '
    + 'C116.412565,46.6610871 115.002114,46.4638844 114.262551,46.4516129 Z';

  var THEME_KEY = 'wc_tgl_theme';

  function flagOf(iso) {
    try {
      return String.fromCodePoint.apply(null, String(iso).toUpperCase().split('')
        .map(function (ch) { return 127397 + ch.charCodeAt(0); }));
    } catch (e) { return '\uD83C\uDFF3'; }
  }

  function q(sel, root) { return (root || document).querySelector(sel); }

  // Mamlakat ro'yxati (tg-countries.js). Bo'lmasa — faqat O'zbekiston.
  function countries() {
    var list = global.TG_COUNTRIES;
    if (!Array.isArray(list) || !list.length) return [['UZ', '+998', "O'zbekiston"]];
    return list;
  }

  function logoSvg() {
    var base = (global.APP && global.APP.base) ? global.APP.base : '';
    var v = (global.APP && global.APP.logoV) ? global.APP.logoV : 1;
    return '<img class="tgl-logo-svg" src="' + base + '/assets/img/logo.png?v=' + v + '" alt="W CINEMA" width="120" height="120">';
  }

  // ---- mavzu ---------------------------------------------------------------
  function isDay() { return document.documentElement.classList.contains('tgl-day'); }
  function applyTheme(day, btn) {
    document.documentElement.classList.toggle('tgl-day', !!day);
    if (btn) btn.textContent = day ? '\u2600\uFE0F' : '\uD83C\uDF19';
    try { localStorage.setItem(THEME_KEY, day ? 'day' : 'night'); } catch (e) {}
    // QR qayta chizilsin (ranglar o'zgargan bo'lishi mumkin) — TgStream'ga xabar.
    try { if (global.TgStream && global.TgStream.redrawQr) global.TgStream.redrawQr(); } catch (e) {}
  }

  function mount(node, opts) {
    opts = opts || {};
    var onSuccess = typeof opts.onSuccess === 'function' ? opts.onSuccess : function () {};
    var next = opts.next || 'index.php';

    // ---- markup ----------------------------------------------------
    node.innerHTML =
      '<div class="tgl-bg" aria-hidden="true">'
      + '<span class="tgl-blob b1"></span><span class="tgl-blob b2"></span><span class="tgl-blob b3"></span>'
      + '</div>'
      + '<button type="button" class="tgl-theme" data-tgl-theme aria-label="Mavzuni almashtirish">\uD83C\uDF19</button>'

      + '<div class="tgl-scroll"><div class="tgl-cards">'

      // ---------------- QR (standart) ----------------
      + '<section class="tgl-page tgl-page-qr">'
      +   '<div class="tgl-card">'
      +     '<div class="tgl-head">'
      +       '<div class="tgl-sticker tgl-sticker-qr"><div class="tgl-qr"></div></div>'
      +       '<h1 class="tgl-title">Telegram\u2019ga QR kod orqali kirish</h1>'
      +       '<p class="tgl-subtitle">Telefoningizdagi Telegram bilan skanerlang</p>'
      +     '</div>'
      +     '<ol class="tgl-qrlist">'
      +       '<li><span class="tgl-mark">1</span><span>Telefoningizda Telegramni oching</span></li>'
      +       '<li><span class="tgl-mark">2</span><span>Sozlamalar \u203A Qurilmalar \u203A Kompyuterni ulash bo\u2018limiga o\u2018ting</span></li>'
      +       '<li><span class="tgl-mark">3</span><span>Kirishni tasdiqlash uchun telefoningizni shu ekranga tuting</span></li>'
      +     '</ol>'
      +     '<div class="tgl-msgs"><div class="tgl-status"></div><p class="tgl-err" hidden></p></div>'
      +     '<button type="button" class="tgl-btn tgl-btn-transparent" data-tgl-to-phone>Telefon raqami bilan kirish</button>'
      +   '</div>'
      + '</section>'

      // ---------------- Raqam ----------------
      + '<section class="tgl-page tgl-page-phone" hidden>'
      +   '<div class="tgl-card">'
      +     '<div class="tgl-head">'
      +       '<div class="tgl-sticker">' + logoSvg() + '</div>'
      +       '<h1 class="tgl-title">Telegram\u2019ga kirish</h1>'
      +       '<p class="tgl-subtitle">Davlatingizni tasdiqlang va telefon raqamingizni kiriting.</p>'
      +     '</div>'
      +     '<form class="tgl-input-wrapper tgl-form-phone">'
      +       '<button type="button" class="tgl-field tgl-field-country" data-tgl-cc>'
      +         '<span class="tgl-flag" data-tgl-flag>\uD83C\uDDFA\uD83C\uDDFF</span>'
      +         '<span class="tgl-cname" data-tgl-cname>O\u2018zbekiston</span>'
      +         '<span class="tgl-arrow" aria-hidden="true"></span>'
      +       '</button>'
      +       '<label class="tgl-field tgl-field-phone">'
      +         '<span class="tgl-dial" data-tgl-dial>+998</span>'
      +         '<input class="tgl-num" type="tel" inputmode="numeric" autocomplete="tel" placeholder="00 000 00 00">'
      +       '</label>'
      +       '<button type="submit" class="tgl-btn tgl-btn-primary">Keyingi</button>'
      +     '</form>'
      +     '<div class="tgl-msgs"><div class="tgl-status"></div><p class="tgl-err" hidden></p></div>'
      +     '<button type="button" class="tgl-btn tgl-btn-transparent" data-tgl-to-qr>QR kod orqali kirish</button>'
      +   '</div>'
      + '</section>'

      // ---------------- Kod ----------------
      + '<section class="tgl-page tgl-page-code" hidden>'
      +   '<div class="tgl-card">'
      +     '<div class="tgl-head">'
      +       '<div class="tgl-sticker">' + logoSvg() + '</div>'
      +       '<h1 class="tgl-title">Kodni kiriting</h1>'
      +       '<p class="tgl-subtitle" data-tgl-code-sub>Telegram ilovasiga yuborilgan kodni kiriting.</p>'
      +     '</div>'
      +     '<form class="tgl-input-wrapper tgl-form-code">'
      +       '<label class="tgl-field">'
      +         '<input class="tgl-code" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="Kod">'
      +       '</label>'
      +       '<button type="submit" class="tgl-btn tgl-btn-primary">Keyingi</button>'
      +     '</form>'
      +     '<div class="tgl-msgs"><div class="tgl-status"></div><p class="tgl-err" hidden></p></div>'
      +     '<button type="button" class="tgl-btn tgl-btn-transparent" data-tgl-to-phone>Raqamni o\u2018zgartirish</button>'
      +   '</div>'
      + '</section>'

      // ---------------- 2FA parol ----------------
      + '<section class="tgl-page tgl-page-pwd" hidden>'
      +   '<div class="tgl-card">'
      +     '<div class="tgl-head">'
      +       '<div class="tgl-sticker">' + logoSvg() + '</div>'
      +       '<h1 class="tgl-title">Parolni kiriting</h1>'
      +       '<p class="tgl-subtitle">Ikki bosqichli autentifikatsiya (2FA) parolingizni kiriting.</p>'
      +     '</div>'
      +     '<form class="tgl-input-wrapper tgl-form-pwd">'
      +       '<label class="tgl-field">'
      +         '<input class="tgl-pwd-input" type="password" autocomplete="off" placeholder="Parol">'
      +       '</label>'
      +       '<button type="submit" class="tgl-btn tgl-btn-primary">Kirish</button>'
      +     '</form>'
      +     '<div class="tgl-msgs"><div class="tgl-status"></div><p class="tgl-err" hidden></p></div>'
      +   '</div>'
      + '</section>'

      + '</div></div>'

      // ---------------- Mamlakat tanlagichi ----------------
      + '<div class="tgl-cc-panel" hidden>'
      +   '<div class="tgl-cc-box">'
      +     '<input class="tgl-cc-search" type="search" placeholder="Davlat qidirish\u2026" autocomplete="off">'
      +     '<div class="tgl-cc-list"></div>'
      +   '</div>'
      + '</div>';

    var statusEls = node.querySelectorAll('.tgl-status');
    var errEls = node.querySelectorAll('.tgl-err');
    var qrEl = q('.tgl-qr', node);
    var ccPanel = q('.tgl-cc-panel', node);
    var ccList = q('.tgl-cc-list', node);
    var ccSearch = q('.tgl-cc-search', node);
    var themeBtn = q('[data-tgl-theme]', node);

    var pageQr = q('.tgl-page-qr', node);
    var pagePhone = q('.tgl-page-phone', node);
    var pageCode = q('.tgl-page-code', node);
    var pagePwd = q('.tgl-page-pwd', node);

    var formPhone = q('.tgl-form-phone', node);
    var formCode = q('.tgl-form-code', node);
    var formPwd = q('.tgl-form-pwd', node);

    var numInput = q('.tgl-num', node);
    var codeInput = q('.tgl-code', node);
    var pwdInput = q('.tgl-pwd-input', node);
    var codeSub = q('[data-tgl-code-sub]', node);

    var dialEl = q('[data-tgl-dial]', node);
    var flagEl = q('[data-tgl-flag]', node);
    var cnameEl = q('[data-tgl-cname]', node);

    var ccIso = 'UZ';
    var ccDial = '+998';
    var phoneResolve = null;
    var codeResolve = null;

    function each(nl, fn) { for (var i = 0; i < nl.length; i++) fn(nl[i]); }
    function esc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
    function setStatus(html) { each(statusEls, function (el) { el.innerHTML = html || ''; }); }
    function showErr(html) { each(errEls, function (el) { el.innerHTML = html || ''; el.hidden = !html; }); }
    function clearErr() { each(errEls, function (el) { el.innerHTML = ''; el.hidden = true; }); }

    function setMode(m) {
      pageQr.hidden = m !== 'qr';
      pagePhone.hidden = m !== 'phone';
      pageCode.hidden = m !== 'code';
      pagePwd.hidden = m !== 'pwd';
    }

    // Davlatga mos raqam maskasi: dial raqamlari soniga qarab taxminiy
    // milliy raqam uzunligini (jami 7…10 belgi oralig'ida) hisoblaymiz.
    // Masalan +998 (3 belgi) -> 9 ta raqam: "00 000 00 00".
    function numMask(dial) {
      var d = String(dial || '').replace(/\D/g, '').length;
      var n = Math.min(10, Math.max(7, 10 - Math.floor(d / 2)));
      var groups = [], rest = n;
      groups.push(Math.min(2, rest)); rest -= 2;
      if (rest > 0) { groups.push(Math.min(3, rest)); rest -= 3; }
      while (rest > 0) {
        if (rest <= 3) { groups.push(rest); rest = 0; }
        else { groups.push(2); rest -= 2; }
      }
      var out = [];
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i], s = '';
        for (var j = 0; j < g; j++) s += '0';
        if (s) out.push(s);
      }
      return out.join(' ');
    }

    function setCountry(iso, dial, name) {
      ccIso = iso; ccDial = dial;
      flagEl.textContent = flagOf(iso);
      dialEl.textContent = dial;
      if (name) cnameEl.textContent = name;
      // Mamlakat o'zgarganda eski davlatning raqami qolmasligi uchun
      // maydonni tozalaymiz va maskani (placeholder) yangi davlatga moslaymiz.
      // (Avval faqat "+998" prefiksio'zgarti, raqam maydoni esa eskirib
      //  qolgan 9 xonali o'zbek raqamini saqlab qolgan edi.)
      if (numInput) {
        numInput.value = '';
        numInput.setAttribute('inputmode', 'numeric');
        numInput.placeholder = numMask(dial);
      }
    }

    // ---- `view` interfeysi (tg-stream.js shuni chaqiradi) ----------
    var view = {
      qrBox: function () { return qrEl; },
      pwdForm: function () { return formPwd; },
      pwdInput: function () { return pwdInput; },
      setState: function (html) { setStatus(html); },
      showError: function (html) { showErr(html); },
      needPassword: function () {
        setMode('pwd');
        setStatus('');
        setTimeout(function () { try { pwdInput.focus(); } catch (e) {} }, 40);
      },
      askPhone: function () {
        setMode('phone');
        setStatus('');
        setTimeout(function () { try { numInput.focus(); } catch (e) {} }, 40);
        return new Promise(function (res) { phoneResolve = res; });
      },
      askCode: function (isCodeViaApp) {
        setMode('code');
        setStatus('');
        if (codeSub) {
          codeSub.textContent = isCodeViaApp
            ? 'Telegram ilovasidagi xabarda kelgan kodni kiriting.'
            : 'Telegramga yuborilgan kodni kiriting.';
        }
        setTimeout(function () { try { codeInput.focus(); } catch (e) {} }, 40);
        return new Promise(function (res) { codeResolve = res; });
      }
    };

    // ---- forma submits ---------------------------------------------
    formPhone.addEventListener('submit', function (e) {
      e.preventDefault();
      clearErr();
      var digits = String(numInput.value || '').replace(/\D/g, '');
      if (digits.length < 5) { showErr('Raqam juda qisqa \u2014 davlat kodi bilan kiriting.'); return; }
      var phone = ccDial + digits;
      setStatus('Kod yuborilmoqda\u2026');
      if (phoneResolve) { var r = phoneResolve; phoneResolve = null; r(phone); }
    });

    formCode.addEventListener('submit', function (e) {
      e.preventDefault();
      clearErr();
      var code = String(codeInput.value || '').replace(/\D/g, '');
      if (code.length < 3) { showErr('Kodni kiriting.'); return; }
      setStatus('Tekshirilmoqda\u2026');
      if (codeResolve) { var r = codeResolve; codeResolve = null; r(code); }
    });

    // 2FA parolni `askPassword` (tg-stream.js) `pwdForm` orqali oladi.
    formPwd.addEventListener('submit', function (e) { e.preventDefault(); });

    // ---- rejim / mavzu almashish ------------------------------------
    node.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-tgl-to-phone]')) { start('phone'); return; }
      if (t.closest('[data-tgl-to-qr]')) { start('qr'); return; }
      if (t.closest('[data-tgl-cc]')) { openCC(); return; }
      if (t.closest('[data-tgl-theme]')) { applyTheme(!isDay(), themeBtn); return; }
      if (t === ccPanel) { closeCC(); return; }
    });

    var startToken = 0;
    function start(mode) {
      var token = ++startToken;
      clearErr();
      setMode(mode === 'phone' ? 'phone' : 'qr');
      setStatus(mode === 'phone'
        ? 'Telefon raqami tayyorlanmoqda\u2026'
        : '');
      global.TgStream.login(view, { mode: mode }).then(function () {
        if (token !== startToken) return;              // eski oqim — e'tiborsiz
        setStatus('Telegram ulandi \u2713');
        onSuccess(next);
      }).catch(function (e) {
        if (token !== startToken) return;              // eski oqim xatosi
        var m = (e && (e.errorMessage || e.message)) || String(e);
        if (m === 'AUTH_RESTART') return;
        if (m === 'AUTH_USER_CANCEL') return;
        handleError(e);
      });
    }

    function handleError(e) {
      var m = (e && (e.errorMessage || e.message)) || String(e);
      if (m === 'AUTH_RESTART') return;                 // rejim almashdi — xato emas
      if (global.TgStream && global.TgStream.friendlyError) {
        var f = global.TgStream.friendlyError(m);
        showErr(f.err);
        if (f.retry === 'phone') { setMode('phone'); }
        else if (f.retry === 'code') { setMode('code'); }
        else if (f.retry === 'pwd') { setMode('pwd'); }
        else if (f.retry === 'qr') { setMode('qr'); setStatus(''); }
      } else {
        showErr(esc(m));
      }
    }

    // ---- mamlakat tanlagichi ---------------------------------------
    function openCC() {
      ccPanel.hidden = false;
      ccSearch.value = '';
      renderCC('');
      setTimeout(function () { try { ccSearch.focus(); } catch (e) {} }, 30);
    }
    function closeCC() { ccPanel.hidden = true; }

    function renderCC(filter) {
      var f = String(filter || '').toLowerCase();
      var rows = countries().filter(function (c) {
        return !f || String(c[2]).toLowerCase().indexOf(f) !== -1 || String(c[1]).indexOf(f) !== -1;
      });
      var html = rows.slice(0, 300).map(function (c) {
        return '<button type="button" class="tgl-cc-item" data-iso="' + esc(c[0])
          + '" data-dial="' + esc(c[1]) + '" data-name="' + esc(c[2]) + '">'
          + '<span class="tgl-flag">' + flagOf(c[0]) + '</span>'
          + '<span class="tgl-cc-name">' + esc(c[2]) + '</span>'
          + '<span class="tgl-cc-dial">' + esc(c[1]) + '</span></button>';
      }).join('');
      ccList.innerHTML = html || '<div class="tgl-cc-empty">Topilmadi</div>';
    }

    ccSearch.addEventListener('input', function () { renderCC(ccSearch.value); });
    ccList.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.tgl-cc-item');
      if (!b) return;
      setCountry(b.getAttribute('data-iso'), b.getAttribute('data-dial'), b.getAttribute('data-name'));
      closeCC();
      try { numInput.focus(); } catch (e2) {}
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ccPanel && !ccPanel.hidden) closeCC();
    });

    // ---- mavzu (boshlang'ich) --------------------------------------
    var savedDay = false;
    try { savedDay = localStorage.getItem(THEME_KEY) === 'day'; } catch (e) {}
    applyTheme(savedDay, themeBtn);

    // ---- boshlash ---------------------------------------------------
    // Kalit bor bo'lsa — jim tekshiramiz (QR ko'rsatmasdan). Yaroqli
    // bo'lsa darhol o'tamiz; bekor qilingan bo'lsa QR/raqam ochiladi.
    if (global.TgStream.hasSession()) {
      setMode('qr');
      setStatus('Telegram ulanishi tekshirilmoqda\u2026');
      global.TgStream.verify().then(function () {
        onSuccess(next);                               // kalit yaroqli — to'g'ridan-to'g'ri o'tamiz
      }).catch(function () {
        start('qr');
      });
    } else {
      start('qr');
    }
  }

  global.TgLogin = { mount: mount };
})(window);
