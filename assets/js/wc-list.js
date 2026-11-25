/* ============================================================================
 * wc-list.js — Tarix / Saqlanganlar / Keyinroq ko'rish (UMUMIY ro'yxat)
 * ============================================================================
 * Faqat ro'yxat/kartochka UI. Video oqimiga, tg-stream.js/player.js ga tegmaydi.
 *
 * Manbalar:
 *   - server: <script id="wcServerData"> (PHP tomonidan tayyorlangan)
 *   - brauzer: WCLib bucketlari (history / saved / later)
 *   - reels:   api/reels.php?sort=saved (faqat "Saqlanganlar" sahifasi)
 *
 * O'chirish va "to'xtatib turish" mahalliy kuzatuv ro'yxati bilan ishlaydi:
 * serverda tarixni o'chirish API'si yo'qligi uchun yozuvlar shu brauzerda
 * yashiriladi. WCLib.sync() ularni qayta qo'shib qo'ysa ham filter ishlaydi.
 * ========================================================================== */
(function () {
    'use strict';

    var body   = document.body;
    var kind   = body.getAttribute('data-wc-list') || 'history';
    var listEl = document.getElementById('wcList');
    var emptyEl = document.getElementById('wcEmpty');
    var countEl = document.getElementById('wcCount');
    var searchEl = document.getElementById('wcSearch');
    if (!listEl) return;

    var W = window.WCLib;
    var owner = (W && typeof W.owner === 'function') ? W.owner() : 'anon';
    var bucket = kind === 'saved' ? 'saved' : (kind === 'later' ? 'later' : 'history');

    var HIDDEN_KEY = 'wc_list_hidden_v1:' + owner + ':' + kind;
    var PAUSE_KEY  = 'wc_list_paused_v1:' + owner;
    var QUEUE_KEY  = 'wc_list_queue_v1:' + owner + ':' + kind;

    var server = [];
    try {
        var raw = document.getElementById('wcServerData');
        var parsed = raw ? JSON.parse(raw.textContent || '[]') : [];
        if (Array.isArray(parsed)) server = parsed;
    } catch (e) { server = []; }

    var state = { query: '', reels: [], pausedAt: 0 };

    // ---------------------------------------------------------------- yordamchi
    function storageGet(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key) || '') || fallback; }
        catch (e) { return fallback; }
    }
    function storageSet(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }
    function hidden() { return storageGet(HIDDEN_KEY, {}); }
    function setHidden(map) { storageSet(HIDDEN_KEY, map); }

    function keyOf(it) { return (it.type || 'content') + '|' + String(it.id); }

    function asTime(v) {
        if (typeof v === 'string' && !/^\d+$/.test(v)) {
            var parsed = Date.parse(v);       // API ba'zan ISO sana qaytaradi
            return isNaN(parsed) ? 0 : parsed;
        }
        var n = Number(v) || 0;
        if (n > 0 && n < 1e11) n *= 1000;   // ba'zi manbalar sekund beradi
        return n;
    }
    function safeText(v) { return String(v == null ? '' : v); }

    function fmtDur(sec) {
        sec = Math.max(0, Math.floor(Number(sec) || 0));
        if (!sec) return '';
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        return h > 0
            ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
            : m + ':' + String(s).padStart(2, '0');
    }

    function fmtDate(ms) {
        try {
            return new Date(ms).toLocaleDateString('uz-UZ', {
                day: 'numeric', month: 'short', year: 'numeric'
            });
        } catch (e) { return ''; }
    }

    function toast(text, isErr) {
        var t = document.getElementById('wcToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'wcToast';
            t.setAttribute('role', 'status');
            t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);'
                + 'z-index:9999;max-width:88vw;padding:10px 16px;border-radius:999px;'
                + 'background:#fff;color:#000;font:600 13px/1.3 inherit;'
                + 'box-shadow:0 6px 24px rgba(0,0,0,.45)';
            document.body.appendChild(t);
        }
        t.style.background = isErr ? '#000' : '#fff';
        t.style.color = isErr ? '#fff' : '#000';
        t.style.border = isErr ? '1px solid #fff' : '1px solid #000';
        t.textContent = text;
        clearTimeout(toast._t);
        toast._t = setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
    }

    // ------------------------------------------------------------ manbalarni yig'ish
    function fromServer(src) {
        var type = src.type === 'reel' ? 'reel' : 'content';
        var id = src.id;
        var realId = type === 'reel' ? String(id).replace(/^reel_/, '') : String(id);
        var url = type === 'reel'
            ? 'reels.php?reel=' + encodeURIComponent(realId)
            : 'watch.php?c=' + encodeURIComponent(id)
                + (Number(src.episode_id) > 0 ? '&e=' + encodeURIComponent(src.episode_id) : '');
        return {
            type: type,
            id: String(id),
            url: url,
            title: safeText(src.title) || (type === 'reel' ? 'Reels' : 'Kontent'),
            poster: safeText(src.poster),
            category: safeText(src.category),
            year: safeText(src.year),
            desc: safeText(src.desc || src.description),
            episode: safeText(src.episode),
            duration: Number(src.duration) || 0,
            position: Number(src.position) || 0,
            at: asTime(src.at),
            reelId: type === 'reel' ? Number(realId) : 0,
            saved: src.saved !== false,
            fromServer: true
        };
    }

    function fromLocal(src) {
        var id = String(src.id == null ? '' : src.id);
        if (!id) return null;
        // Reels mahalliy saqlanganlar ichida "reel_123" shaklida bo'lishi mumkin.
        var isReel = id.indexOf('reel_') === 0 || String(src.type) === 'reel';
        var realId = isReel ? id.replace(/^reel_/, '') : id;
        return {
            type: isReel ? 'reel' : 'content',
            id: isReel ? 'reel_' + realId : id,
            url: isReel
                ? 'reels.php?reel=' + encodeURIComponent(realId)
                : 'watch.php?c=' + encodeURIComponent(realId),
            title: safeText(src.title) || (isReel ? 'Reels' : 'Kontent'),
            poster: safeText(src.poster),
            category: safeText(src.category),
            year: safeText(src.year),
            desc: safeText(src.desc || src.description),
            episode: '',
            duration: Number(src.duration) || 0,
            position: Number(src.position) || 0,
            at: asTime(src.at) || Date.now(),
            reelId: isReel ? Number(realId) : 0,
            saved: true,
            fromServer: false
        };
    }

    function collect() {
        var byKey = {};
        var order = [];
        var h = hidden();

        function put(it) {
            if (!it) return;
            var k = keyOf(it);
            if (h[k]) return;                       // foydalanuvchi o'chirgan
            if (kind === 'history' && state.pausedAt && it.at > state.pausedAt) return;
            if (!byKey[k]) { byKey[k] = it; order.push(k); }
            else {
                // Server ma'lumoti boyroq (qism, davomiylik, progress).
                var old = byKey[k];
                if (it.fromServer && !old.fromServer) {
                    it.at = old.at || it.at;
                    byKey[k] = it;
                } else if (!it.fromServer && old.fromServer) {
                    old.position = old.position || it.position;
                    old.duration = old.duration || it.duration;
                }
            }
        }

        server.forEach(function (s) { put(fromServer(s)); });
        if (W && typeof W.list === 'function') {
            try {
                (W.list(bucket) || []).forEach(function (x) { put(fromLocal(x)); });
            } catch (e) {}
        }
        state.reels.forEach(function (s) { put(fromServer(s)); });

        var out = order.map(function (k) { return byKey[k]; });
        out.sort(function (a, b) { return b.at - a.at; });

        var q = state.query.trim().toLocaleLowerCase();
        if (q) {
            out = out.filter(function (it) {
                return [it.title, it.category, it.episode, it.desc, it.year]
                    .join(' ').toLocaleLowerCase().indexOf(q) >= 0;
            });
        }
        return out;
    }

    // ------------------------------------------------------------------ renderer
    function dayKey(ms) {
        var d = new Date(ms);
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }
    function groupOf(it) {
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        var yesterday = today - 86400000;
        var mondayOffset = (now.getDay() + 6) % 7;
        var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset).getTime();
        if (kind === 'history') {
            if (it.at >= today) return 'Bugun';
            if (it.at >= yesterday) return 'Kecha';
            if (it.at >= monday) return 'Shu hafta';
            return 'Oldingilar';
        }
        if (kind === 'saved') return it.type === 'reel' ? 'Reels' : 'Filmlar';
        return '';
    }

    function rowFor(it) {
        var row = document.createElement('div');
        row.className = 'wcl-row';

        var thumb = document.createElement('a');
        thumb.className = 'wcl-thumb';
        thumb.href = it.url;                       // faqat biz yasagan ichki URL
        thumb.setAttribute('aria-label', it.title);

        var ph = document.createElement('div');
        ph.className = 'wcl-ph';
        ph.textContent = it.type === 'reel' ? '\u25B6' : '\uD83C\uDFAC';
        thumb.appendChild(ph);

        // Olingan video kadri (WCLib.frames) bo'lsa — uni ishlatamiz; aks
        // holda server poster'i. Ikkalasini birga qo'yib ustma-ust tushirmaymiz.
        var frame = (W && W.frames && typeof W.frames.get === 'function' && it.type !== 'reel')
            ? W.frames.get(it.id) : '';
        var imgSrc = frame || it.poster;
        if (imgSrc) {
            var img = document.createElement('img');
            img.loading = 'lazy';
            img.decoding = 'async';
            img.alt = '';
            img.src = imgSrc;
            img.onload = function () { ph.hidden = true; ph.style.display = 'none'; };
            img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
            thumb.appendChild(img);
        }

        var dur = fmtDur(it.duration);
        if (dur) {
            var d = document.createElement('span');
            d.className = 'wcl-dur';
            d.textContent = dur;
            thumb.appendChild(d);
        }
        if (it.duration > 0 && it.position > 0) {
            var bar = document.createElement('span');
            bar.className = 'wcl-prog';
            var fill = document.createElement('i');
            var pct = Math.min(100, Math.max(0, it.position / it.duration * 100));
            fill.style.width = pct.toFixed(1) + '%';
            bar.appendChild(fill);
            thumb.appendChild(bar);
        }
        row.appendChild(thumb);

        var info = document.createElement('a');
        info.className = 'wcl-body';
        info.href = it.url;

        var title = document.createElement('div');
        title.className = 'wcl-title';
        title.textContent = it.title;
        info.appendChild(title);

        var metaBits = [];
        if (it.episode) metaBits.push(it.episode);
        if (it.category) metaBits.push(it.category);
        if (it.year) metaBits.push(it.year);
        if (it.type === 'reel') metaBits.push('Reels');
        if (!metaBits.length && it.at) metaBits.push(fmtDate(it.at));
        if (metaBits.length) {
            var meta = document.createElement('div');
            meta.className = 'wcl-meta';
            meta.textContent = metaBits.join(' \u00b7 ');
            info.appendChild(meta);
        }
        if (it.desc) {
            var desc = document.createElement('div');
            desc.className = 'wcl-desc';
            desc.textContent = it.desc;
            info.appendChild(desc);
        }
        row.appendChild(info);

        var x = document.createElement('button');
        x.type = 'button';
        x.className = 'wcl-x';
        x.title = 'Ro\'yxatdan olib tashlash';
        x.setAttribute('aria-label', x.title);
        x.textContent = '\u2715';
        x.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            removeItem(it, x);
        });
        row.appendChild(x);
        return row;
    }

    function render() {
        var items = collect();
        listEl.innerHTML = '';
        if (countEl) {
            countEl.textContent = items.length
                ? items.length + ' ta'
                : (state.pausedAt ? 'To‘xtatib turildi' : '');
        }
        if (emptyEl) emptyEl.hidden = items.length > 0;

        var groups = [];
        items.forEach(function (it) {
            var name = groupOf(it);
            var g = groups.filter(function (x) { return x.name === name; })[0];
            if (!g) { g = { name: name, items: [] }; groups.push(g); }
            g.items.push(it);
        });

        groups.forEach(function (g) {
            if (g.name) {
                var h = document.createElement('div');
                h.className = 'wcl-group';
                h.textContent = g.name;
                listEl.appendChild(h);
            }
            g.items.forEach(function (it) { listEl.appendChild(rowFor(it)); });
        });
    }

    // ------------------------------------------------------------------ amallar
    function markHidden(it) {
        var h = hidden();
        h[keyOf(it)] = Date.now();
        setHidden(h);
    }
    function clearLocalBucket(which) {
        try {
            var all = JSON.parse(localStorage.getItem('wc_lib_v1') || '{}') || {};
            if (all[owner] && typeof all[owner] === 'object') all[owner][which] = [];
            localStorage.setItem('wc_lib_v1', JSON.stringify(all));
        } catch (e) {}
    }

    function removeItem(it, btn) {
        if (btn) btn.disabled = true;
        markHidden(it);

        if (it.type === 'reel') {
            // Reels bookmark: mavjud `action=save` toggle (POST bilan).
            var qs = new URLSearchParams({ id: String(it.reelId), action: 'save' });
            var me = '';
            try { me = localStorage.getItem('wc_tg_me_v1') || ''; } catch (e) {}
            if (me) qs.set('tg_me', me);
            fetch('api/reels.php?' + qs.toString(), {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            }).then(function (r) { return r.ok ? r.json() : null; })
              .then(function (d) {
                  if (d && d.success) toast('Reels saqlanganlardan olib tashlandi');
                  else toast('Faqat shu ro‘yxatdan yashirildi', true);
                  render();
              }).catch(function () { toast('Faqat shu ro‘yxatdan yashirildi', true); render(); });
            return;
        }

        // Film: WCLib mahalliy yozuvni o'chiradi va serverga qo'shishni
        // navbatga qo'yadi (api/library-sync.php saqlanganlar uchun o'chirishni
        // qo'llab-quvvatlaydi). Keyin darhol sinxronlashtiramiz.
        if (W && typeof W.remove === 'function') {
            try { W.remove(bucket, it.id); } catch (e) {}
        }
        if (bucket !== 'history' && W && typeof W.sync === 'function') {
            try { W.sync(); } catch (e) {}
        }
        toast('Ro‘yxatdan olib tashlandi');
        render();
    }

    function orderedForPlay(shuffle) {
        var arr = collect().slice();
        if (shuffle) {
            for (var i = arr.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
            }
        }
        return arr;
    }
    function play(shuffle) {
        var arr = orderedForPlay(shuffle);
        storageSet(QUEUE_KEY, arr.map(function (it) { return it.url; }));
        if (!arr.length) { toast('Ijro etish uchun video yo‘q', true); return; }
        // Mavjud player URL'lari — yangi stream mexanizmi ixtiro qilmaymiz.
        window.location.href = arr[0].url;
    }

    function bind(id, fn) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    }

    if (searchEl) {
        searchEl.addEventListener('input', function () {
            state.query = searchEl.value || '';
            render();
        });
    }
    bind('wcPlayAll', function () { play(false); });
    bind('wcShuffle', function () { play(true); });

    if (kind === 'history') {
        var pauseBtn = document.getElementById('wcPause');
        state.pausedAt = Number(storageGet(PAUSE_KEY, 0)) || 0;

        function paintPause() {
            if (!pauseBtn) return;
            var on = !!state.pausedAt;
            pauseBtn.classList.toggle('on', on);
            pauseBtn.textContent = on ? '\u25B6 Tarixni davom ettirish'
                                      : '\u275A\u275A Tarixni to‘xtatib turish';
        }
        if (pauseBtn) {
            pauseBtn.addEventListener('click', function () {
                if (state.pausedAt) {
                    storageSet(PAUSE_KEY, 0);
                    state.pausedAt = 0;
                    toast('Tarix ko‘rsatilishi davom etadi');
                } else {
                    state.pausedAt = Date.now();
                    storageSet(PAUSE_KEY, state.pausedAt);
                    toast('Tarix shu vaqtdan to‘xtatildi (faqat shu brauzerda)');
                }
                paintPause();
                render();
            });
        }
        paintPause();

        bind('wcClear', function () {
            var visible = collect();
            if (!visible.length) { toast('Tozalash uchun tarix yo‘q', true); return; }
            if (!window.confirm('Butun tarixni shu brauzerda yashirishni tasdiqlaysizmi?')) return;
            visible.forEach(markHidden);
            clearLocalBucket('history');
            toast('Tarix shu brauzerda tozalandi');
            render();
        });
    }

    if (kind === 'later') {
        bind('wcClear', function () {
            if (!window.confirm('Keyinroq ko‘rish ro‘yxatini tozalashni tasdiqlaysizmi?')) return;
            collect().forEach(markHidden);
            clearLocalBucket('later');
            toast('Ro‘yxat tozalandi');
            render();
        });
    }

    // Saqlangan Reels: mavjud api/reels.php?sort=saved (tg_me bilan).
    if (kind === 'saved') {
        try {
            var qs = new URLSearchParams({ sort: 'saved', limit: 60, offset: 0 });
            var meRaw = '';
            try { meRaw = localStorage.getItem('wc_tg_me_v1') || ''; } catch (e) {}
            if (meRaw) qs.set('tg_me', meRaw);
            fetch('api/reels.php?' + qs.toString(), {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            }).then(function (r) { return r.ok ? r.json() : null; })
              .then(function (d) {
                  var items = (d && Array.isArray(d.items)) ? d.items : [];
                  state.reels = items.filter(function (r) {
                      return r && Number(r.id) > 0;
                  }).map(function (r) {
                      return {
                          type: 'reel',
                          id: 'reel_' + r.id,
                          title: r.title || r.description || 'Reels',
                          poster: r.poster || '',
                          category: r.author ? (r.author.name || '') : '',
                          desc: r.description || '',
                          duration: r.duration || 0,
                          at: r.created_at || Date.now(),
                          saved: true
                      };
                  });
                  render();
              }).catch(function () { /* reels bo'limi ixtiyoriy */ });
        } catch (e) {}
    }

    // WCLib serverdan ma'lumot qaytarganda qayta chizamiz (yashirish filteri
    // saqlanadi) — MTProto foydalanuvchisi ham ikki manbani bir ko'radi.
    try {
        window.addEventListener('wc:library', render);
        document.addEventListener('wc:watchState', render);
    } catch (e) {}

    render();
})();
