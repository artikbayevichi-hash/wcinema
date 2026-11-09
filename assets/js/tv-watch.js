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
            var action = e.target && e.target.closest ? e.target.closest('[data-tv-action]') : null;
            if (action) {
                e.preventDefault();
                var kind = action.getAttribute('data-tv-action');
                if (kind === 'comments') { openComments(player()); return; }
                if (kind === 'like') {
                    var like = doc.getElementById('actLike');
                    if (like) like.click();
                } else if (kind === 'save') {
                    var save = doc.getElementById('actWatchlist');
                    if (save) {
                        save.click();
                        setTimeout(function () {
                            var item = doc.querySelector('#actSaveMenu [data-go="save"]');
                            if (item) item.click();
                            setTimeout(function () { renderTray(true); }, 120);
                        }, 30);
                    }
                }
                setTimeout(function () { renderTray(true); }, 120);
                return;
            }
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
            focusKey = ae.getAttribute('data-tv-action') ? 'act:' + ae.getAttribute('data-tv-action')
                : ae.getAttribute('data-ep') ? 'ep:' + ae.getAttribute('data-ep')
                : 'href:' + (ae.getAttribute('href') || '');
        }
        var like = doc.getElementById('actLike');
    var save = doc.getElementById('actWatchlist');
    var likeCount = doc.getElementById('actLikeN');
    var liked = !!(like && like.classList.contains('on'));
    var saved = !!(save && save.classList.contains('on'));
    var commentsCount = doc.getElementById('commentsCount');
    var commentsLabel = commentsCount && commentsCount.textContent.trim()
        ? 'Izohlar: ' + commentsCount.textContent.trim()
        : 'Izohlarni ko‘rish yoki yozish';
    var _legacyActionsRow = '<section class="tv-row tv-actions-row"><h3>Ushbu video</h3>'
        + '<div class="tv-row-track tv-action-track">'
            + '<button type="button" class="tv-card tv-action-card' + (liked ? ' on' : '') + '" data-tv-action="like" aria-pressed="' + (liked ? 'true' : 'false') + '">'
            + '<span class="tv-action-icon" aria-hidden="true">👍</span><span class="tv-card-ttl">Yoqdi</span>'
            + '<span class="tv-card-meta">' + esc(likeCount ? likeCount.textContent : 'Yoqdi') + '</span></button>'
        + '<button type="button" class="tv-card tv-action-card' + (saved ? ' on' : '') + '" data-tv-action="save" aria-pressed="' + (saved ? 'true' : 'false') + '">'
        + '<span class="tv-action-icon" aria-hidden="true">🔖</span><span class="tv-card-ttl">Keyinroq ko‘rish</span>'
        + '<span class="tv-card-meta">' + (saved ? 'Saqlanganlar ichida' : 'Saqlanganlarga qo‘shish') + '</span></button>'
        + '<button type="button" class="tv-card tv-action-card" data-tv-action="comments">'
        + '<span class="tv-action-icon" aria-hidden="true">💬</span><span class="tv-card-ttl">Izohlar</span>'
        + '<span class="tv-card-meta">' + esc(commentsLabel) + '</span></button>'
            + '</div></section>' + episodesRowHtml();
        // Amallar (Yoqdi, Saqlash...) endi pleyer panelida; bu yerda qismlar va kutubxona qatorlari.
        var htmlOut = episodesRowHtml() + libRowsHtml();
        for (var i = 0; i < ROWS.length; i++) htmlOut += itemsRowHtml(ROWS[i]);
        if (!htmlOut) htmlOut = '<div class="tv-row-note">Hozircha hech narsa topilmadi</div>';
        box.innerHTML = htmlOut;
        if (focusKey) {
            var sel = focusKey.indexOf('act:') === 0
                ? '[data-tv-action="' + focusKey.slice(4) + '"]'
                : focusKey.indexOf('ep:') === 0
                    ? '[data-ep="' + focusKey.slice(3) + '"]'
                    : '[href="' + focusKey.slice(5) + '"]';
            var again = box.querySelector(sel);
            if (again) focusEl(again);
        }
    }

    function trayRows() {
        var out = [];
        var tracks = doc.querySelectorAll('#tvTrayScroll .tv-action-track, #tvTrayScroll .tv-row-track');
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
        loadSaved();
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

    function commentsOpen() { return doc.body.classList.contains('tv-comments-open'); }

    function openComments(p) {
        if (trayOpen()) closeTray(p, true);
        if (p && ctl()) ctl().hide(p);
        doc.body.classList.add('tv-comments-open');
        setTimeout(function () {
            var input = doc.getElementById('commentInput');
            var first = input || doc.querySelector('.watch-comments-wrap button:not([hidden])');
            if (first && global.TvSpatial) global.TvSpatial.focus(first);
        }, 80);
    }

    function closeComments(p) {
        doc.body.classList.remove('tv-comments-open');
        if (p && ctl()) {
            ctl().show(p);
            setTimeout(function () {
                var buttons = barButtons(p);
                if (buttons.length) focusEl(buttons[0]);
            }, 40);
        }
    }

    function commentsKey(a, p) {
        if (a === 'back') { closeComments(p); return true; }
        if (a === 'playpause' || a === 'play' || a === 'pause' || a === 'ff' || a === 'rw') return playerKey(a, p);
        if (a === 'left' || a === 'right' || a === 'up' || a === 'down') {
            if (global.TvSpatial) global.TvSpatial.move(a);
            return true;
        }
        if (a === 'ok') {
            var active = doc.activeElement;
            if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return true;
            if (active && active.click) active.click();
            return true;
        }
        if (a === 'next' || a === 'prev') return true;
        return false;
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

    // ---------------------------------------------------------------- Yordamchilar
    function cont() { return (global.WATCH && global.WATCH.content) ? global.WATCH.content : null; }

    function fmtN(n) {
        n = Number(n) || 0;
        if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + ' mln';
        if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + ' ming';
        return String(n);
    }

    var tvToastTimer = null;
    function tvToast(msg) {
        var t = doc.getElementById('tvToast');
        if (!t) {
            t = doc.createElement('div');
            t.id = 'tvToast';
            t.className = 'tv-toast';
            t.setAttribute('role', 'status');
            doc.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add('on');
        clearTimeout(tvToastTimer);
        tvToastTimer = setTimeout(function () { t.classList.remove('on'); }, 2600);
    }

    // ---------------------------------------------------------------- PLEYER PANELIDAGI AMALLAR
    // YouTube TV tartibi: sarlavha / vaqt chizig'i / tugmalar qatori
    //   [play] [-10] [+10]   [Yoqdi] [Yoqmadi] [Izohlar] [Saqlash] [Keyinroq]      [tezlik] [sifat] [ovoz]
    var BAR_ICONS = {
        like: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>',
        dislike: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>',
        comments: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>',
        save: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>',
        later: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>'
    };
    var BAR_ACTS = [
        { k: 'like',     label: 'Yoqdi' },
        { k: 'dislike',  label: 'Yoqmadi' },
        { k: 'comments', label: 'Izohlar' },
        { k: 'save',     label: 'Saqlanganlar' },
        { k: 'later',    label: 'Keyinroq ko\u2018rish' }
    ];

    function hasLater() {
        var c = cont();
        return !!(c && global.WCLib && global.WCLib.has('later', c.id));
    }

    function ensureBarActions() {
        if (!isTv()) return;
        var p = player();
        if (!p || !p.root) return;
        var bar = p.root.querySelector('.uzp-bar');
        var rowL = p.root.querySelector('.uzp-row-l');
        if (!bar || !rowL) return;

        if (!bar.querySelector('.tv-bar-title')) {
            var t = doc.createElement('div');
            t.className = 'tv-bar-title';
            t.innerHTML = '<span class="tv-bar-ttl" id="tvBarTtl"></span><span class="tv-bar-sub" id="tvBarSub"></span>';
            bar.insertBefore(t, bar.firstChild);
        }

        if (!bar.querySelector('[data-tv-bar]')) {
            var anchor = rowL.querySelector('[data-act="fwd"]');
            var ref = anchor ? anchor.nextSibling : null;
            BAR_ACTS.forEach(function (a) {
                var b = doc.createElement('button');
                b.type = 'button';
                b.className = 'uzp-btn tv-bar-act';
                b.setAttribute('data-tv-bar', a.k);
                b.setAttribute('aria-label', a.label);
                b.innerHTML = BAR_ICONS[a.k] + '<span class="tv-bar-n"></span>';
                b.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    barAct(a.k);
                });
                rowL.insertBefore(b, ref);
            });
        }
        refreshBarActs();
    }

    function refreshBarActs() {
        var p = player();
        var c = cont();
        if (!p || !p.root || !c) return;

        function set(k, on, txt) {
            var b = p.root.querySelector('[data-tv-bar="' + k + '"]');
            if (!b) return;
            b.classList.toggle('on', !!on);
            if (k !== 'comments') b.setAttribute('aria-pressed', on ? 'true' : 'false');
            var n = b.querySelector('.tv-bar-n');
            if (n && n.textContent !== (txt || '')) n.textContent = txt || '';
            b.classList.toggle('has-n', !!txt);
        }

        var lk = Number(c.likes) || 0;
        set('like', c.has_liked, lk > 0 ? fmtN(lk) : '');
        set('dislike', c.has_disliked, '');
        var cc = doc.getElementById('commentsCount');
        var cn = cc ? Number(String(cc.textContent).replace(/[^\d]/g, '')) : 0;
        set('comments', false, cn > 0 ? fmtN(cn) : '');
        set('save', !!c.in_watchlist, '');
        set('later', hasLater(), '');

        var ttl = doc.getElementById('tvBarTtl');
        var sub = doc.getElementById('tvBarSub');
        if (ttl && ttl.textContent !== (c.title || '')) ttl.textContent = c.title || '';
        if (sub) {
            var ep = doc.querySelector('#watchSideList .watch-ep.on .watch-ep-num');
            var bits = [];
            if (ep && ep.textContent.trim()) bits.push(ep.textContent.trim() + '-qism');
            if (c.year) bits.push(c.year);
            var s = bits.join(' \u00b7 ');
            if (sub.textContent !== s) sub.textContent = s;
        }
    }

    function barAct(k) {
        var p = player();
        var T = global.Watch && global.Watch.tv;
        var c = cont();
        if (k === 'like') {
            var l = doc.getElementById('actLike');
            if (l) l.click();
            setTimeout(function () { if (c) tvToast(c.has_liked ? 'Yoqdi \uD83D\uDC4D' : 'Baho olib tashlandi'); }, 500);
        } else if (k === 'dislike') {
            var d = doc.getElementById('actDislike');
            if (d) d.click();
            setTimeout(function () { if (c) tvToast(c.has_disliked ? 'Yoqmadi deb belgilandi' : 'Baho olib tashlandi'); }, 500);
        } else if (k === 'comments') {
            openComments(p);
            return;
        } else if (k === 'save') {
            if (!T) return;
            T.toggleSaved().then(function (on) {
                tvToast(on ? 'Saqlanganlarga qo\u2018shildi' : 'Saqlanganlardan olib tashlandi');
                loadSaved();
            }).catch(function () { tvToast('Saqlab bo\u2018lmadi'); });
        } else if (k === 'later') {
            if (!T) return;
            var on = T.toggleLater();
            tvToast(on ? 'Keyinroq ko\u2018rishga qo\u2018shildi' : 'Keyinroq ko\u2018rishdan olib tashlandi');
        }
        if (p && ctl()) ctl().show(p);
        setTimeout(refreshBarActs, 350);
        setTimeout(refreshBarActs, 1200);
    }

    // ---------------------------------------------------------------- KUTUBXONA QATORLARI (tray)
    var savedServer = null;          // api/watchlist.php dan olingan ro'yxat

    function loadSaved() {
        var me = '';
        try { me = global.localStorage.getItem('wc_tg_me_v1') || ''; } catch (e) {}
        var url = 'api/watchlist.php' + (me ? '?tg_me=' + encodeURIComponent(me) : '');
        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) { savedServer = j ? apiItems(j) : null; })
            .catch(function () { savedServer = null; })
            .then(function () { if (tray && trayOpen()) renderTray(true); });
    }

    function libItems(kind) {
        var out = [], seen = {};
        function add(c) {
            if (!c || c.id == null) return;
            var k = String(c.id);
            if (seen[k]) return;
            seen[k] = 1;
            out.push(c);
        }
        if (kind === 'saved' && savedServer) savedServer.forEach(add);
        if (global.WCLib) { try { global.WCLib.list(kind).forEach(add); } catch (e) {} }
        return out;
    }

    function libRowHtml(kind, title) {
        var items = libItems(kind);
        var head = '<section class="tv-row" data-row="lib-' + kind + '"><h3>' + esc(title) + '</h3>';
        if (!items.length) return head + '<div class="tv-row-note">Hozircha bo\u2018sh</div></section>';
        var cards = '';
        for (var i = 0; i < items.length && i < 30; i++) {
            var c = items[i];
            var meta = [];
            if (c.year) meta.push(c.year);
            if (Number(c.rating) > 0) meta.push('\u2605 ' + Number(c.rating).toFixed(1));
            else if (c.category) meta.push(c.category);
            cards += '<a class="tv-card tv-item" href="watch.php?c=' + esc(c.id) + '">'
                + cardThumb(c.poster, c.category_slug || '', 0)
                + '<span class="tv-card-ttl">' + esc(c.title) + '</span>'
                + '<span class="tv-card-meta">' + esc(meta.join(' \u00b7 ')) + '</span>'
                + '</a>';
        }
        return head + '<div class="tv-row-track">' + cards + '</div></section>';
    }

    function libRowsHtml() {
        return libRowHtml('liked', 'Yoqqanlar')
             + libRowHtml('saved', 'Saqlanganlar')
             + libRowHtml('later', 'Keyinroq ko\u2018rish');
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
        var onSeek = !!(ae && ae.classList && ae.classList.contains('uzp-seek'));

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
                if (vis && inBar && !onSeek) {
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
                if (inBar && !onSeek) {        // tugmalar qatoridan vaqt chizig'iga (YouTube TV kabi)
                    var sk = root.querySelector('.uzp-seek');
                    if (sk) { focusEl(sk); C.show(p); return true; }
                }
                C.hide(p); blurBar(p);
                return true;

            case 'down':
                if (onSeek) {                  // vaqt chizig'idan tugmalar qatoriga
                    var bb = barButtons(p);
                    if (bb.length) focusEl(bb[0]);
                    C.show(p);
                    return true;
                }
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
                if (vis && inBar && !onSeek) { try { ae.click(); } catch (e) {} C.show(p); return true; }
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
            if (commentsOpen() && (a === 'up' || a === 'down') && global.TvSpatial) {
                global.TvSpatial.move(a);
                e.preventDefault(); e.stopImmediatePropagation();
                return;
            }
            if (a === 'back' && e.key !== 'Backspace') {
                try { e.target.blur(); } catch (err) {}
                e.preventDefault(); e.stopImmediatePropagation();
            }
            return;
        }

        var done;
        if (commentsOpen()) done = commentsKey(a, p);
        else if (trayOpen()) done = trayKey(a, p);
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
        doc.addEventListener('wc:watchVote', function () { if (trayOpen()) renderTray(true); });
        doc.addEventListener('wc:watchSave', function () { if (trayOpen()) renderTray(true); });
        if (isTv()) {
            // Pleyer panelidagi amal tugmalari (Yoqdi / Izohlar / Saqlash...) YouTube TV kabi.
            doc.addEventListener('wc:watchState', function () { refreshBarActs(); if (trayOpen()) renderTray(true); });
            setInterval(ensureBarActions, 1000);
            setTimeout(ensureBarActions, 300);
        }
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
