/* ==========================================================================
   W CINEMA - katalog interfeysi
   ========================================================================== */
(function () {
    'use strict';

    const APP = window.APP || {};
    const base = APP.base || '';
    const loggedIn = !!APP.userId;

    const $  = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

    const state = {
        category: '',
        genre: 0,
        sort: 'new',
        search: '',
        page: 1,
        loading: false,
        hasMore: false,
        current: null,      // ochiq kontent
        hls: null           // HLS misoli (tozalash uchun)
    };

    // ---------------------------------------------------------------- helper
    async function api(path, opts) {
        const url = base + '/api/' + path;
        const res = await fetch(url, Object.assign({
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin'
        }, opts || {}));

        let data;
        try {
            data = await res.json();
        } catch (e) {
            throw new Error('Server javobi buzildi');
        }
        if (!res.ok && !data.success) {
            const err = new Error(data.message || 'Xato ' + res.status);
            err.status = res.status;
            err.data = data;
            throw err;
        }
        return data;
    }

    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    function fmtViews(n) {
        n = Number(n) || 0;
        if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'K';
        return String(n);
    }

    function fmtTime(sec) {
        sec = Math.max(0, Math.floor(Number(sec) || 0));
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        const p = (n) => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
    }

    // "3 kun oldin" — YouTube uslubidagi nisbiy vaqt. Server `created_at`
    // ni "YYYY-MM-DD HH:MM:SS" (mahalliy vaqt) ko'rinishida beradi.
    function fmtAgo(dateStr) {
        if (!dateStr) return '';
        const t = Date.parse(String(dateStr).replace(' ', 'T'));
        if (isNaN(t)) return '';
        const d = Math.max(0, (Date.now() - t) / 1000);
        const Y = 31536000, MO = 2592000, D = 86400, H = 3600, MI = 60;
        if (d >= Y)  return Math.floor(d / Y) + ' yil oldin';
        if (d >= MO) return Math.floor(d / MO) + ' oy oldin';
        if (d >= D)  return Math.floor(d / D) + ' kun oldin';
        if (d >= H)  return Math.floor(d / H) + ' soat oldin';
        if (d >= MI) return Math.floor(d / MI) + ' daqiqa oldin';
        return 'hozirgina';
    }

    function toast(msg, type) {
        let wrap = $('.toast-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'toast-wrap';
            document.body.appendChild(wrap);
        }
        const t = document.createElement('div');
        t.className = 'toast ' + (type || '');
        t.innerHTML = msg;
        wrap.appendChild(t);
        setTimeout(() => t.remove(), type === 'err' ? 6000 : 3500);
    }

    function setLoading(on) {
        const el = $('#loading');
        if (el) el.hidden = !on;
    }

    // ---------------------------------------------------------------- card
    function cardHTML(c, opts) {
        opts = opts || {};
        const poster = c.poster
            ? `<img src="${esc(c.poster)}" alt="${esc(c.title)}" loading="lazy"
                   referrerpolicy="no-referrer" onerror="this.remove()">`
            : '';
        const fallback = poster ? '' :
            `<div class="poster-fallback">${esc(c.category || '🎬')}</div>`;

        const badges = [];
        if (opts.series && c.is_series) {
            badges.push(`<span class="badge badge-series">${esc(c.episodes || c.total_episodes || 0)} QISM</span>`);
        }
        if (opts.episodeLabel) {
            badges.push(`<span class="badge badge-episode">${esc(opts.episodeLabel)}</span>`);
        }
        if (c.is_premium) {
            badges.push(`<span class="badge badge-premium">💎</span>`);
        }

        // YouTube uslubi: thumbnail burchagidagi davomiylik (12:34 / 1:32:05)
        const durSec = Number(c.duration) || 0;
        const dur = durSec > 0 ? `<span class="yt-dur">${fmtTime(durSec)}</span>` : '';

        // Meta: "1.2K ko'rildi · 3 kun oldin"
        const meta = [];
        const views = Number(c.views) || 0;
        meta.push(views > 0 ? fmtViews(views) + ' ko\u2018rildi' : 'Yangi');
        const ago = fmtAgo(c.added_at || c.created_at);
        if (ago) meta.push(ago);

        const sub = [];
        if (c.category) sub.push(esc(c.category));
        if (c.is_series && !opts.series) {
            sub.push(esc(c.episodes || c.total_episodes || 0) + ' qism');
        }
        if (c.year) sub.push(esc(c.year));
        if (c.rating) sub.push(`<span class="rating">★ ${Number(c.rating).toFixed(1)}</span>`);

        const bar = (opts.percent > 0) ? `
            <div class="progress-bar"><span style="width:${Math.min(100, opts.percent)}%"></span></div>` : '';

        const av = emojiFor(c.category_slug, c.category);

        return `
            <button class="card yt-card" data-id="${c.id}" ${opts.episodeId ? `data-ep="${opts.episodeId}"` : ''}>
                <div class="yt-thumb">
                    ${poster}${fallback}
                    ${badges.join('')}
                    ${dur}
                    ${bar}
                </div>
                <div class="yt-body">
                    <div class="yt-av">${av}</div>
                    <div class="yt-text">
                        <div class="yt-title">${esc(c.title)}</div>
                        <div class="yt-meta">${meta.join(' · ')}</div>
                        ${sub.length ? `<div class="yt-sub">${sub.join(' · ')}</div>` : ''}
                    </div>
                </div>
            </button>`;
    }

    // ---------------------------------------------------------------- bosh sahifa
    async function loadHome() {
        setLoading(true);
        try {
            const d = await api('home.php');
            renderCategories(d.categories);
            renderRow('#continueGrid', d.continue, true);
            $('#continueRow').hidden = !(d.continue && d.continue.length);
            renderRow('#trendingGrid', d.trending);
            renderRow('#newGrid', d.new);

            const catRows = $('#catRows');
            catRows.innerHTML = '';
            (d.by_category || []).forEach((g) => {
                const sec = document.createElement('div');
                sec.className = 'row';
                sec.innerHTML = `
                    <h2 class="row-title">${esc(g.category.name)}</h2>
                    <div class="grid">${g.items.map(c => cardHTML(c, { series: true })).join('')}</div>`;
                catRows.appendChild(sec);
            });
        } catch (e) {
            toast('Yuklab bo\'lmadi: ' + esc(e.message), 'err');
        } finally {
            setLoading(false);
        }
    }

    function renderRow(sel, items, isContinue) {
        const el = $(sel);
        if (!el) return;
        if (!items || !items.length) { el.innerHTML = ''; return; }
        el.innerHTML = items.map(c => cardHTML(c, isContinue ? {
            series: true,
            percent: c.percent,
            episodeId: c.episode_id,
            episodeLabel: c.episode_id > 0 ? c.episode_id + '-qism' : null
        } : { series: true })).join('');
    }

    // Kategoriya chiplari. Ro'yxat API'dan keladi - shu sabab bazaga yangi
    // kategoriya qo'shilsa, u interfeysda ham avtomatik paydo bo'ladi.
    // Emoji'lar nomidan avtomatik tanlanadi (yangi kategoriya qo'shilsa ham
    // chiqmasligi uchun).
    const CAT_EMOJI = {
        kino: '🎬', anime: '🌸', multfilm: '🧸', multflim: '🧸',
        serial: '📺', film: '🎥', kinoqizi: '🎬', bolalar: '🧸'
    };

    function emojiFor(slug, name) {
        const s = String(slug || '').toLowerCase();
        if (CAT_EMOJI[s]) return CAT_EMOJI[s];
        const n = String(name || '').toLowerCase();
        for (const key of Object.keys(CAT_EMOJI)) {
            if (s.includes(key) || n.includes(key)) return CAT_EMOJI[key];
        }
        return '📁';
    }

    function renderCategories(categories) {
        const wrap = $('#catChips');
        if (!wrap) return;

        // "Hammasi" har doim birinchi bo'ladi
        const cats = [{ slug: '', name: 'Hammasi', count: 0 }].concat(
            Array.isArray(categories) ? categories : []
        );

        wrap.innerHTML = cats.map(c =>
            `<button class="chip${c.slug === '' ? ' active' : ''}" data-cat="${esc(c.slug || '')}">`
            + `${emojiFor(c.slug, c.name)} ${esc(c.name)}`
            + (c.count ? ` <span class="chip-n">${Number(c.count)}</span>` : '')
            + `</button>`
        ).join('');

        $$('#catChips .chip').forEach(btn => btn.onclick = () => {
            $$('#catChips .chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.category = btn.dataset.cat;
            state.genre = 0;
            loadList(true);
        });
    }

    // ---------------------------------------------------------------- ro'yxat
    async function loadList(reset) {
        if (state.loading) return;
        state.loading = true;
        setLoading(true);

        if (reset) {
            state.page = 1;
            $('#listGrid').innerHTML = '';
        }

        const q = new URLSearchParams({
            page: state.page,
            sort: state.sort,
            per_page: 24
        });
        if (state.category) q.set('category', state.category);
        if (state.genre) q.set('genre', state.genre);
        if (state.search) q.set('q', state.search);

        try {
            const d = await api('catalog.php?' + q.toString());
            const grid = $('#listGrid');
            grid.insertAdjacentHTML('beforeend',
                d.items.map(c => cardHTML(c, { series: true, showCategory: true })).join(''));

            state.hasMore = d.has_more;
            $('#loadMore').hidden = !d.has_more;
            $('#listEmpty').hidden = d.items.length > 0 || state.page > 1;
        } catch (e) {
            toast('Xato: ' + esc(e.message), 'err');
        } finally {
            state.loading = false;
            setLoading(false);
        }
    }

    function showListView() {
        $('#homeView').hidden = true;
        $('#listView').hidden = false;
    }

    function updateListTitle() {
        let t = 'Katalog';
        if (state.search) t = `"${state.search}" natijalari`;
        else if (state.category) {
            t = { kino: '🎬 Kino', anime: '🌸 Anime', multfilm: '🧸 Multfilm' }[state.category] || 'Katalog';
        }
        $('#listTitle').textContent = t;
    }

    // ---------------------------------------------------------------- modal
    async function openContent(id, episodeId) {
        id = parseInt(id, 10) || 0;
        episodeId = parseInt(episodeId, 10) || 0;
        if (!id) return;
        state.current = null;
        $('#modal').hidden = false;
        $('#modalBody').innerHTML = '<div class="loading"><span class="spinner"></span> Yuklanmoqda…</div>';
        document.body.style.overflow = 'hidden';

        const q = new URLSearchParams({ id: id });
        if (episodeId) q.set('episode', episodeId);
        // Admin uchun: serverdagi relay bilan TEKSHIRUV (faqat admin,
        // "preview=1" serverda ham tekshiriladi). Oddiy tomoshabinda
        // video Telegram'da ochiladi.
        if (window.APP && window.APP.isAdmin) q.set('preview', '1');

        try {
            const d = await api('content.php?' + q.toString());
            state.current = d;
            $('#modalBody').innerHTML = renderModal(d);
            wireModal(d);
        } catch (e) {
            $('#modalBody').innerHTML =
                `<div class="modal-head"><div class="modal-title">Xato</div></div>
                 <div class="modal-desc">${esc(e.message)}</div>`;
        }
    }

    function closeModal() {
        destroyPlayer();
        $('#modal').hidden = true;
        $('#modalBody').innerHTML = '';
        document.body.style.overflow = '';
        state.current = null;
        if (location.search) {
            history.replaceState({}, '', location.pathname);
        }
    }

    function destroyPlayer() {
        if (window.UDP) {
            try { window.UDP.destroyAll(); } catch (e) {}
        }
        const v = $('#playerVideo');
        if (v) { try { v.pause(); } catch (e) {} }
    }

    // udp-player uchun data-udp-config JSON — titu/next/resumeAt.
    // ' => &#39;  (attribute single-quote ichida), & => &amp; (HTML entity)
    function udpConfig(pb, d) {
        const c = d.content || {};
        const sel = d.selected || null;

        // Resume: faqat progress > 5 bo'lsa va #t= hash yo'q bo'lsa
        let resumeAt = 0;
        if (d.progress && d.progress.position > 5 && !/^#t=\d+$/.test(location.hash)) {
            resumeAt = Math.floor(d.progress.position);
        }

        // Keyingi qism (faqat serial va qism tanlangan bo'lsa)
        let next = null;
        if (c.is_series && sel && d.episodes && d.episodes.length) {
            const i = d.episodes.findIndex(e => e.id === sel.id);
            const nx = (i >= 0 && d.episodes[i + 1]) ? d.episodes[i + 1] : null;
            if (nx) {
                next = {
                    href: base + '/index.php?c=' + c.id + '&e=' + nx.id,
                    label: (nx.number || nx.id) + '-qism'
                };
            }
        }

        return {
            autoplay: true,
            resumeAt: resumeAt,
            introStart: 0,
            introEnd: 0,
            title: c.title || '',
            next: next
        };
    }

    // udp-player markup — data-udp-config JSON string sifatida
    function udpMarkup(cfgJson) {
        return cfgJson.replace(/'/g, '&#39;').replace(/&/g, '&amp;');
    }

    function playerHTML(pb, d) {
        if (!pb) return '';
        if (pb.type === 'direct' || pb.type === 'file' || pb.type === 'hls') {
            const poster = pb.poster ? ` poster="${esc(pb.poster)}"` : '';
            const cfgJson = JSON.stringify(udpConfig(pb, d));
            // HLS: hali tayyor bo'lmasa data-hls-pending + json=1 poll
            let vattrs = '';
            if (pb.type === 'hls') {
                const sep = pb.url.indexOf('?') !== -1 ? '&' : '?';
                vattrs = ` data-hls-pending="1" data-hls-refresh="${esc(pb.url)}${sep}json=1"`;
            } else if (pb.url) {
                vattrs = ` src="${esc(pb.url)}"`;
            }
            return `<div class="player-wrap has-video-container">
                <div class="udp-player" data-udp data-udp-config='${udpMarkup(cfgJson)}'>
                    <video id="playerVideo" playsinline preload="auto"${poster}${vattrs}></video>
                </div>
            </div>`;
        }
        if (pb.type === 'embed') {
            return `<div class="player-wrap">
                <iframe src="${esc(pb.url)}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                        allowfullscreen referrerpolicy="origin" title="player" loading="lazy"></iframe>
            </div>`;
        }
        // "Telegram'da ko'rish" (NOL YUK rejimi): video Telegram CDN'dan
        // oqadi, sayt serveridan hech qanday video bayti o'tmaydi.
        //
        // DIQQAT: endi bu CTA emas — bu OYNADIR. Film SHU JOYDA ochiladi.
        // tg-stream.js shu konteynerga o'z playerini qo'yadi (GramJS +
        // Service Worker orqali). Agar fayl formatasi brauzerda
        // oynatilmaydigan bo'lsa (MKV, HEVC), o'sha modul o'z-o'zidan
        // "Telegram ilovasida ochish" ga qaytaradi.
        if (pb.type === 'telegram') {
            const sel2 = d.selected;
            const ep2  = sel2 ? (sel2.season + '-fasl ' + sel2.number + '-qism') : '';
            return `<div class="player-wrap has-video-container">
                <div id="tgStreamMount"
                     data-channel="${esc(pb.channel || '')}"
                     data-post="${esc(pb.post || '')}"
                     data-url="${esc(pb.url || '')}"
                     data-deep="${esc(pb.deep || '')}"
                     data-poster="${esc(pb.poster || '')}"
                     data-ep="${esc(ep2)}"
                     data-title="${esc((d.content && d.content.title) || '')}"></div>
            </div>`;
        }
        // none / manba yo'q holat — post yopiq bo'lsa poster + xabar
        const poster = pb.poster
            ? `<img class="nv-poster" src="${esc(pb.poster)}" alt="" onerror="this.style.display='none'">`
            : '';
        const open = pb.url
            ? `<a class="nv-btn" href="${esc(pb.url)}" target="_blank" rel="noopener">📱 Telegram'da ochish</a>`
            : '';
        return `<div class="player-wrap no-video">
            ${poster}
            <div class="nv-msg">${esc(pb.warning || 'Video mavjud emas')}</div>
            ${open}
        </div>`;
    }

    // ------------------------------------------------- maxsus player
    // direct/file/hls uchun shaxsiy boshqaruv: play/pause, progress,
    // ovoz, to'liq ekran. hls holatida fayl manzilini hls.js o'zi beradi.
    function initVp(v, pb) {
        if (!v || !pb) return;
        const wrap = $('#vpWrap');
        if (!wrap) return;

        if (pb.type !== 'hls' && pb.url) {
            v.src = pb.url;
        }

        const big = $('#vpBig');
        const play = $('#vpPlayBtn');
        const timeEl = $('#vpTime');
        const prog = $('#vpProg');
        const played = $('#vpPlayed');
        const buf = $('#vpBuf');
        const knob = $('#vpKnob');
        const vol = $('#vpVol');
        const full = $('#vpFull');
        const spin = $('.vp-spin');
        const errEl = $('.vp-err');
        if (!big || !play || !prog || !timeEl) return;

        const fmt = (s) => {
            if (!isFinite(s) || s < 0) s = 0;
            const h = Math.floor(s / 3600);
            const m = Math.floor(s % 3600 / 60);
            const sec = Math.floor(s % 60);
            return (h ? h + ':' : '') +
                String(m).padStart(h ? 2 : 1, '0') + ':' + String(sec).padStart(2, '0');
        };

        const syncUI = () => {
            if (play) play.textContent = v.paused ? '▶' : '⏸';
            if (big) {
                big.textContent = v.paused ? '▶' : '⏸';
                big.hidden = !v.paused;
            }
            if (isFinite(v.duration) && v.duration > 0) {
                const pct = Math.min(100, (v.currentTime / v.duration) * 100);
                played.style.width = pct + '%';
                knob.style.left = pct + '%';
                timeEl.textContent = fmt(v.currentTime) + ' / ' + fmt(v.duration);
            }
        };

        const toggle = () => {
            if (errEl && errEl.hidden === false) return;
            if (v.paused) { v.play().catch(() => {}); } else { v.pause(); }
        };

        const toggleFull = () => {
            if (document.fullscreenElement === wrap) {
                document.exitFullscreen().catch(() => {});
            } else if (wrap.requestFullscreen) {
                wrap.requestFullscreen().catch(() => {});
            }
        };

        big.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
        play.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
        v.addEventListener('click', (e) => {
            if (e.target.closest('.vp-bar')) return;
            toggle();
        });
        v.addEventListener('dblclick', toggleFull);
        v.addEventListener('play', syncUI);
        v.addEventListener('pause', syncUI);
        v.addEventListener('timeupdate', syncUI);
        v.addEventListener('loadedmetadata', syncUI);
        v.addEventListener('durationchange', syncUI);
        v.addEventListener('waiting', () => { if (spin) spin.hidden = false; });
        v.addEventListener('playing', () => { if (spin) spin.hidden = true; });
        v.addEventListener('canplay', () => { if (spin) spin.hidden = true; });

        // ---- JONLI OQIM uchun chidamlilik -------------------------------
        // Oqim bir zumga sustlashib yoki uzilib qolsa, video abadiy
        // turg'unlikda qolib ketmasin: xatoda 2 marta avtomatik qayta
        // urinamiz, va 12 soniya davomida oldinga siljish bo'lmasa
        // manbani (live.php) qayta yuklab o'ynatamiz.
        let errCount = 0;
        v.addEventListener('error', () => {
            // HLS rejim: manba blob URL — qo'lda qayta yozilmaydi. hls.js
            // o'z retry mexanizmiga ega; shunchaki oqimni qayta ishga tushiramiz.
            if (state.hls) {
                try { state.hls.startLoad(); } catch (e) {}
                stallT = 0;
                v.play().catch(() => {});
                return;
            }
            errCount++;
            if (errCount <= 2) {
                // vaqtinchalik uzilish (ngrok/aloqa) bo'lishi mumkin
                const src = v.currentSrc || v.src;
                try {
                    if (src) { v.src = src; v.load(); } else { v.load(); }
                    // URL'ni avvalgi holatga qaytarish v.src orqali amalga
                    // oshdi; endi o'ynatishni davom ettiramiz.
                    stallT = 0;
                    v.play().catch(() => {});
                } catch (e) {}
                return;
            }
            const code = v.error ? v.error.code : 0;
            const msg = code === 4
                ? 'Video manbai topilmadi (Telegram havolasi eskirgan bo‘lishi mumkin).'
                : 'Video yuklab bo‘lmadi.';
            errEl.textContent = '⚠️ ' + msg + ' Admin panelda “⬆️ Videoni serverga yuklash” orqali qo‘shing.';
            errEl.hidden = false;
            big.hidden = true;
            if (spin) spin.hidden = true;
        });

        // Turg'unlik soati: 'waiting' bo'lsa 12 sekund ichida video
        // oldinga siljimasa — manbani qayta yuklaymiz (max 2 marta).
        let stallT = 0;
        let stallCnt = 0;
        let lastCur = 0;
        v.addEventListener('timeupdate', () => {
            if (Math.abs(v.currentTime - lastCur) > 0.5) { lastCur = v.currentTime; stallT = 0; }
        });
        v.addEventListener('waiting', () => { if (stallT === 0) stallT = Date.now(); });
        v.addEventListener('playing', () => { stallT = 0; stallCnt = 0; });
        v.addEventListener('stalled', () => { if (stallT === 0) stallT = Date.now(); });
        const watchdog = setInterval(() => {
            if (!v.isConnected) { clearInterval(watchdog); return; }
            if (v.paused || v.seeking || (errEl && errEl.hidden === false)) return;
            if (stallT && Date.now() - stallT > 12000 && stallCnt < 2) {
                stallCnt++;
                stallT = 0;
                const t = v.currentTime;
                if (spin) spin.hidden = true;
                try {
                    if (state.hls) {
                        state.hls.startLoad();      // HLS: keyingi segmentni qayta so'raymiz
                    } else {
                        v.load();                   // live.php dan qayta so'rov
                        if (t > 1) { v.currentTime = t; }
                    }
                    v.play().catch(() => {});
                } catch (e) {}
            }
        }, 4000);

        // Modal ochilganda darhol o'ynatishga urinamiz — foydalanuvchi
        // kartani bosgan, o'sha "tirik harakat" hisoblanadi. Agar brauzer
        // ruxsat bermasa, ▶ tugma ko'rinib turadi (pastda syncUI).
        v.play().catch(() => {});

        // Progress: bosib/surib izlash
        const seekFrom = (clientX) => {
            if (!isFinite(v.duration) || !v.duration) return;
            const r = prog.getBoundingClientRect();
            const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
            v.currentTime = p * v.duration;
            syncUI();
        };
        let scrubbing = false;
        prog.addEventListener('click', (e) => seekFrom(e.clientX));
        prog.addEventListener('pointerdown', (e) => {
            scrubbing = true;
            try { prog.setPointerCapture(e.pointerId); } catch (err) {}
            seekFrom(e.clientX);
        });
        prog.addEventListener('pointermove', (e) => { if (scrubbing) seekFrom(e.clientX); });
        prog.addEventListener('pointerup', () => { scrubbing = false; });
        prog.addEventListener('pointercancel', () => { scrubbing = false; });

        // Ovoz
        vol.addEventListener('click', () => {
            v.muted = !v.muted;
            vol.textContent = v.muted ? '🔇' : (v.volume > 0.5 ? '🔊' : '🔉');
        });
        v.addEventListener('volumechange', () => {
            vol.textContent = v.muted ? '🔇' : (v.volume > 0.5 ? '🔊' : '🔉');
        });

        // To'liq ekran
        full.addEventListener('click', (e) => { e.stopPropagation(); toggleFull(); });

        // Space / Enter bilan boshqarish
        wrap.tabIndex = 0;
        wrap.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
                e.preventDefault();
                toggle();
            } else if (e.key === 'f' || e.key === 'F') {
                toggleFull();
            }
        });

        syncUI();
    }

    function renderModal(d) {
        const c = d.content;
        const sel = d.selected;
        const pb = d.playback;

        const note = (pb && pb.warning)
            ? `<div class="player-note">ℹ️ ${esc(pb.warning)}</div>` : '';

        const meta = [];
        meta.push(c.views ? fmtViews(c.views) + ' ko\u2018rildi' : 'Yangi');
        const agoM = fmtAgo(c.added_at || c.created_at);
        if (agoM) meta.push(agoM);
        if (c.year) meta.push(esc(c.year));
        if (c.duration) meta.push('⏱ ' + fmtTime(c.duration));
        if (c.rating) meta.push(`★ ${Number(c.rating).toFixed(1)}`);
        if (c.studio) meta.push('🎬 ' + esc(c.studio));
        if (c.director) meta.push('🎥 ' + esc(c.director));

        const tags = (c.genres || []).map(g =>
            `<span class="tag">${esc(g.name)}</span>`).join('');

        const eps = (c.is_series && d.episodes && d.episodes.length) ? `
            <div class="eps-head"><span>📺 Qismlar</span>
                <span style="color:var(--muted);font-weight:400;font-size:12px">${d.episodes.length} ta</span>
            </div>
            <div class="eps-list">
                ${d.episodes.map(e => `
                    <button class="ep${sel && e.id === sel.id ? ' active' : ''}"
                            data-ep="${e.id}">
                        <div class="ep-num">${e.number}</div>
                        <div class="ep-lbl">${e.is_premium ? '💎 ' : ''}${e.season}-fasl</div>
                    </button>`).join('')}
            </div>` : '';

        return `
            ${playerHTML(pb, d)}
            ${note}

            <div class="modal-head">
                <div class="modal-title">${esc(c.title)}</div>
                <div class="modal-sub">${meta.join(' · ')}</div>
            </div>

            <div class="actions">
                <button class="action" id="actLike">${c.has_liked ? '❤️' : '🤍'} <span>${
                    c.likes ? fmtViews(c.likes) : ''}</span></button>
                <button class="action${c.in_watchlist ? ' on' : ''}" id="actWatch">${
                    c.in_watchlist ? '✓' : '＋'} Kutubxona</button>
                <button class="action primary" id="actSend">📤 Telegram'ga</button>
                <button class="action" id="actShare">🔗 Ulashish</button>
                <button class="action" id="actClip">✂️ Reels</button>
            </div>

            ${c.description ? `<div class="modal-desc">${esc(c.description)}</div>` : ''}
            ${tags ? `<div class="tags">${tags}</div>` : ''}
            ${eps}`;
    }

    // ---------------------------------------------------------------- modal amallari
    function wireModal(d) {
        const c = d.content;
        const sel = d.selected;
        const pb = d.playback;

        // Player — udp-player (udp-player JS'ning o'zida HLS/pending/retry logikasi
        // bor). Markup renderModal'da data-udp-config bilan yaratiladi; bu yerda
        // faqat init qilamiz (modal dinamik bo'lgani uchun window.UDP kerak).
        if (window.UDP) {
            try { window.UDP.destroyAll(); } catch (e) {}
            window.UDP.initAll();
        }

        // TELEGRAM CDN PLAYER (nol yuk rejimi)
        //
        // Video shu modal ichida ochiladi — t.me ga o'tmaydi. Uni
        // tg-stream.js boshqaradi: foydalanuvchi bir masta QR skanerlaydi,
        // auth_key shu brauzerda qoladi, keyin video to'g'ridan-to'g'ri
        // Telegram CDN dan oqadi. Sayt serveriga video bayti TUSHMAYDI.
        if (window.TgStream) window.TgStream.stop();
        const tgMount = document.getElementById('tgStreamMount');
        if (tgMount) {
            const opt = {
                channel: tgMount.dataset.channel || '',
                post:    Number(tgMount.dataset.post) || 0,
                url:     tgMount.dataset.url || '',
                deep:    tgMount.dataset.deep || '',
                poster:  tgMount.dataset.poster || '',
                cfg:     udpConfig(pb, d)
            };
            // "Qayta urinish" tugmasi shu qiymatni qayta ishlatadi.
            window.__wcTgLast = opt;
            window.TgStream.mount(tgMount, opt);
        }

        // JONLI OQIM: t.me manbali kontent. Qaysi kontent bosilganini
        // aniqlab, @w_cinema_uz_bot uning nusxasini foydalanuvchining
        // Telegram'iga bir marta yuboradi (foniy worker — oqimni
        // sekinlashtirmaydi). Takror yuborishni api/deliver.php tekshiradi.
        if (loggedIn && pb && pb.type === 'file' && (pb.url || '').indexOf('api/live.php?') !== -1) {
            const dq = 'id=' + c.id + (sel ? '&episode=' + sel.id : '');
            api('deliver.php?' + dq, { method: 'POST' }).then(r => {
                if (r && r.status === 'need_start') {
                    const botName = APP.botUsername || 'w_cinema_uz_bot';
                    toast('Avval <a href="' + esc(APP.botUrl || ('https://t.me/' + botName)) +
                        '" target="_blank">@' + esc(botName) +
                        ' botiga <code>/start</code></a> yuboring', 'err');
                }
            }).catch(() => {});
        }

        // Progress tiklash — endi udp-player'ning o'z resume overlay'i ishlaydi
        // (data-udp-config.resumeAt). Bu yerda hech narsa kerak emas.

        // CTA sakrashi: reels "🎬 To'liq qismni tomosha qilish (12:30 dan)"
        // URL'da #t=750 qoldiradi. Shu qiymat bu yerda currentTime ga
        // o'tkaziladi.
        const seek = (location.hash.match(/^#t=(\d+)$/) || [])[1];
        if (seek) {
            const to = parseInt(seek, 10);
            const v = $('#playerVideo');
            const jump = () => {
                if (isFinite(v.duration) && to < v.duration - 1) {
                    v.currentTime = to;
                    v.play().catch(() => {});
                    toast('⏩ ' + fmtTime(to) + ' dan');
                } else {
                    toast('⚠️ Bu vaqt videoda topilmadi', 'err');
                }
            };
            if (v) {
                if (v.readyState >= 1) jump();
                else v.addEventListener('loadedmetadata', jump, { once: true });
            }
            // Hash kiritilgach, "orqaga" tugmasi uni yana
            // ishga tushirmasin
            history.replaceState({}, '', location.pathname + location.search);
        }

        wireProgressSave();

        // 30 soniya ko'rilgach unikal ko'rishni sanaymiz va davomiylikni
        // avtomatik yozamiz (YouTube uslubi).
        wireMediaTracking(d);

        // Like
        const likeBtn = $('#actLike');
        if (likeBtn) likeBtn.onclick = async () => {
            if (!requireLogin()) return;
            likeBtn.classList.add('busy');
            try {
                // POST, chunki bu holatni O'ZGARTIRADI. GET da yuborilsa,
                // brauzer "prefetch" qilib yuborib, tasodifiy yoqish bosishi
                // mumkin (va CSRF hujjumga ochiq bo'lardi).
                const r = await api('like.php?id=' + c.id, { method: 'POST' });
                likeBtn.classList.toggle('on', r.liked);
                likeBtn.innerHTML = (r.liked ? '❤️' : '🤍') + ' <span>' +
                    (r.likes ? fmtViews(r.likes) : '') + '</span>';
            } catch (e) {
                toast(esc(e.message), 'err');
            } finally {
                likeBtn.classList.remove('busy');
            }
        };

        // Watchlist
        const wBtn = $('#actWatch');
        if (wBtn) wBtn.onclick = async () => {
            if (!requireLogin()) return;
            wBtn.classList.add('busy');
            try {
                // Xudusi shu sababdan POST (holatni o'zgartiradi)
                const r = await api('watchlist.php?id=' + c.id, { method: 'POST' });
                wBtn.classList.toggle('on', r.in_watchlist);
                wBtn.textContent = r.in_watchlist ? '✓ Kutubxona' : '＋ Kutubxona';
                toast(r.in_watchlist ? 'Kutubxonaga qo\'shildi' : 'Kutubxonadan olib tashlandi', 'ok');
            } catch (e) {
                toast(esc(e.message), 'err');
            } finally {
                wBtn.classList.remove('busy');
            }
        };

        // 4-QADAM: Telegram'ga yuborish
        const sendBtn = $('#actSend');
        if (sendBtn) sendBtn.onclick = async () => {
            if (!requireLogin()) return;
            sendBtn.classList.add('busy');
            sendBtn.textContent = '⏳ Yuborilmoqda…';
            try {
                const q = 'id=' + c.id + (sel ? '&episode=' + sel.id : '');
                const r = await api('telegram-save.php?' + q, { method: 'POST' });

                if (r.status === 'need_start') {
                    toast('Avval <a href="' + esc(APP.botUrl) + '" target="_blank">@' +
                        esc(APP.botUsername) + '</a> botiga <code>/start</code> yuboring', 'err');
                } else if (r.success) {
                    sendBtn.textContent = '✓ Yuborildi';
                    toast(esc(r.message || 'Yuborildi'), 'ok');
                } else {
                    toast(esc(r.message || 'Yuborilmadi'), 'err');
                    sendBtn.textContent = '📤 Telegram\'ga';
                }
            } catch (e) {
                // 428 = /start kerak
                if (e.status === 428) {
                    toast('Avval <a href="' + esc(APP.botUrl) + '" target="_blank">@' +
                        esc(APP.botUsername) + '</a> botiga <code>/start</code> yuboring', 'err');
                } else {
                    toast(esc(e.message), 'err');
                }
                sendBtn.textContent = '📤 Telegram\'ga';
            } finally {
                sendBtn.classList.remove('busy');
            }
        };

        // Ulashish
        const shareBtn = $('#actShare');
        if (shareBtn) shareBtn.onclick = async () => {
            const url = base + '/index.php?c=' + c.id + (sel ? '&e=' + sel.id : '');
            const text = c.title;
            try {
                if (navigator.share) {
                    await navigator.share({ title: text, url: url });
                    return;
                }
                await navigator.clipboard.writeText(url);
                toast('🔗 Havola nusxalandi', 'ok');
            } catch (e) {
                toast('Ulashish bekor qilindi');
            }
        };

        // Qism tanlash
        $$('#modalBody .ep').forEach(btn => btn.onclick = () => {
            destroyPlayer();
            openContent(c.id, parseInt(btn.dataset.ep, 10));
        });

        // "✂️ Reels yaratish" - joriy bo'lakdan virtual reel
        const clipBtn = $('#actClip');
        if (clipBtn) clipBtn.onclick = () => {
            if (!requireLogin()) return;
            openTrimmer(c, sel, pb);
        };
    }

    // ---------------------------------------------------------------- trimmer
    // O'zgartirish mumkin bo'lgan video (direct/file/hls) uchun vaqt
    // oralig'ini tanlash. Tanlangan bo'lak "virtual reel" bo'lib yuboriladi -
    // fayl nusxalanmaydi, faqat content_id + start/end saqlanadi.
    const MAX_LEN  = (window.APP && window.APP.reels) ? window.APP.reels.maxLengthSec : 90;
    const MIN_LEN  = 3;

    function parseClock(str, fallback) {
        const m = String(str || '').match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
        if (!m) return fallback;
        return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]);
    }

    function openTrimmer(c, sel, pb) {
        const v = $('#playerVideo');

        // Embed (iframe) da currentTime ni boshqarib bo'lmaydi - bo'lak
        // kesib bo'lmaydi. Jimgina "ishlamaydi" desak, foydalanuvchi
        // nima uchunini bilmaydi. "telegram" turi ham shu holda: video
        // sayt ichida yo'q, uni Telegram ilovasi beradi.
        if (!v || (pb && (pb.type === 'embed' || pb.type === 'none' || pb.type === 'telegram'))) {
            toast('Bu manbadan bo‘lak yaratib bo‘lmaydi', 'err');
            return;
        }

        const dur = isFinite(v.duration) && v.duration > 0
            ? v.duration
            : parseClock(c.duration, 0);

        if (!dur) {
            toast('Video uzunligi ma’lum emas', 'err');
            return;
        }

        const cur = Math.floor(v.currentTime);
        // Boshlang'ich diapazon: hozirgi nuqtadan keyingi ~30 soniya
        let s0 = cur;
        let s1 = Math.min(dur, cur + Math.min(30, MAX_LEN));
        if (s1 - s0 < MIN_LEN) s0 = Math.max(0, s1 - Math.min(30, MAX_LEN));

        const modal = $('#trimModal');
        const body   = $('#trimBody');
        if (!modal || !body) return;

        body.innerHTML = `
            <div class="modal-head">
                <div class="modal-title">✂️ Reels yaratish</div>
                <div class="modal-sub">${esc(c.title)}${sel ? ' · '
                    + sel.season + '-fasl ' + sel.number + '-qism' : ''}</div>
            </div>

            <div class="trim-body">
                <div class="trim-time">${fmtTime(dur)} uzunlikdagi videodan bo‘lak tanlang</div>

                <label class="trim-label">Boshlanish
                    <input type="text" id="tStart" value="${fmtTime(s0)}" inputmode="numeric"
                           placeholder="0:00">
                </label>
                <label class="trim-label">Tugash
                    <input type="text" id="tEnd" value="${fmtTime(s1)}" inputmode="numeric"
                           placeholder="0:00">
                </label>

                <div class="trim-len" id="tLen">Uzunligi: ${fmtTime(s1 - s0)}</div>
                <input type="range" id="tDur" min="${MIN_LEN}" max="${MAX_LEN}" value="${
                    Math.min(MAX_LEN, s1 - s0)}" class="trim-range">
                <div class="trim-len" style="color:var(--muted)">
                    Bo‘lak uzunligi: ${MIN_LEN}–${MAX_LEN} soniya
                </div>

                <label class="trim-label">Sarlavha (ixtiyoriy)
                    <input type="text" id="tTitle" maxlength="200"
                           placeholder="${esc(c.title)}">
                </label>

                <div class="trim-msg" id="tMsg" hidden></div>

                <div class="trim-actions">
                    <button class="action" data-trim-close>Bekor qilish</button>
                    <button class="action primary" id="tSend">Yaratish</button>
                </div>
            </div>`;

        modal.hidden = false;

        // --- real vaqtda davomiylik ko'rsatish
        const startI = body.querySelector('#tStart');
        const endI   = body.querySelector('#tEnd');
        const lenEl  = body.querySelector('#tLen');
        const durR   = body.querySelector('#tDur');
        const msgEl  = body.querySelector('#tMsg');
        const sendB  = body.querySelector('#tSend');

        function refresh() {
            let a = parseClock(startI.value, s0);
            let b = parseClock(endI.value, s1);
            if (a < 0) a = 0;
            if (b > dur) b = dur;
            const len = b - a;
            lenEl.textContent = 'Uzunligi: ' + fmtTime(Math.max(0, len))
                + ' (' + Math.max(0, len) + ' s)';
            if (len >= MIN_LEN && len <= MAX_LEN && b > a) {
                msgEl.hidden = true;
                sendB.disabled = false;
            } else {
                sendB.disabled = true;
                msgEl.hidden = false;
                msgEl.textContent = len < MIN_LEN
                    ? 'Kamida ' + MIN_LEN + ' soniya kerak'
                    : (b <= a ? 'Tugash boshlanishdan keyin bo‘lishi kerak'
                              : 'Ko‘pi bilan ' + MAX_LEN + ' soniya');
            }
        }
        startI.oninput = refresh;
        endI.oninput = refresh;
        // slayd bilan uzunlikni moslashtirish
        durR.oninput = () => {
            const len = +durR.value;
            const base = parseClock(startI.value, 0);
            startI.value = fmtTime(base);
            endI.value = fmtTime(base + len);
            refresh();
        };
        refresh();

        // --- yuborish
        sendB.onclick = async () => {
            const a = parseClock(startI.value, 0);
            const b = parseClock(endI.value, 0);
            sendB.disabled = true;
            sendB.textContent = '⏳ Yaratilmoqda…';
            try {
                const body2 = new URLSearchParams({
                    content_id: c.id,
                    episode_id: sel ? sel.id : 0,
                    start: a,
                    end: b,
                    title: body.querySelector('#tTitle').value || ''
                });
                const r = await api('reel-create.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: body2
                });
                modal.hidden = true;
                toast('✅ ' + esc(r.message || 'Yaratildi'), 'ok');
            } catch (e) {
                sendB.disabled = false;
                sendB.textContent = 'Yaratish';
                msgEl.hidden = false;
                msgEl.className = 'trim-msg err';
                msgEl.textContent = e.message;
            }
        };
    }

    // ======================================================================
    //  UNIKAL KO'RISH va AVTOMATIK DAVOMIYLIK
    // ======================================================================
    //  - YouTube kabi: video 30 SONIYA ko'rilgach "ko'rildi" sanaladi.
    //  - Bir odam (viewer_key) bitta kontentni necha marta ko'rsa ham
    //    serverda FAQAT 1 marta hisoblanadi (api/views.php).
    //  - Davomiylik <video> metadatasidan olinib, bo'sh bo'lsa DB ga
    //    yoziladi (api/duration.php) — serverda ffmpeg yo'q.
    //  - Viewer: avval PHP hisobi; bo'lmasa Telegram akkaunt id (MTProto);
    //    bo'lmasa anonim brauzer id (localStorage).
    // ======================================================================

    // Anonim brauzer id — bir marta yaratiladi, keyin qayta ishlatiladi.
    function anonId() {
        try {
            let v = localStorage.getItem('wc_anon_id');
            if (v && v.length >= 8) return v;
            v = (window.crypto && crypto.randomUUID)
                ? crypto.randomUUID()
                : ('anon-' + Date.now().toString(36) + '-' +
                   Math.random().toString(36).slice(2, 10));
            localStorage.setItem('wc_anon_id', v);
            return v;
        } catch (e) {
            return '';
        }
    }

    // Telegram akkaunt id — MTProto orqali kirilgan bo'lsa (tg-stream.js).
    function tgUserId() {
        try {
            if (window.TgStream && typeof window.TgStream.me === 'function') {
                const m = window.TgStream.me();
                if (m && m.id) return String(m.id);
            }
        } catch (e) {}
        return '';
    }

    // Sessiya davomida bir marta sanalgan kontentlar.
    const viewedOnce = new Set();

    function countView(contentId) {
        if (!contentId || viewedOnce.has(contentId)) return;
        viewedOnce.add(contentId);
        const body = new URLSearchParams({ id: contentId });
        const tg = tgUserId();
        if (tg) body.set('tg_id', tg);
        else body.set('anon', anonId());
        fetch(base + '/api/views.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            credentials: 'same-origin',
            body: body.toString()
        }).catch(() => {});
    }

    // Davomiylikni bir marta yuboramiz (content + episode uchun).
    const durSaved = new Set();

    function saveDuration(cid, eid, seconds) {
        const key = cid + ':' + eid;
        if (!cid || !seconds || seconds <= 0 || durSaved.has(key)) return;
        durSaved.add(key);
        fetch(base + '/api/duration.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            credentials: 'same-origin',
            body: new URLSearchParams({
                content_id: cid,
                episode_id: eid || 0,
                duration: Math.round(seconds)
            }).toString()
        }).catch(() => {});
    }

    // Modal ichidagi HAR QANDAY <video> ni kuzatamiz — bu to'g'ridan-to'g'ri
    // (direct/file/hls) ham, Telegram (tg-stream) ham bo'lishi mumkin.
    // Video dinamik qo'shilishi mumkinligi uchun hodisalarni `capture`
    // rejimida #modalBody dan ushlaymiz (media hodisalari ko'pchilik
    // holatda "bubble" qilmaydi, lekin capture fazasida yetib boradi).
    function wireMediaTracking(d) {
        const root = $('#modalBody');
        if (!root || !d || !d.content) return;
        const cid = d.content.id;
        const eid = d.selected ? d.selected.id : 0;
        let watched = 0, lastT = 0;

        const onMeta = (v) => {
            if (isFinite(v.duration) && v.duration > 1) {
                saveDuration(cid, eid, v.duration);
            }
        };
        root.addEventListener('loadedmetadata', (e) => {
            if (e.target && e.target.tagName === 'VIDEO') onMeta(e.target);
        }, true);
        root.addEventListener('durationchange', (e) => {
            if (e.target && e.target.tagName === 'VIDEO') onMeta(e.target);
        }, true);
        root.addEventListener('play', (e) => {
            if (e.target && e.target.tagName === 'VIDEO') lastT = e.target.currentTime;
        }, true);
        root.addEventListener('timeupdate', (e) => {
            const v = e.target;
            if (!v || v.tagName !== 'VIDEO') return;
            const t = v.currentTime || 0;
            const dt = t - lastT;
            lastT = t;
            // Seek (sakrash) ni hisobga olmaymiz — faqat real ko'rish.
            if (dt > 0 && dt < 5) watched += dt;
            if (watched >= 30) countView(cid);
        }, true);
    }

    function wireProgressSave() {
        const v = $('#playerVideo');
        if (!v) return;
        const cid = state.current.content.id;
        const eid = state.current.selected ? state.current.selected.id : 0;

        let timer = null;
        const save = () => {
            if (!v.duration || !isFinite(v.duration)) return;
            fetch(base + '/api/progress.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                credentials: 'same-origin',
                body: new URLSearchParams({
                    content_id: cid, episode_id: eid,
                    position: Math.floor(v.currentTime),
                    duration: Math.floor(v.duration)
                })
            }).catch(() => {});
        };

        v.addEventListener('timeupdate', () => {
            if (timer) return;
            timer = setTimeout(() => { timer = null; save(); }, 10000);
        });
        v.addEventListener('pause', save);
        v.addEventListener('ended', save);
    }

    function requireLogin() {
        if (loggedIn) return true;
        toast('🔐 Bu amal uchun <a href="login.php">Telegram orqali kiring</a>');
        return false;
    }

    // ---------------------------------------------------------------- hodisalar
    function wire() {
        // Kartalar -> modal
        document.addEventListener('click', (e) => {
            const card = e.target.closest('.card');
            if (card && card.dataset.id) {
                openContent(card.dataset.id, card.dataset.ep || 0);
                return;
            }
            if (e.target.closest('[data-close]')) {
                closeModal();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
        });

        // Saralash
        $$('#sortChips .chip').forEach(btn => btn.onclick = () => {
            $$('#sortChips .chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.sort = btn.dataset.sort;
            if (!$('#listView').hidden) loadList(true);
        });

        // Qidiruv (debounce)
        let debounce = null;
        const si = $('#searchInput');
        const sc = $('#searchClear');

        si.addEventListener('input', () => {
            sc.hidden = si.value === '';
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                state.search = si.value.trim();
                showListView();
                updateListTitle();
                loadList(true);
            }, 350);
        });

        sc.onclick = () => {
            si.value = '';
            sc.hidden = true;
            state.search = '';
            showListView();
            updateListTitle();
            loadList(true);
        };

        // "Yana ko'rsatish"
        $('#loadMore').onclick = () => {
            state.page++;
            loadList(false);
        };

        // "Butun katalogni ko'rish" (index.php dan dispatch qilinadi)
        window.addEventListener('wc:showCatalog', () => {
            showListView();
            updateListTitle();
            loadList(true);
        });

        // Trimmer modalni yopish
        $$('#trimModal [data-trim-close]').forEach(el => el.onclick = () => {
            const m = $('#trimModal');
            if (m) { m.hidden = true; $('#trimBody').innerHTML = ''; }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !$('#trimModal').hidden) {
                const m = $('#trimModal');
                m.hidden = true;
                $('#trimBody').innerHTML = '';
            }
        });

        // Telegram Web App
        const wa = window.Telegram && window.Telegram.WebApp;
        if (wa) {
            wa.ready();
            wa.expand();
        }
    }

    // ---------------------------------------------------------------- start
    document.addEventListener('DOMContentLoaded', () => {
        wire();
        loadHome();

        if (APP.contentId > 0) {
            openContent(APP.contentId, APP.episodeId || 0);
        }
    });
})();
