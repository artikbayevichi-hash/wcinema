/* ==========================================================================
 * tv-mode.js — Smart TV aniqlash + D-Pad (pult) boshqaruvi
 * --------------------------------------------------------------------------
 * YouTube TV / Android TV uslubidagi "10-foot UI".
 *
 * 1) AVTOMATIK ANIQLASH
 *    `TvMode.detect()` — navigator.userAgent ichida TV platformalarini izlaydi
 *    (Tizen, WebOS, Android TV, GoogleTV, AppleTV, SmartTV, Roku, CrKey ...).
 *    Aniqlansa `<body>` ga `.tv-mode` klassi qo'yiladi va TV UI yoqiladi.
 *    Ustidan yozish: `?tv=1` / `?tv=0`, `localStorage['wc_tv_mode']`.
 *
 * 2) SPATIAL (D-PAD) NAVIGATSIYA
 *    ← → ↑ ↓  — geometrik eng yaqin fokuslanadigan elementga surish
 *    Enter    — fokusdagi elementni bosish (link/knopka)
 *    Esc/Back — orqaga: modal yopish, chat ro'yxatiga qaytish
 *    ←/→      — qator ("shelf") bo'ylab siljish
 *
 * 3) API
 *    TvMode.isTv()          → hozir TV rejimida yoki yo'qmi
 *    TvMode.enable()/disable()/toggle()
 *    TvMode.onChange(fn)
 *    TvSpatial.move(dir)    → qo'lda fokusni surish
 *    TvSpatial.refresh()     → yangi qo'shilgan elementlarni hisobga olish
 *
 * Boshqa modullar uchun `data-tv-skip` atributi bilan fokusdan chiqariladi.
 * ========================================================================== */
(function (global) {
    'use strict';

    // ==================================================================
    //  1) TV PLATFORMALARI
    // ==================================================================
    var PLATFORMS = [
        { id: 'tizen',     re: /Tizen|SamsungBrowser|SAMSUNG[\s-]?SMART[\s-]?TV/i },
        { id: 'webos',     re: /Web0?S|HbbTV|NetCast|LG NetCast/i },
        { id: 'appletv',    re: /AppleTV|Apple TV|tvOS|AppleCoreMedia/i },
        // Chromecast mustahil qurilma kodi — `CrKey` shu yerda, aks holda
        // androidtv bilan chalkashadi va birinchi o'tkazilgan "to'g'ri" keladi.
        { id: 'chromecast', re: /CrKey/i },
        // Amazon Fire TV: AFT + 2 harf (AFTKA, AFTMM, AFTSS, AFTDCT...),
        // shuningdek AFTB / AFTN (bitta harfli) — `AFT[A-Z]{0,2}` bilan.
        { id: 'firetv',     re: /AFT[A-Z]{0,2}\b|Fire TV|FireTV/i },
        // Android TV / Google TV: rasmiy kod `Android TV`, devolop `GoogleTV`,
        // eski Google TV qurilmalari `ADT-*`.
        { id: 'androidtv',  re: /Android[\s-]?TV|Google[\s-]?TV|ADT-[A-Z0-9]+/i },
        { id: 'roku',       re: /Roku|RVPV|MegaFon/i },
        { id: 'playstation',re: /PlayStation/i },
        { id: 'xbox',       re: /Xbox/i },
        { id: 'smarttv',    re: /SmartTV|Smart TV|BRAVIA|VIDAA|TCL.*TV|Hisense|InSight|QNX.*TV|Viera/i },
        { id: 'webtv',      re: /TV Safari|Opera TV|MeeGo/i }
    ];

    /** TV platformasi topildimi? @returns {?string} platforma id yoki null */
    function detectPlatform(ua) {
        var s = String(ua || (global.navigator && global.navigator.userAgent) || '');
        if (!s) return null;
        for (var i = 0; i < PLATFORMS.length; i++) {
            try { if (PLATFORMS[i].re.test(s)) return PLATFORMS[i].id; } catch (e) {}
        }
        return null;
    }

    /** @returns {boolean} */
    function detect(ua) {
        var plat = detectPlatform(ua);
        if (plat) return true;
        // Zaxira: katta ekran + sensor yo'qligi (ba'zi SmartTV brauzerlari).
        try {
            var n = global.navigator || {};
            var coarse = n.maxTouchPoints === 0
                      && String(global.matchMedia && global.matchMedia('(pointer: coarse)').matches) === 'true';
            var wide = global.screen && global.screen.width >= 1600 && global.screen.height >= 900;
            return !!(coarse && wide && !/Mobile|Android (?!.*TV)/i.test(n.userAgent || ''));
        } catch (e) { return false; }
    }

    // ==================================================================
    //  2) HOLAT
    // ==================================================================
    var LS_KEY = 'wc_tv_mode';
    var on = false;
    var platform = null;
    var listeners = [];

    function readLs() {
        try { return localStorage.getItem(LS_KEY); } catch (e) { return null; }
    }
    function writeLs(v) {
        try { localStorage.setItem(LS_KEY, v); } catch (e) {}
    }

    /** ?tv=1/0 → localStorage → UA. */
    function initial() {
        try {
            var f = new URLSearchParams(location.search).get('tv');
            if (f === '1' || f === 'true') return true;
            if (f === '0' || f === 'false') return false;
        } catch (e) {}
        var s = readLs();
        if (s === '1') return true;
        if (s === '0') return false;
        return detect();
    }

    /** Klasslarni qo'yadi (`.tv-mode` — body, `.tv` — eski selektorlar uchun). */
    function apply(state, persist) {
        on = !!state;
        var d = document, b = d.body, h = d.documentElement;
        if (!b) return on;                       // <body> hali yo'q
        b.classList.toggle('tv-mode', on);
        if (h) {
            // <html> ga ham qo'yamiz - tv-head.php shuni <head> da qiladi,
            // shunda sahifa chizilishidan oldin ham TV uslublari ishlaydi.
            h.classList.toggle('tv-mode', on);
            h.classList.toggle('tv', on);
            h.setAttribute('data-tv', on ? '1' : '0');
        }
        if (persist !== false) writeLs(on ? '1' : '0');
        for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](on, platform); } catch (e) {}
        }
        if (on) setTimeout(function () { TvSpatial.refresh(); }, 60);
        return on;
    }

    function enable() { return apply(true, true); }
    function disable() { return apply(false, true); }
    function toggle() { return apply(!on, true); }
    function isTv() { return on; }
    function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }
    function platformName() { return platform; }

    // ==================================================================
    //  3) SPATIAL NAVIGATSIYA (D-Pad)
    // ==================================================================
    var SEL = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
        '.yt-card',                  // bosh sahifa video kartalari
        '.reels-slide',              // reels slaydlari
        '.ig-item',
        '.chat-row'                  // chat ro'yxati
    ].join(',');

    /** Ko'rinadigan, kattligi yetarli element. */
    function visible(el) {
        if (!el || !el.getClientRects) return false;
        if (el.closest('[hidden]')) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        var cs;
        try { cs = getComputedStyle(el); } catch (e) { return false; }
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (Number(cs.opacity) === 0) return false;
        var r = el.getBoundingClientRect();
        return r.width > 8 && r.height > 8;
    }

    /** Fokuslashadigan barcha elementlar. */
    function all() {
        var list = [];
        try { list = Array.prototype.slice.call(document.querySelectorAll(SEL)); } catch (e) { return list; }
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            if (el.tabIndex === -1) continue;
            if (el.hasAttribute('data-tv-skip')) continue;
            if (el.disabled) continue;
            if (el.getAttribute('aria-hidden') === 'true') continue;
            if (!visible(el)) continue;
            out.push(el);
        }
        return out;
    }

    /** Ochiq modal bo'lsa — fokus faqat uning ichida. */
    function scope() {
        var ids = ['modal', 'trimModal', 'chatPicker', 'cPicker', 'igSearch'];
        for (var i = 0; i < ids.length; i++) {
            var m = document.getElementById(ids[i]);
            if (m && !m.hidden) {
                var inside = all().filter(function (el) { return m.contains(el); });
                if (inside.length) return inside;
            }
        }
        var open = document.querySelector('.ig-search:not([hidden])');
        if (open) {
            var in2 = all().filter(function (el) { return open.contains(el); });
            if (in2.length) return in2;
        }
        return all();
    }

    /** Fokusni elementga olib boradi (TV scroll-snap bilan). */
    function focusEl(el, opts) {
        if (!el) return;
        var o = opts || {};
        // `.tv-focus` — pult bilan siljilganda vizual fokus kafolati.
        // (`:focus-visible` ba'zi brauzerlarda dasturiy `.focus()` da
        //  qo'llanmaydi, shuning uchun klass ham qo'yamiz.)
        if (el !== document.activeElement) {
            var prev = document.querySelector('.tv-focus');
            if (prev && prev !== el) prev.classList.remove('tv-focus');
            el.classList.add('tv-focus');
        }
        try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
        try {
            el.scrollIntoView({
                behavior: on ? 'smooth' : 'auto',
                block: o.block || 'nearest',
                inline: o.inline || 'center'
            });
        } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
    }

    /**
     * Geometrik eng yaqin elementga surish.
     * @param {'up'|'down'|'left'|'right'} dir
     */
    function move(dir) {
        var list = scope();
        if (!list.length) return null;
        var cur = document.activeElement;

        // Fokus hali yo'q — birinchi elementga.
        if (!cur || list.indexOf(cur) === -1) { focusEl(list[0]); return list[0]; }

        var cr = cur.getBoundingClientRect();
        var cx = cr.left + cr.width / 2;
        var cy = cr.top + cr.height / 2;
        var best = null, bestScore = Infinity;

        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            if (el === cur) continue;
            var r = el.getBoundingClientRect();
            var x = r.left + r.width / 2;
            var y = r.top + r.height / 2;
            var dx = x - cx, dy = y - cy, primary, secondary;

            if (dir === 'left')       { if (dx >  -6) continue; primary = -dx; secondary = Math.abs(dy); }
            else if (dir === 'right') { if (dx <   6) continue; primary =  dx; secondary = Math.abs(dy); }
            else if (dir === 'up')    { if (dy >  -6) continue; primary = -dy; secondary = Math.abs(dx); }
            else if (dir === 'down')  { if (dy <   6) continue; primary =  dy; secondary = Math.abs(dx); }
            else return null;

            // Asosiy o'q masofasi + kesishuvchi o'qdan og'ish (2.6x).
            // Bir qatorda turgan elementlar afzal (secondary * 2.6).
            var score = primary + secondary * 2.6;
            if (score < bestScore) { bestScore = score; best = el; }
        }
        if (!best) return null;
        focusEl(best, { block: 'nearest', inline: 'center' });
        return best;
    }

    /** Fokusni qayta hisoblash (DOM o'zgarganda). */
    function refresh() {
        // Hozircha qayta belgilash shart emas — `all()` har safar
        // DOM'ni o'zi o'qibdi. Kelajakda katalog optimizatsiyasi uchun nuqta.
    }

    // ---- "orqaga" (Esc / Backspace) -------------------------------------
    function goBack() {
        // 1) ochiq modal / picker
        var ids = ['modal', 'trimModal', 'cPicker', 'chatPicker'];
        for (var i = 0; i < ids.length; i++) {
            var m = document.getElementById(ids[i]);
            if (m && !m.hidden) {
                var close = m.querySelector('[data-close]');
                if (close) { close.click(); return true; }
                m.hidden = true;
                m.removeAttribute('data-mode');
                if (m.id === 'cPicker') { try { m.innerHTML = ''; } catch (e) {} }
                return true;
            }
        }
        // 2) qidiruv oynasi
        var s = document.getElementById('igSearch');
        if (s && !s.hidden) {
            var back = s.querySelector('[data-close]');
            if (back) { back.click(); return true; }
        }
        // 3) chat: xabar oynasidan ro'yxatga
        if (document.body.classList.contains('chat-open')) {
            var cb = document.getElementById('chatBack');
            if (cb) { cb.click(); return true; }
        }
        // 4) izohlar paneli (reels)
        if (document.body.classList.contains('reels-comments-open')) {
            try { if (global.TGComments && TGComments.close) { TGComments.close(); return true; } } catch (e) {}
        }
        // 5) hech narsa yo'q — orqaga o'tish
        if (history.length > 1) { history.back(); return true; }
        return false;
    }

    // ---- Enter: fokusdagi elementni bosish ----------------------------
    /** Kiritish maydoni turi (checkbox/radio YO'Q — ular navigatsiyaga xalaqit bermaydi). */
    function textFieldType(tag, t) {
        if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (tag !== 'INPUT') return false;
        var ty = String(t.getAttribute('type') || 'text').toLowerCase();
        return ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].indexOf(ty) >= 0;
    }

    /** Fikusiylangan element boshqariladigan checkbox/radio yoki switch bo'lsa true. */
    function toggleable(el) {
        if (!el) return false;
        var tag = (el.tagName || '').toUpperCase();
        if (tag !== 'INPUT') return false;
        var ty = String(el.getAttribute('type') || 'text').toLowerCase();
        return ty === 'checkbox' || ty === 'radio';
    }

    function activate() {
        var el = document.activeElement;
        if (!el) return false;
        var tag = (el.tagName || '').toUpperCase();
        // checkbox/radio: Enter bosilsa holat o'zgaradi (pult OK).
        if (toggleable(el)) {
            try { el.click(); } catch (e) {}
            return true;
        }
        if (textFieldType(tag, el)) return false;
        // `<a>` va `<button>` brauzer o'zi bosadi; boshqalar uchun click.
        if (tag !== 'A' && tag !== 'BUTTON') {
            try { el.click(); } catch (e) {}
        }
        return true;
    }

    // ---- klaviatura / pult hodisalari ---------------------------------
    function typing() {
        var t = document.activeElement || {};
        var tag = (t.tagName || '').toUpperCase();
        if (t.isContentEditable) return true;
        return textFieldType(tag, t);
    }

    function onKey(e) {
        if (!on) return;                                  // TV rejimi o'chiq
        // Reels sahifasi o'z vertikal swipe navigatsiyasiga ega.
        if (document.body.classList.contains('reels-body') && !e.altKey) return;

        var k = e.key;
        var isBack = (k === 'Escape' || k === 'Backspace'
                   || k === 'GoBack' || k === 'BrowserBack' || k === 'XF86Back');

        // Matn yozilayotgan bo'lsa — faqat Esc ishlaydi.
        if (typing()) {
            if (k === 'Escape') { try { document.activeElement.blur(); } catch (err) {} }
            return;
        }

        if (isBack) {
            // INPUT bo'sh bo'lsa — Backspace bilan orqaga (boshqa holatda
            // matnni o'chirish).
            if (k === 'Backspace') return;
            if (goBack()) e.preventDefault();
            return;
        }

        if (k === 'Enter' || k === 'MediaPlayPause') {
            if (activate()) e.preventDefault();
            return;
        }
        if (k === ' ' || k === 'Spacebar') {
            // Bo'sh joy — "yorug'lik" (pultdagi OK) o'rniga.
            if (activate()) e.preventDefault();
            return;
        }

        var dir = k === 'ArrowLeft' ? 'left'
                : k === 'ArrowRight' ? 'right'
                : k === 'ArrowUp' ? 'up'
                : k === 'ArrowDown' ? 'down'
                : null;
        if (!dir) return;
        e.preventDefault();
        move(dir);
    }

    // ==================================================================
    //  4) ISHGA TUSHISH
    // ==================================================================

    /** Boshlanishida fokus biror joyda bo'lishi kerak (pult darhol ishlashi). */
    function initFocus() {
        setTimeout(function () {
            if (!on) return;
            var cur = document.activeElement;
            if (cur && cur !== document.body && cur !== document.documentElement
                && scope().indexOf(cur) !== -1) return;
            // Avval yon panelning faol elementi, keyin kartalar.
            // Muhim: `visible()` tekshiruvi — mobil ko'rinishda yon panel
            // yashiringan bo'lsa, fokus ko'rinmaydigan elementga tushib qolmasin.
            var pref = [
                '#igSide .ig-item.active',
                '#igSide .ig-item',
                '.row .grid .yt-card',
                '.yt-card',
                '.ig-item'
            ];
            for (var i = 0; i < pref.length; i++) {
                var list = all().filter(function (el) { return el.matches(pref[i]); });
                if (list.length) { focusEl(list[0]); return; }
            }
            var any = all();
            if (any.length) focusEl(any[0]);
        }, 300);
    }

    function boot() {
        platform = detectPlatform();
        apply(initial(), true);

        document.addEventListener('keydown', onKey, true);

        // Sichqoncha bilan boshqa joyga bosilganda `.tv-focus` tozalanadi
        // (aks holda eski karta yorqib turib qoladi).
        document.addEventListener('focusout', function (e) {
            var el = e.target;
            if (!el || !el.classList) return;
            setTimeout(function () {
                var a = document.activeElement;
                if (a && el.contains && el.contains(a)) return;
                el.classList.remove('tv-focus');
            }, 0);
        }, true);

        // Modal ochilganda fokusni unga olib kirish.
        document.addEventListener('wc:modalOpen', function () {
            setTimeout(function () {
                var m = document.getElementById('modal');
                if (!m || m.hidden) return;
                var list = scope();
                if (list.length) focusEl(list[0]);
            }, 50);
        });

        // `tv-mode.js` sahifa oxirida yuklanadi — `DOMContentLoaded` allaqachon
        // bo'lib bo'lgan bo'lishi mumkin, shuning uchun holatni tekshiramiz.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initFocus);
        } else {
            initFocus();
        }

        // Pultda "qaytish" tugmasi ba'zi brauzerlarda `history`ni o'zgartiradi.
        global.addEventListener('popstate', function () {
            if (on) setTimeout(function () { refresh(); }, 0);
        });

        // Sahifa o'zgarganda yangi elementlarni tikish (∞ scroll).
        global.addEventListener('wc:domUpdate', refresh);
    }

    var TvMode = {
        detect: detect,
        detectPlatform: detectPlatform,
        platforms: PLATFORMS,
        isTv: isTv,
        platform: platformName,
        enable: enable,
        disable: disable,
        toggle: toggle,
        apply: apply,
        onChange: onChange
    };

    var TvSpatial = {
        move: move,
        focus: focusEl,
        all: all,
        scope: scope,
        refresh: refresh,
        goBack: goBack,
        activate: activate
    };

    global.TvMode = TvMode;
    global.TvSpatial = TvSpatial;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(window);
