/* ==========================================================================
 * tv-watch.js — watch.php uchun TELEVIZOR pulti boshqaruvi
 * --------------------------------------------------------------------------
 * FAQAT `html.tv-mode` bo'lganda ishlaydi (tv-head.php / tv-mode.js qo'yadi).
 * Telefon va kompyuterda hech narsa o'zgarmaydi.
 *
 * Pult tugmalari (YouTube TV'ga o'xshash):
 *   Boshqaruv YASHIRIN bo'lganda
 *     OK / Enter ........ pauza / davom
 *     <- / -> ........... -10 / +10 soniya
 *     ^ / v ............. boshqaruv panelini chiqaradi
 *   Panel KO'RINIB turganda
 *     <- / -> ........... tugmalar orasida yurish, OK = bosish
 *     ^ ................. panelni yashirish
 *     v (2-marta) ....... videoning TAGIDAGI QATORLAR (tray) ochiladi:
 *                           1-qator: shu serialning qismlari (gorizontal)
 *                           2-qator: boshqa animelar
 *                           3-qator: kinolar
 *                           4-qator: multfilmlar
 *   Qatorlarda: <- / -> = qator ichida, ^ / v = qatorlar orasida,
 *               OK = ochish, Orqaga = yopish (yuqoriga chiqsa ham yopiladi)
 *   Orqaga: panel/qatorlar ochiq bo'lsa yopadi, bo'lmasa sahifadan chiqadi.
 *   Media tugmalari: play / pause / play-pause / oldinga / orqaga / keyingi.
 *
 * Samsung (Tizen) va LG (webOS) pultlari ko'pincha `e.key` o'rniga faqat
 * `keyCode` yuboradi — shuning uchun ikkalasi ham hisobga olinadi.
 *
 * Ushlash `window` da (capture) bajariladi: u `tv-mode.js` ning umumiy
 * fokus surish qismidan OLDIN ishlaydi va qayta ishlangan tugmani to'xtatadi.
 * ========================================================================== */
(function (global) {
    'use strict';

    var doc = document;
    var html = doc.documentElement;

    // Qatorlar (qismlardan keyin) — kerak bo'lsa shu yerga qo'shing.
    var ROWS = [
        { cat: 'anime',    title: 'Boshqa animelar' },
        { cat: 'kino',     title: 'Kinolar' },
        { cat: 'multfilm', title: 'Multfilmlar' }
    ];
    var ROW_LIMIT = 20;
    var DOUBLE_DOWN_MS = 5000;     // ikkinchi "pastga" shu vaqt ichida bo'lsa qatorlar ochiladi

    function isTv() { return html.classList.contains('tv-mode'); }

    function player() {
        var list = global.UzPlayer && global.UzPlayer.instances;
        return (list && list.length) ? list[list.length - 1] : null;
    }
    function ctl() { return global.UzPlayer && global.UzPlayer.ctl; }

    // ---------------------------------------------------------------- tugmalar
    var CODES = {
        13: 'ok', 32: 'playpause',
        37: 'left', 38: 'up', 39: 'right', 40: 'down',
        27: 'back', 8: 'back',
        10009: 'back', 461: 'back', 166: 'back', 4: 'back',
        415: 'play', 19: 'pause', 10252: 'playpause', 179: 'playpause',
        417: 'ff', 228: 'ff', 412: 'rw', 227: 'rw',
        176: 'next', 177: 'prev'
    };
    var KEYS = {
        'Enter': 'ok', ' ': 'playpause', 'Spacebar': 'playpause',
        'ArrowLeft': 'left', 'ArrowRight': 'right', 'ArrowUp': 'up', 'ArrowDown': 'down',
        'Escape': 'back', 'Backspace': 'back', 'GoBack': 'back',
        'BrowserBack': 'back', 'XF86Back': 'back',
        'MediaPlayPause': 'playpause', 'MediaPlay': 'play', 'MediaPause': 'pause',
        'MediaFastForward': 'ff', 'MediaRewind': 'rw',
        'MediaTrackNext': 'next', 'MediaTrackPrevious': 'prev'
    };

    function action(e) {
        var a = KEYS[e.key];
        if (a) return a;
        return CODES[e.keyCode || e.which] || null;
    }

    function typing(t) {
        if (!t || !t.tagName) return false;
        var tag = String(t.tagName).toUpperCase();
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
    }

    function shown(el) {
        if (!el || !el.getClientRects || !el.getClientRects().length) return false;
        if (el.closest('[hidden]')) return false;
        var cs;
        try { cs = getComputedStyle(el); } catch (e) { return false; }
        return !!cs && cs.visibility !== 'hidden' && cs.display !== 'none';
    }

    function focusEl(el) {
        if (!el) return;
        try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
    }

    function reveal(el) {
        try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); } catch (e) {}
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    function fmtTime(sec) {
        sec = Math.max(0, Math.floor(Number(sec) || 0));
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        var mm = (h ? ('0' + m).slice(-2) : String(m));
        return (h ? h + ':' : '') + mm + ':' + ('0' + s).slice(-2);
    }

    function emojiFor(slug) {
        var m = { anime: '🎌', kino: '🎬', multfilm: '🎨', serial: '📺', dokumental: '📹' };
        return m[slug] || '🎞️';
    }

    function currentId() {
        try { return Number(new URLSearchParams(global.location.search).get('c')) || 0; } catch (e) { return 0; }
    }

    // ---------------------------------------------------------------- QATORLAR (tray)
    var tray = null;             // #tvTray
    var rowsData = {};           // cat -> [items] | 'err'
    var rowsLoading = false;
    var rowsLoaded = false;

    function trayOpen() { return doc.body.classList.contains('tv-tray-open'); }

    function apiItems(j) {
        var d = (j && j.data) ? j.data : j;
        return (d && d.items) ? d.items : [];
    }

    function loadRows() {
        if (rowsLoaded || rowsLoading) return;
        rowsLoading = true;
        var pending = ROWS.length;
        ROWS.forEach(function (r) {
            var url = 'api/catalog.php?category=' + encodeURIComponent(r.cat) + '&limit=' + ROW_LIMIT + '&sort=new';
            fetch(url, { credentials: 'same-origin' })
                .then(function (res) { return res.json(); })
                .then(function (j) { rowsData[r.cat] = apiItems(j); })
                .catch(function () { rowsData[r.cat] = 'err'; })
                .then(function () {
                    pending--;
                    if (pending <= 0) { rowsLoading = false; rowsLoaded = true; }
                    if (tray) renderTray(false);
                });
        });
    }

    function ensureTray() {
        if (tray) return tray;
        tray = doc.createElement('div');
        tray.id = 'tvTray';
        tray.className = 'tv-tray';
        tray.setAttribute('role', 'dialog');
        tray.setAttribute('aria-label', 'Qismlar va tavsiyalar');
        tray.innerHTML = '<div class="tv-tray-scroll" id="tvTrayScroll"></div>';
        doc.body.appendChild(tray);
        tray.addEventListener('click', function (e) {
            var c = e.target && e.target.closest ? e.target.closest('.tv-card') : null;
            if (!c) return;
            if (c.hasAttribute('data-ep')) {
                e.preventDefault();
                var src = doc.querySelector('#watchSideList [data-ep="' + c.getAttribute('data-ep') + '"]');
                if (src) src.click();
                closeTray(player(), true);
            }
        });
        return tray;
    }

    function cardThumb(poster, slug, dur) {
        var fb = '<span class="tv-card-fb">' + emojiFor(slug) + '</span>';
        var img = poster
            ? '<img src="' + esc(poster) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">'
            : '';
        return '<span class="tv-card-thumb">' + fb + img
            + (dur ? '<span class="tv-card-dur">' + esc(fmtTime(dur)) + '</span>' : '')
            + '</span>';
    }

    // 1-qator: shu serialning qismlari (yon paneldagi tayyor ro'yxatdan olinadi)
    function episodesRowHtml() {
        var list = doc.querySelectorAll('#watchSideList .watch-ep');
        if (!list.length) return '';
        var cards = '';
        for (var i = 0; i < list.length; i++) {
            var b = list[i];
            var thumb = b.querySelector('.watch-ep-thumb');
            var num = b.querySelector('.watch-ep-num');
            var ttl = b.querySelector('.watch-ep-ttl');
            var on = b.classList.contains('on');
            cards += '<button type="button" class="tv-card tv-ep' + (on ? ' on' : '') + '" data-ep="' + esc(b.getAttribute('data-ep')) + '">'
                + '<span class="tv-card-thumb">' + (thumb ? thumb.innerHTML : '<span class="tv-card-fb">▶</span>') + '</span>'
                + '<span class="tv-card-ttl">' + esc(num ? num.textContent + '-qism' : '') + '</span>'
                + '<span class="tv-card-meta">' + (on ? '▶ Hozir' : esc(ttl ? ttl.textContent : '')) + '</span>'
                + '</button>';
        }
        return '<section class="tv-row" data-row="eps"><h3>Qismlar</h3><div class="tv-row-track">' + cards + '</div></section>';
    }

    function itemsRowHtml(row) {
        var data = rowsData[row.cat];
        var me = currentId();
        var head = '<section class="tv-row" data-row="' + esc(row.cat) + '"><h3>' + esc(row.title) + '</h3>';
        if (data === undefined) {
            return head + '<div class="tv-row-note">Yuklanmoqda…</div></section>';
        }
        if (data === 'err') return '';
        var cards = '';
        for (var i = 0; i < data.length; i++) {
            var c = data[i];
            if (Number(c.id) === me) continue;
            var meta = [];
            if (c.year) meta.push(c.year);
            if (Number(c.rating) > 0) meta.push('★ ' + Number(c.rating).toFixed(1));
            cards += '<a class="tv-card tv-item" href="watch.php?c=' + esc(c.id) + '">'
                + cardThumb(c.poster, c.category_slug || row.cat, Number(c.duration) > 0 ? c.duration : 0)
                + '<span class="tv-card-ttl">' + esc(c.title) + '</span>'
                + '<span class="tv-card-meta">' + esc(meta.join(' · ')) + '</span>'
                + '</a>';
        }
        if (!cards) return '';
        return head + '<div class="tv-row-track">' + cards + '</div></section>';
    }

    function renderTray(keepFocus) {
        var box = doc.getElementById('tvTrayScroll');
        if (!box) return;
        var ae = doc.activeElement;
        var focusKey = null;
        if (keepFocus !== false && ae && box.contains(ae)) {
            focusKey = ae.getAttribute('data-ep') ? 'ep:' + ae.getAttribute('data-ep') : 'href:' + (ae.getAttribute('href') || '');
        }
        var htmlOut = episodesRowHtml();
        for (var i = 0; i < ROWS.length; i++) htmlOut += itemsRowHtml(ROWS[i]);
        if (!htmlOut) htmlOut = '<div class="tv-row-note">Hozircha hech narsa topilmadi</div>';
        box.innerHTML = htmlOut;
        if (focusKey) {
            var sel = focusKey.indexOf('ep:') === 0
                ? '[data-ep="' + focusKey.slice(3) + '"]'
                : '[href="' + focusKey.slice(5) + '"]';
            var again = box.querySelector(sel);
            if (again) focusEl(again);
        }
    }

    function trayRows() {
        var out = [];
        var tracks = doc.querySelectorAll('#tvTrayScroll .tv-row-track');
        for (var i = 0; i < tracks.length; i++) {
            var cards = tracks[i].querySelectorAll('.tv-card');
            if (cards.length) out.push(Array.prototype.slice.call(cards));
        }
        return out;
    }

    function locate(rows) {
        var ae = doc.activeElement;
        for (var r = 0; r < rows.length; r++) {
            var c = rows[r].indexOf(ae);
            if (c >= 0) return { r: r, c: c };
        }
        return null;
    }

    function openTray(p) {
        ensureTray();
        loadRows();
        renderTray(false);
        if (ctl() && p) ctl().hide(p);
        doc.body.classList.add('tv-tray-open');
        setTimeout(function () {
            var rows = trayRows();
            if (!rows.length) return;
            var on = doc.querySelector('#tvTrayScroll .tv-ep.on');
            var first = on || rows[0][0];
            focusEl(first);
            reveal(first);
        }, 90);
        return true;
    }

    function closeTray(p, noFocus) {
        doc.body.classList.remove('tv-tray-open');
        var ae = doc.activeElement;
        if (ae && tray && tray.contains(ae)) { try { ae.blur(); } catch (e) {} }
        if (p && ctl() && !noFocus) {
            ctl().show(p);
            var bs = barButtons(p);
            if (bs.length) focusEl(bs[0]);
        }
    }

    function trayKey(a, p) {
        var C = ctl();
        var rows = trayRows();
        var pos = locate(rows);

        if (a === 'back') { closeTray(p); return true; }
        if (a === 'playpause') { C.toggle(p); return true; }
        if (a === 'play') { C.play(p); return true; }
        if (a === 'pause') { C.pause(p); return true; }
        if (a === 'ff') { C.seek(p, 10); return true; }
        if (a === 'rw') { C.seek(p, -10); return true; }
        if (!rows.length) return true;

        if (!pos) {                                // fokus yo'qolgan bo'lsa — boshiga
            focusEl(rows[0][0]); reveal(rows[0][0]);
            return true;
        }

        var target = null;
        if (a === 'left') target = rows[pos.r][Math.max(0, pos.c - 1)];
        else if (a === 'right') target = rows[pos.r][Math.min(rows[pos.r].length - 1, pos.c + 1)];
        else if (a === 'down') {
            if (pos.r < rows.length - 1) {
                var rd = rows[pos.r + 1];
                target = rd[Math.min(pos.c, rd.length - 1)];
            }
        } else if (a === 'up') {
            if (pos.r === 0) { closeTray(p); return true; }
            var ru = rows[pos.r - 1];
            target = ru[Math.min(pos.c, ru.length - 1)];
        } else if (a === 'ok') {
            doc.activeElement.click();
            return true;
        } else if (a === 'next' || a === 'prev') {
            return true;
        }
        if (target) { focusEl(target); reveal(target); }
        return true;
    }

    // Keyingi / oldingi qism
    function epStep(dir) {
        var list = doc.querySelectorAll('#watchSideList .watch-ep');
        if (!list.length) return false;
        var cur = -1;
        for (var i = 0; i < list.length; i++) { if (list[i].classList.contains('on')) { cur = i; break; } }
        var to = cur + dir;
        if (cur < 0 || to < 0 || to >= list.length) return false;
        list[to].click();
        return true;
    }

    // ---------------------------------------------------------------- PLAYER
    function barButtons(p) {
        var all = p.root.querySelectorAll('.uzp-bar .uzp-btn');
        var out = [];
        for (var i = 0; i < all.length; i++) { if (shown(all[i])) out.push(all[i]); }
        return out;
    }
    function blurBar(p) {
        var ae = doc.activeElement;
        if (ae && p.root.contains(ae)) { try { ae.blur(); } catch (e) {} }
    }

    function goBack() {
        try { if (global.TvSpatial && global.TvSpatial.goBack()) return true; } catch (e) {}
        if (history.length > 1) { history.back(); return true; }
        return false;
    }

    function menuItems(p) {
        var out = [];
        var list = p.root.querySelectorAll('.uzp-menu:not([hidden]) .uzp-menu-item');
        for (var i = 0; i < list.length; i++) { out.push(list[i]); }
        return out;
    }

    function menuKey(a, p) {
        var C = ctl();
        if (a === 'playpause' || a === 'play' || a === 'pause' || a === 'ff' || a === 'rw') {
            return playerKey(a, p);
        }
        var items = menuItems(p);
        var ae = doc.activeElement;
        var i = items.indexOf(ae);
        if (a === 'up' || a === 'down') {
            if (!items.length) return true;
            if (i < 0) {
                var on = null;
                for (var k = 0; k < items.length; k++) { if (items[k].classList.contains('on')) { on = items[k]; break; } }
                focusEl(on || items[0]);
                return true;
            }
            focusEl(items[a === 'down' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)]);
            return true;
        }
        if (a === 'ok') {
            if (i >= 0) { items[i].click(); } else if (items.length) { focusEl(items[0]); }
            C.show(p);
            return true;
        }
        if (a === 'back' || a === 'left') {
            var wrap = ae && ae.closest ? ae.closest('.uzp-menu-wrap') : null;
            C.closeMenus(p);
            if (wrap) { var b = wrap.querySelector('.uzp-btn'); if (b) focusEl(b); }
            return true;
        }
        return true;
    }

    var lastDownAt = 0;

    function playerKey(a, p) {
        var C = ctl();
        if (!C) return false;
        var root = p.root;
        var vis = C.isShown(p);
        var ae = doc.activeElement;
        var inBar = !!(ae && root.contains(ae) && ae.closest && ae.closest('.uzp-bar'));

        switch (a) {
            case 'playpause': C.toggle(p); C.show(p); return true;
            case 'play':      C.play(p);   C.show(p); return true;
            case 'pause':     C.pause(p);  C.show(p); return true;
            case 'ff':        C.seek(p, 10);  C.show(p); return true;
            case 'rw':        C.seek(p, -10); C.show(p); return true;
            case 'next':      return epStep(1);
            case 'prev':      return epStep(-1);

            case 'back':
                if (vis) { C.hide(p); blurBar(p); return true; }
                return goBack();

            case 'left':
            case 'right':
                if (vis && inBar) {
                    var btns = barButtons(p);
                    var bi = btns.indexOf(ae.closest('.uzp-btn') || ae);
                    if (bi < 0) focusEl(btns[0]);
                    else focusEl(btns[a === 'left' ? Math.max(0, bi - 1) : Math.min(btns.length - 1, bi + 1)]);
                    C.show(p);
                } else {
                    C.seek(p, a === 'left' ? -10 : 10);
                    C.show(p);
                }
                return true;

            case 'up':
                if (!vis) {
                    C.show(p);
                    var bu = barButtons(p); if (bu.length) focusEl(bu[0]);
                    return true;
                }
                C.hide(p); blurBar(p);
                return true;

            case 'down':
                // 1-bosish: boshqaruv paneli; 2-bosish (5 s ichida yoki panel ko'rinib turganda): qatorlar
                if (vis || (Date.now() - lastDownAt) < DOUBLE_DOWN_MS) {
                    lastDownAt = 0;
                    return openTray(p);
                }
                lastDownAt = Date.now();
                C.show(p);
                var bd = barButtons(p); if (bd.length) focusEl(bd[0]);
                return true;

            case 'ok':
                if (vis && inBar) { try { ae.click(); } catch (e) {} C.show(p); return true; }
                C.toggle(p); C.show(p);
                return true;
        }
        return false;
    }

    // ---------------------------------------------------------------- kirish nuqtasi
    function onKey(e) {
        if (!isTv()) return;
        if (!doc.body || !doc.body.classList.contains('watch-body')) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        var a = action(e);
        if (!a) return;

        var p = player();
        if (!p || !ctl()) return;                    // player yo'q — tv-mode.js o'zi boshqaradi

        if (typing(e.target)) {                      // izoh yozilmoqda
            if (a === 'back' && e.key !== 'Backspace') {
                try { e.target.blur(); } catch (err) {}
                e.preventDefault(); e.stopImmediatePropagation();
            }
            return;
        }

        var done;
        if (trayOpen()) done = trayKey(a, p);
        else if (p.menuOpen) done = menuKey(a, p);
        else done = playerKey(a, p);

        if (done) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }

    // ---------------------------------------------------------------- video ekranni to'ldirishi
    // Televizor ekrani deyarli 16:9. Video nisbati ekran nisbatiga yaqin bo'lsa
    // (+-25%), yon/ust-ost qora chiziqlar chiqmasligi uchun `cover` qo'llanadi;
    // aks holda (4:3, vertikal va hokazo) rasm qirqilmasin deb `contain` qoladi.
    function updateFill(v) {
        if (!v || !v.videoWidth || !v.videoHeight) return;
        var vr = v.videoWidth / v.videoHeight;
        var sr = global.innerWidth / Math.max(1, global.innerHeight);
        var k = vr / sr;
        doc.body.classList.toggle('tv-fill', k > 0.8 && k < 1.25);
    }

    function refreshFill() {
        var p = player();
        if (p && p.video) updateFill(p.video);
    }

    function init() {
        global.addEventListener('keydown', onKey, true);
        // Media hodisalari "ko'tarilmaydi", shuning uchun ushlash (capture) bosqichida eshitamiz.
        doc.addEventListener('loadedmetadata', function (e) {
            if (e.target && e.target.tagName === 'VIDEO') updateFill(e.target);
        }, true);
        global.addEventListener('resize', refreshFill);
        setTimeout(refreshFill, 1500);
        // Qatorlar ma'lumotini oldindan olib qo'yamiz — "pastga"ni bosganda darrov chiqadi.
        if (isTv()) { setTimeout(loadRows, 2500); }
    }

    global.TvWatch = {
        openRows: function () { return openTray(player()); },
        closeRows: function () { closeTray(player()); }
    };

    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
})(window);
