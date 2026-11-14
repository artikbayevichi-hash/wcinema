/* ==========================================================================
   watch-ambient.js - "Ambient light" (YouTube kengaytmasi kabi) + SOZLAMALAR
   ==========================================================================
   · Harakat tugmalari qatorida «Ambient» (yoqish/o'chirish) va ⚙ (sozlamalar).
   · Sozlamalar paneli (YouTube'dagi Ambient light kengaytmasi kabi):
       - Xiralashtirish (Blur)            0 - 100 %
       - Tarqalish (Spread)               0 - 500 %
       - Silliq o'tish (Fade in)          O'chiq - 5 s
       - Qaysi rejimlarda yoqiladi        Hammasi / Kichik / Keng / To'liq ekran
       - Panel mavzusi                    Yorug' / Standart / Qora
       - Yoqilgan [G]                     klaviaturada G tugmasi ham ishlaydi
   · Video rangiga mos nur pleyer atrofida (va to'liq ekranda qora yon
     chiziqlar o'rnida) chiqadi. Kadrlar ~11 marta/s, faqat video o'ynaganda.
   · Standart holati O'CHIQ. Barcha tanlov brauzerda saqlanadi.
   · Telefon va televizorda o'chiq.

   watch.js / player.js'ga tegmaydi. Qaytarish: watch.php dagi shu skript
   qatorini olib tashlash kifoya.
   ========================================================================== */
(function () {
    'use strict';

    var KEY_ON  = 'wc_ambient';
    var KEY_CFG = 'wc_ambient_cfg';
    var FPS  = 11;
    var STEP = 1000 / FPS;
    var CW   = 64;                       // ichki canvas kengligi (kichik = yengil)
    var WIDE = 900;                      // "Keng" rejim chegarasi (pleyer kengligi, px)

    var DEFAULTS = { blur: 20, spread: 396.8, fade: 0, layout: 0, theme: 1, power: 100 };

    var on = false;
    var cfg = load();
    var canvas = null, ctx = null, player = null, host = null;
    var raf = 0, last = 0, ro = null, shown = false, geo = '', rzT = 0;
    var panel = null, gear = null;

    /* ------------------------------------------------------------ yordamchi */
    function isTV() { return document.documentElement.classList.contains('tv-mode'); }
    function isSmall() {
        try { return window.matchMedia('(max-width: 768px)').matches; } catch (e) { return false; }
    }
    function fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
    function supportedUI() { return !isTV() && !isSmall(); }
    function supported()   { return !isTV() && (!!fsEl() || !isSmall()); }

    function load() {
        var c = {};
        for (var k in DEFAULTS) c[k] = DEFAULTS[k];
        try {
            var j = JSON.parse(localStorage.getItem(KEY_CFG) || '{}');
            for (var k2 in DEFAULTS) if (typeof j[k2] === 'number' && isFinite(j[k2])) c[k2] = j[k2];
        } catch (e) {}
        return c;
    }
    function saveCfg() { try { localStorage.setItem(KEY_CFG, JSON.stringify(cfg)); } catch (e) {} }
    function loadOn()  { try { return localStorage.getItem(KEY_ON) === '1'; } catch (e) { return false; } }
    function saveOn(v) { try { localStorage.setItem(KEY_ON, v ? '1' : '0'); } catch (e) {} }

    function applyVars() {
        var st = document.documentElement.style;
        // Tarqalish: 396.8% ~ pleyerdan ~2.8 marta katta nur (chap panel va pastga yetadi).
        st.setProperty('--wamb-scale', (1 + cfg.spread / 220).toFixed(3));
        st.setProperty('--wamb-blur',  Math.round(cfg.blur * 2.8) + 'px');
        // Kuch: 100% gacha shaffoflik, undan oshsa yorqinlik ham oshadi.
        st.setProperty('--wamb-op',     Math.min(1, cfg.power / 100).toFixed(2));
        st.setProperty('--wamb-bright', (cfg.power > 100 ? 1 + (cfg.power - 100) / 100 * 0.6 : 1).toFixed(2));
    }

    function layoutOK() {
        if (cfg.layout === 0) return true;
        var fs = !!fsEl();
        if (cfg.layout === 3) return fs;
        if (fs || !player) return false;
        var w = player.offsetWidth;
        return cfg.layout === 1 ? w < WIDE : w >= WIDE;
    }

    /* ----------------------------------------------------------- canvas */
    function ensureCanvas() {
        if (canvas) return true;
        canvas = document.createElement('canvas');
        canvas.className = 'wamb-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.width = CW; canvas.height = Math.round(CW * 9 / 16);
        try { ctx = canvas.getContext('2d', { alpha: false }); } catch (e) { ctx = null; }
        if (!ctx) { canvas = null; return false; }
        return true;
    }

    /* Canvasni to'g'ri joyga qo'yadi: odatda pleyer oldiga, to'liq ekranda
       esa to'liq ekran elementi ICHIGA (video ortiga). */
    var layer = null;
    function ensureLayer() {
        if (layer && layer.isConnected) return layer;
        layer = document.createElement('div');
        layer.className = 'wamb-layer';
        layer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(layer);
        return layer;
    }

    function mount() {
        if (!canvas || !player) return;
        var fe = fsEl();
        var inFS = !!(fe && (fe.contains(player) || player.contains(fe)));
        if (inFS) {
            if (canvas.parentNode !== fe) fe.insertBefore(canvas, fe.firstChild);
            canvas.classList.add('wamb-fs');
            if (host !== fe) { if (host) host.classList.remove('wamb-fs-host'); host = fe; }
            fe.classList.add('wamb-fs-host');
        } else {
            if (host) { host.classList.remove('wamb-fs-host'); host = null; }
            canvas.classList.remove('wamb-fs');
            // Nur butun sahifa bo'ylab (chap panel, tavsiyalar, pastki qism) yoyiladi.
            var L = ensureLayer();
            if (canvas.parentNode !== L) L.appendChild(canvas);
            geo = '';
            place();
        }
    }

    /* Nur qatlami butun sahifa bo'yicha cho'ziladi; pleyer o'rni "teshik"
       (mask) bo'lib qoladi - video yorishib ketmaydi. */
    function place() {
        if (!canvas || !player || canvas.classList.contains('wamb-fs')) return;
        var L = ensureLayer();
        var r = player.getBoundingClientRect();
        var sx = window.pageXOffset || 0, sy = window.pageYOffset || 0;
        var x = Math.round(r.left + sx), y = Math.round(r.top + sy);
        var w = Math.round(r.width), h = Math.round(r.height);
        var bb = document.body.getBoundingClientRect();
        var H = Math.max(window.innerHeight, Math.round(bb.bottom + sy));
        var g = x + ',' + y + ',' + w + ',' + h + ',' + H;
        if (g === geo) return;
        geo = g;
        L.style.height = H + 'px';
        L.style.setProperty('--hx', x + 'px');
        L.style.setProperty('--hy', y + 'px');
        L.style.setProperty('--hw', w + 'px');
        L.style.setProperty('--hh', h + 'px');
        canvas.style.left   = x + 'px';
        canvas.style.top    = y + 'px';
        canvas.style.width  = w + 'px';
        canvas.style.height = h + 'px';
    }

    function video() { return player ? player.querySelector('video') : null; }

    function draw(force) {
        if (!ctx || !canvas) return;
        var v = video();
        if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;
        if (!force && (v.paused || v.ended)) return;
        var ch = Math.max(1, Math.round(CW * v.videoHeight / v.videoWidth));
        if (canvas.width !== CW || canvas.height !== ch) { canvas.width = CW; canvas.height = ch; }
        // Silliq o'tish: oldingi kadr ustiga yangisi qisman qo'yiladi.
        var a = (cfg.fade > 0 && shown && !force) ? Math.min(1, STEP / (cfg.fade * 1000)) : 1;
        try {
            ctx.globalAlpha = a;
            ctx.drawImage(v, 0, 0, CW, ch);
            ctx.globalAlpha = 1;
        } catch (e) { return; }
        if (!shown) { shown = true; canvas.classList.add('show'); }
    }

    function tick(t) {
        raf = requestAnimationFrame(tick);
        if (document.hidden || t - last < STEP) return;
        last = t;
        if (canvas && !canvas.isConnected) mount();
        place();
        draw(false);
    }
    function start() { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } }
    function stop()  { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

    /* ----------------------------------------------------------- holat */
    function syncUI() {
        var btn = document.querySelector('.wamb-btn');
        if (btn) {
            btn.classList.toggle('on', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        if (panel) {
            var sw = panel.querySelector('.wamb-switch');
            if (sw) { sw.classList.toggle('on', on); sw.setAttribute('aria-checked', on ? 'true' : 'false'); }
        }
    }

    function apply() {
        syncUI();
        player = document.getElementById('watchPlayer') || player;
        var active = on && supported() && !!player && layoutOK() && ensureCanvas();
        if (active) {
            document.body.classList.add('wamb-on');
            mount();
            start();
            draw(true);
        } else {
            document.body.classList.remove('wamb-on');
            stop();
            shown = false;
            if (canvas) canvas.classList.remove('show');
        }
    }

    function setOn(v) { on = !!v; saveOn(on); apply(); }
    function toggle() { setOn(!on); }

    /* ------------------------------------------------------ sozlamalar paneli */
    var LAYOUTS = ['Hammasi', 'Kichik', 'Keng', 'To‘liq ekran'];
    var THEMES  = ['Yorug‘', 'Standart', 'Qora'];

    function ticks(arr) {
        return '<div class="wamb-ticks">' + arr.map(function (s) { return '<span>' + s + '</span>'; }).join('') + '</div>';
    }

    function buildPanel() {
        if (panel) return panel;
        panel = document.createElement('div');
        panel.className = 'wamb-panel';
        panel.hidden = true;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Ambient yorug‘lik sozlamalari');
        panel.innerHTML =
            '<div class="wamb-sec">Ambient yorug‘lik</div>' +
            '<div class="wamb-row"><div class="wamb-row-h"><span>Xiralashtirish</span><b data-v="blur"></b></div>' +
                '<input class="wamb-range" type="range" data-k="blur" min="0" max="100" step="1"></div>' +
            '<div class="wamb-row"><div class="wamb-row-h"><span>Tarqalish</span><b data-v="spread"></b></div>' +
                '<input class="wamb-range" type="range" data-k="spread" min="0" max="500" step="0.1"></div>' +
            '<div class="wamb-row"><div class="wamb-row-h"><span>Kuch (yorqinlik)</span><b data-v="power"></b></div>' +
                '<input class="wamb-range" type="range" data-k="power" min="0" max="200" step="1"></div>' +
            '<div class="wamb-row"><div class="wamb-row-h"><span>Silliq o‘tish <i class="wamb-q" title="Kadrlar orasidagi rang o‘tishini yumshatadi. «O‘chiq» = har kadr darhol almashadi.">?</i></span><b data-v="fade"></b></div>' +
                '<input class="wamb-range" type="range" data-k="fade" min="0" max="5" step="0.1"></div>' +
            '<div class="wamb-sec">Ko‘rinish rejimlari</div>' +
            '<div class="wamb-row"><div class="wamb-row-h"><span>Qaysi rejimlarda yoqilsin</span><b data-v="layout"></b></div>' +
                '<input class="wamb-range wamb-stops" type="range" data-k="layout" min="0" max="3" step="1">' + ticks(LAYOUTS) + '</div>' +
            '<div class="wamb-sec">Umumiy</div>' +
            '<div class="wamb-row"><div class="wamb-row-h"><span>Panel mavzusi</span><b data-v="theme"></b></div>' +
                '<input class="wamb-range wamb-stops" type="range" data-k="theme" min="0" max="2" step="1">' + ticks(THEMES) + '</div>' +
            '<div class="wamb-row wamb-row-sw"><span>Yoqilgan <kbd>G</kbd></span>' +
                '<button type="button" class="wamb-switch" role="switch" aria-checked="false" aria-label="Ambient yoqilgan"></button></div>' +
            '<div class="wamb-row wamb-row-end"><button type="button" class="wamb-reset">Standart holatga qaytarish</button></div>';
        document.body.appendChild(panel);

        panel.addEventListener('input', function (e) {
            var el = e.target;
            if (!el || !el.getAttribute) return;
            var k = el.getAttribute('data-k');
            if (!k) return;
            cfg[k] = parseFloat(el.value);
            saveCfg();
            refreshPanel();
            applyVars();
            if (k === 'layout' || k === 'fade') apply();
        });
        panel.querySelector('.wamb-switch').addEventListener('click', toggle);
        panel.querySelector('.wamb-reset').addEventListener('click', function () {
            for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
            saveCfg(); refreshPanel(); applyVars(); apply();
        });
        return panel;
    }

    function fmt(k) {
        var v = cfg[k];
        if (k === 'blur')   return Math.round(v) + '%';
        if (k === 'spread') return (Math.round(v * 10) / 10) + '%';
        if (k === 'power')  return Math.round(v) + '%';
        if (k === 'fade')   return v <= 0 ? 'O‘chiq' : v.toFixed(1) + ' s';
        if (k === 'layout') return LAYOUTS[v] || '';
        if (k === 'theme')  return THEMES[v] || '';
        return '';
    }

    function refreshPanel() {
        if (!panel) return;
        panel.setAttribute('data-theme', ['light', 'default', 'dark'][cfg.theme] || 'default');
        var ins = panel.querySelectorAll('.wamb-range');
        for (var i = 0; i < ins.length; i++) {
            var el = ins[i], k = el.getAttribute('data-k');
            el.value = cfg[k];
            var mn = parseFloat(el.min), mx = parseFloat(el.max);
            el.style.setProperty('--p', ((cfg[k] - mn) / (mx - mn) * 100) + '%');
            var lab = panel.querySelector('[data-v="' + k + '"]');
            if (lab) lab.textContent = fmt(k);
        }
        syncUI();
    }

    function openPanel() {
        buildPanel();
        refreshPanel();
        panel.hidden = false;
        var r = (gear || document.body).getBoundingClientRect();
        var w = 300;
        var left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
        panel.style.left = left + 'px';
        panel.style.width = w + 'px';
        if (r.top > 360) {
            panel.style.top = 'auto';
            panel.style.bottom = (window.innerHeight - r.top + 8) + 'px';
            panel.style.maxHeight = (r.top - 16) + 'px';
        } else {
            panel.style.bottom = 'auto';
            panel.style.top = (r.bottom + 8) + 'px';
            panel.style.maxHeight = (window.innerHeight - r.bottom - 16) + 'px';
        }
        if (gear) gear.setAttribute('aria-expanded', 'true');
    }
    function closePanel() {
        if (panel) panel.hidden = true;
        if (gear) gear.setAttribute('aria-expanded', 'false');
    }
    function panelOpen() { return panel && !panel.hidden; }

    /* ----------------------------------------------------------- tugmalar */
    var SVG_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/>' +
        '<path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>';
    var SVG_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/>' +
        '<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

    function ensureBtn() {
        var box = document.getElementById('watchActions');
        if (!box) return;
        var cur = box.querySelector('.wamb-btn');
        if (!supportedUI()) {
            if (cur) cur.remove();
            var g0 = box.querySelector('.wamb-gear'); if (g0) g0.remove();
            closePanel();
            return;
        }
        if (!cur) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'watch-act wamb-btn' + (on ? ' on' : '');
            b.title = 'Ambient yorug‘lik: video rangidagi nur (G)';
            b.setAttribute('aria-label', 'Ambient yorug‘lik');
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
            b.innerHTML = SVG_SUN + '<span class="watch-act-t">Ambient</span>';
            b.addEventListener('click', toggle);
            b.addEventListener('contextmenu', function (e) { e.preventDefault(); panelOpen() ? closePanel() : openPanel(); });
            box.appendChild(b);
        }
        gear = box.querySelector('.wamb-gear');
        if (!gear) {
            gear = document.createElement('button');
            gear.type = 'button';
            gear.className = 'watch-act wamb-gear';
            gear.title = 'Ambient sozlamalari';
            gear.setAttribute('aria-label', 'Ambient sozlamalari');
            gear.setAttribute('aria-haspopup', 'dialog');
            gear.setAttribute('aria-expanded', 'false');
            gear.innerHTML = SVG_GEAR;
            gear.addEventListener('click', function (e) {
                e.stopPropagation();
                panelOpen() ? closePanel() : openPanel();
            });
            box.appendChild(gear);
        }
    }

    /* ------------------------------------------------------------- ishga tushirish */
    function init() {
        on = loadOn();
        applyVars();
        player = document.getElementById('watchPlayer');
        ensureBtn();

        var box = document.getElementById('watchActions');
        if (box && window.MutationObserver) {
            // watch.js tugmalarni qayta chizsa, bizniki ham qaytib turadi.
            new MutationObserver(ensureBtn).observe(box, { childList: true });
        }

        // Pleyer o'lchami o'zgarsa: joylashuv + "Kichik/Keng" rejim qayta tekshiriladi.
        if (player && window.ResizeObserver) {
            ro = new ResizeObserver(function () {
                place();
                clearTimeout(rzT);
                rzT = setTimeout(function () { if (on) apply(); }, 120);
            });
            ro.observe(player);
            ro.observe(document.body);   // sahifa uzunligi o'zgarsa nur ham cho'ziladi
        }

        // Media hodisalari "bubble" qilmaydi - capture bilan ushlaymiz.
        ['play', 'playing', 'seeked', 'loadeddata', 'emptied'].forEach(function (ev) {
            document.addEventListener(ev, function (e) {
                if (!on || !e.target || e.target.tagName !== 'VIDEO') return;
                if (ev === 'emptied') { shown = false; if (canvas) canvas.classList.remove('show'); return; }
                draw(true);
            }, true);
        });

        document.addEventListener('visibilitychange', function () {
            if (!document.hidden && on) draw(true);
        });
        window.addEventListener('resize', function () { geo = ''; ensureBtn(); apply(); });

        // To'liq ekranga kirish/chiqish: nur to'liq ekran ichiga ko'chadi.
        document.addEventListener('fullscreenchange', function () { geo = ''; apply(); });
        document.addEventListener('webkitfullscreenchange', function () { geo = ''; apply(); });

        // Panelni yopish: tashqariga bosish, Esc, sahifa aylanishi.
        document.addEventListener('mousedown', function (e) {
            if (!panelOpen()) return;
            if (panel.contains(e.target) || (gear && gear.contains(e.target))) return;
            closePanel();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && panelOpen()) { closePanel(); return; }
            // «Yoqilgan [G]» - yozish maydonlarida ishlamaydi.
            if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey) {
                var t = e.target, tn = t && t.tagName;
                if (tn === 'INPUT' || tn === 'TEXTAREA' || tn === 'SELECT' || (t && t.isContentEditable)) return;
                if (!supportedUI() && !fsEl()) return;
                toggle();
            }
        });
        window.addEventListener('scroll', function (e) {
            if (panelOpen() && !(panel.contains(e.target))) closePanel();
        }, true);

        apply();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
