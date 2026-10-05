/* ==========================================================================
   W CINEMA - Reels oqimi (Instagram Reels uslubida)
   ==========================================================================
   Har bir slayd ichida:
     .reels-media  - video (Telegram'dan yoki fayl/embed)
     .reels-meta   - chap pastda: avatar, ism, Kuzatish, izoh, audio
     .reels-side   - o'ngda: Like, Comment, Repost, Share, Save, More
     .reels-mute   - video o'ng pastida

   Oqim ma'lumoti api/reels.php dan olinadi. Sahifa faqat "qatqon".
   ========================================================================== */
(function () {
    'use strict';

    const CFG = window.REELS || {};
    const track = document.getElementById('reelsTrack');
    if (!track) return;

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
        const m = Math.floor(sec / 60), s = sec % 60;
        return m + ':' + String(s).padStart(2, '0');
    }

    // -------------------------------------------------------- identifikatsiya
    // Sayt brauzerdagi MTProto orqali ishlaydi (PHP sessiyasi BO'LMAYDI).
    // Shu sabab joriy Telegram akkauntni `wc_tg_me_v1` dan olamiz va API'ga
    // `tg_me` bo'lib yuboramiz — like/izoh/saqlash/repost shunda ishlaydi.
    function tgMeRaw() {
        try { return localStorage.getItem('wc_tg_me_v1') || ''; } catch (e) { return ''; }
    }
    function myTgId() {
        if (CFG.userId) return Number(CFG.userId);
        try {
            const m = JSON.parse(tgMeRaw() || 'null');
            return m && m.id ? Number(m.id) : 0;
        } catch (e) { return 0; }
    }
    function withMe(params) {
        const raw = tgMeRaw();
        if (raw) params.set('tg_me', raw);
        return params;
    }

    // ------------------------------------------------ SVG ikonkalar (kontur)
    // Instagram'ning joriy reels to'plami: heart, bubble, repost, plane,
    // bookmark, 3 nuqta + audio/volume/more amallari uchun qo'shimchalar.
    function svg(inner, full) {
        return '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" '
            + 'stroke-linecap="round" stroke-linejoin="round" '
            + (full ? 'fill="currentColor"' : 'fill="none"') + '>' + inner + '</svg>';
    }
    const ICON = {
        heart:   svg('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'),
        comment: svg('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
        repost:  svg('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
        share:   svg('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'),
        bookmark:svg('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
        more:    svg('<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
        music:   svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
        volume:  svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
        volumeOff: svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'),
        link:    svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
        trophy:  svg('<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 5H4v2a3 3 0 0 0 3 3"/><path d="M17 5h3v2a3 3 0 0 1-3 3"/>'),
        eyeoff:  svg('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'),
        flag:    svg('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'),
        trash:   svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
        close:   svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
        pin:     svg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>')
    };

    // ---------------------------------------------------------------- state
    const state = {
        sort: 'new',
        items: [],
        offset: 0,
        hasMore: false,
        loading: false,
        active: -1,          // hozir ko'rsatilayotgan slayd indeksi
        seen: new Set(),     // ko'rish uchun hisobga olingan reel idlar
        mountStartedAt: 0,   // aktiv mount boshlangan vaqt (prefetch darvozasi)
        viewerId: 0,         // joriy foydalanuvchining DB id'si (serverdan)
        slideEls: []
    };

    function itemById(id) {
        id = Number(id) || 0;
        for (let i = 0; i < state.items.length; i++) {
            if (state.items[i].id === id) return state.items[i];
        }
        return null;
    }

    // ---------------------------------------------------------------- api
    async function api(path, opts) {
        const res = await fetch(path, Object.assign({
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin'
        }, opts || {}));
        let d;
        try { d = await res.json(); }
        catch (e) { throw new Error('Server javobi buzildi'); }
        if (!res.ok && !d.success) {
            const err = new Error(d.message || ('Xato ' + res.status));
            err.status = res.status;
            throw err;
        }
        return d;
    }

    let toastTimer = null;
    function toast(msg) {
        const t = document.getElementById('reelToast');
        if (!t) return;
        t.textContent = msg;
        t.hidden = false;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            t.classList.remove('show');
            setTimeout(() => { t.hidden = true; }, 220);
        }, 1900);
    }

    // ================================================================ render
    function slideHTML(r, index) {
        const pb = r.playback || {};
        let media;

        if (pb.type === 'file' || pb.type === 'direct' || pb.type === 'hls') {
            const start = (pb.start > 0)
                ? ` onloadedmetadata="this.currentTime=${Number(pb.start) || 0}"`
                : '';
            media = `<video src="${esc(pb.url)}" ${start}
                             playsinline loop preload="metadata"
                             ${pb.seek ? 'controls' : ''}
                             ontouchstart="tapPlay(this, event)"></video>`;
        } else if (pb.type === 'embed') {
            media = `<iframe src="${esc(pb.url)}" allow="autoplay; fullscreen; encrypted-media"
                             allowfullscreen referrerpolicy="origin" title="reel"></iframe>`;
        } else if (pb.type === 'telegram') {
            media = `<div class="reels-tg"
                         data-channel="${esc(pb.channel || '')}"
                         data-post="${Number(pb.post) || 0}"
                         data-url="${esc(pb.url || '')}"
                         data-deep="${esc(pb.deep || '')}"
                         data-poster="${esc(pb.poster || '')}"></div>`;
        } else {
            media = `<div class="reels-warn">
                        <div style="font-size:40px">🚫</div>
                        <div>${esc(pb.warning || 'Video mavjud emas')}</div>
                    </div>`;
        }

        const statusBadge = r.status === 0
            ? '<div class="reels-status">⏳ Kutilmoqda</div>'
            : (r.status === 2
                ? '<div class="reels-status rejected">❌ Rad etilgan</div>' : '');

        // Ovoz tugmasi faqat boshqarish mumkin bo'lgan oqimda (embed'da yo'q)
        const muteBtn = (pb.type === 'file' || pb.type === 'direct'
                        || pb.type === 'hls' || pb.type === 'telegram')
            ? `<button class="reels-mute" type="button" aria-label="Ovoz">${ICON.volumeOff}</button>`
            : '';

        return `
            <div class="reels-slide" data-id="${r.id}" data-index="${index}">
                ${statusBadge}
                <div class="reels-media">${media}</div>
                ${muteBtn}
                ${metaHTML(r)}
                ${railHTML(r)}
            </div>`;
    }

    function audioLabel(r) {
        if (r.source && r.source.title) return r.source.title;
        return (r.author.name || 'W CINEMA') + ' · Asl audio';
    }

    function metaHTML(r) {
        const av = r.author.avatar
            ? `<img class="reels-author-avatar" src="${esc(r.author.avatar)}" alt="" referrerpolicy="no-referrer">`
            : `<div class="reels-author-avatar">${esc((r.author.name || '?').charAt(0))}</div>`;

        const mine = state.viewerId && r.author.id === state.viewerId;
        const follow = (!mine && r.author.id)
            ? `<button class="reels-follow${r.following ? ' on' : ''}" id="rFollow_${r.id}"
                       data-follow="${r.author.id}" type="button">${r.following ? 'Kuzatilmoqda' : 'Kuzatish'}</button>`
            : '';

        const src = r.source ? `
            <a class="reels-source" href="index.php?c=${r.source.content_id}${
                r.source.episode ? '&e=' + r.source.episode : ''}#t=${
                (r.playback && r.playback.start) || 0}">
                📺 ${esc(r.source.title)}${r.source.episode_no
                    ? ' · ' + r.source.episode_no + '-qism' : ''}
            </a>` : '';

        const cta = r.cta ? `
            <a class="reels-cta" href="${esc(r.cta.url)}">${esc(r.cta.label)}</a>` : '';

        const rej = r.status === 2 && r.reject_reason ? `
            <div class="reels-reject">❌ ${esc(r.reject_reason)}</div>` : '';

        return `
            <div class="reels-meta">
                <div class="reels-byline">
                    <a class="reels-author" href="profile.php?user_id=${r.author.id}" onclick="event.stopPropagation()">
                        ${av}
                        <span class="reels-author-name">${esc(r.author.name)}</span>
                    </a>
                    ${follow}
                </div>
                <div class="reels-caption" data-cap="${r.id}">
                    <span class="reels-cap-text">
                        ${r.title ? `<span class="reels-cap-title">${esc(r.title)}</span>` : ''}
                        ${r.description ? `<span class="reels-cap-desc">${esc(r.description)}</span>` : ''}
                    </span>
                    <button class="reels-cap-more" type="button" data-cap-more="${r.id}" hidden>… batafsil</button>
                </div>
                ${rej}${src}${cta}
                <div class="reels-audio">
                    <span class="reels-audio-ico">${ICON.music}</span>
                    <span class="reels-audio-txt">${esc(audioLabel(r))}</span>
                </div>
                <div class="reels-stats"><span id="rViews_${r.id}">${fmtViews(r.views)} ko‘rish</span></div>
            </div>`;
    }

    function railHTML(r) {
        const liked = r.liked ? ' on' : '';
        const saved = r.saved ? ' on' : '';
        const reposted = r.reposted ? ' on' : '';
        return `
            <div class="reels-side">
                <button class="reels-btn reels-like${liked}" id="rLike_${r.id}" type="button" title="Yoqish">
                    <span class="reels-btn-icon">${ICON.heart}</span>
                    <span class="reels-btn-n" id="rLikeN_${r.id}">${r.likes ? fmtViews(r.likes) : ''}</span>
                </button>
                <button class="reels-btn reels-comment" id="rComment_${r.id}" type="button" title="Izohlar">
                    <span class="reels-btn-icon">${ICON.comment}</span>
                    <span class="reels-btn-n" id="rCommentN_${r.id}">${r.comments ? fmtViews(r.comments) : ''}</span>
                </button>
                <button class="reels-btn reels-repost${reposted}" id="rRepost_${r.id}" type="button" title="Repost">
                    <span class="reels-btn-icon">${ICON.repost}</span>
                    <span class="reels-btn-n" id="rRepostN_${r.id}">${r.reposts ? fmtViews(r.reposts) : ''}</span>
                </button>
                <button class="reels-btn reels-share" id="rShare_${r.id}" type="button" title="Ulashish">
                    <span class="reels-btn-icon">${ICON.share}</span>
                </button>
                <button class="reels-btn reels-save${saved}" id="rSave_${r.id}" type="button" title="Saqlash">
                    <span class="reels-btn-icon">${ICON.bookmark}</span>
                </button>
                <button class="reels-btn reels-more" id="rMore_${r.id}" type="button" title="Yana">
                    <span class="reels-btn-icon">${ICON.more}</span>
                </button>
            </div>`;
    }

    // ================================================================ load
    async function load(reset) {
        if (state.loading) return;
        state.loading = true;

        if (reset) {
            state.items = [];
            state.offset = 0;
            state.seen.clear();
            state.slideEls = [];
            pauseAll();
            track.innerHTML = '<div class="reels-loading"><span class="spinner"></span></div>';
        }

        try {
            const q = new URLSearchParams({
                sort: state.sort,
                limit: 10,
                offset: state.offset
            });
            withMe(q);
            const d = await api('api/reels.php?' + q.toString());
            state.viewerId = Number(d.viewer_id) || 0;
            const items = d.items || [];

            if (reset && !items.length) {
                track.innerHTML = `<div class="reels-empty">
                    <div class="reels-empty-icon">${state.sort === 'mine' ? '📭' : '🎬'}</div>
                    <div>${state.sort === 'mine'
                        ? 'Siz hali reels yaratmadingiz'
                        : 'Hali reels yo‘q'}</div>
                    ${myTgId() ? '<a href="reels-upload.php">Birinchi reels yuklang →</a>' : ''}
                </div>`;
                return;
            }

            if (reset) track.innerHTML = '';
            const frag = document.createElement('div');
            const base = state.items.length;
            state.offset = base;
            items.forEach((r, k) => {
                state.items.push(r);
                frag.insertAdjacentHTML('beforeend', slideHTML(r, base + k));
            });
            track.appendChild(frag);

            state.hasMore = !!d.has_more;
            state.slideEls = Array.from(track.querySelectorAll('.reels-slide'));
            wireSlides();

            if (reset) {
                const idx = CFG.openReel
                    ? state.items.findIndex(r => r.id === CFG.openReel) : -1;
                const target = idx >= 0 ? idx : 0;
                showSlide(target, true);
            }
        } catch (e) {
            if (reset) {
                track.innerHTML = `<div class="reels-empty">
                    <div class="reels-empty-icon">⚠️</div>
                    <div>${esc(e.message)}</div></div>`;
            }
        } finally {
            state.loading = false;
        }
    }

    // ================================================================ oqim
    function mountTg(i) {
        const el = state.slideEls[i];
        if (!el) return;
        const box = el.querySelector('.reels-tg');
        if (!box || box.dataset.mounted === '1') return;
        if (!window.TgStream) return;
        box.dataset.mounted = '1';
        state.mountStartedAt = Date.now();
        window.TgStream.mount(box, {
            channel: box.dataset.channel || '',
            post:    Number(box.dataset.post) || 0,
            url:     box.dataset.url || '',
            deep:    box.dataset.deep || '',
            poster:  box.dataset.poster || '',
            onReady: function () {
                schedulePrefetch(i);
                attachVideo(i);
            }
        });
    }

    function schedulePrefetch(i) {
        if (i !== state.active) return;
        const took = Date.now() - (state.mountStartedAt || Date.now());
        if (took > 20000) return;
        if (!window.TgStream || !window.TgStream.prefetch) return;

        const next = state.slideEls[i + 1];
        if (!next) return;
        const box = next.querySelector('.reels-tg');
        if (!box || box.dataset.mounted === '1') return;
        const ch = box.dataset.channel || '';
        const post = Number(box.dataset.post) || 0;
        if (!ch || !post) return;

        window.TgStream.prefetch({
            channel: ch,
            post: post,
            url: box.dataset.url || '',
            deep: box.dataset.deep || ''
        });
    }

    function playAt(i) {
        const el = state.slideEls[i];
        if (!el) return;
        const v = el.querySelector('video');
        if (!v) { mountTg(i); return; }
        const pb = (state.items[i] || {}).playback || {};
        if (pb.start > 0 && Math.abs(v.currentTime - pb.start) > 2) {
            v.currentTime = pb.start;
        }
        v.play().catch(() => { /* avtomatik bloklangan bo'lishi mumkin */ });
    }

    function pauseAll(except) {
        state.slideEls.forEach((el, i) => {
            if (i === except) return;
            const v = el.querySelector('video');
            if (v && !v.paused) v.pause();
            const tg = el.querySelector('.reels-tg');
            if (tg && tg.dataset.mounted === '1' && window.TgStream) {
                try { window.TgStream.stop(); } catch (e) {}
                tg.dataset.mounted = '';
                tg.innerHTML = '';
            }
        });
    }

    function showSlide(i, scroll) {
        if (i < 0 || i >= state.slideEls.length) return;
        const changed = state.active !== i;
        state.active = i;
        state.mountStartedAt = Date.now();

        pauseAll(i);
        playAt(i);

        if (scroll && state.slideEls[i]) {
            state.slideEls[i].scrollIntoView({ behavior: 'auto', block: 'start' });
        }

        if (changed) {
            countView(i);
            loadTgCommentCount(i);
            syncAllMute();
            // tg player mount bo'lgach video paydo bo'ladi — ovoz holatini
            // kuzatish uchun biroz kutib ulanamiz.
            setTimeout(() => attachVideo(i), 700);
            if (i + 2 >= state.items.length && state.hasMore) {
                state.offset = state.items.length;
                load(false);
            }
        }
    }

    // ---------------------------------------------------------------- ko'rish
    function countView(i) {
        const r = state.items[i];
        if (!r || state.seen.has(r.id)) return;
        state.seen.add(r.id);

        fetch('api/reels.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            credentials: 'same-origin',
            body: withMe(new URLSearchParams({ id: r.id, action: 'view' }))
        }).then(res => res.json()).then(d => {
            if (d && d.success && r) {
                r.views = d.views;
                const n = document.getElementById('rViews_' + r.id);
                if (n) n.textContent = fmtViews(d.views) + ' ko‘rish';
            }
        }).catch(() => {});
    }

    // ---------------------------------------------------------------- ovoz
    function attachVideo(i) {
        const el = state.slideEls[i];
        if (!el) return;
        const v = el.querySelector('video');
        if (!v || v.dataset.muteBound === '1') { syncMute(el); return; }
        v.dataset.muteBound = '1';
        v.addEventListener('volumechange', () => syncMute(el));
        syncMute(el);
    }
    function syncMute(el) {
        const b = el.querySelector('.reels-mute');
        if (!b) return;
        const v = el.querySelector('video');
        const muted = v ? !!v.muted : true;
        b.classList.toggle('muted', muted);
        b.innerHTML = muted ? ICON.volumeOff : ICON.volume;
    }
    function syncAllMute() {
        const el = state.slideEls[state.active];
        if (el) syncMute(el);
    }

    // ================================================================ wiring
    function wireSlides() {
        state.slideEls.forEach((el) => {
            if (el.dataset.wired === '1') return;
            el.dataset.wired = '1';
            wireSlide(el);
        });
    }

    function wireSlide(el) {
        const id = Number(el.dataset.id) || 0;
        const r = itemById(id);
        if (!r) return;

        // ---- mute
        const mute = el.querySelector('.reels-mute');
        if (mute) mute.onclick = () => {
            const v = el.querySelector('video');
            if (!v) return;
            v.muted = !v.muted;
            syncMute(el);
        };
        syncMute(el);

        // ---- like
        const like = el.querySelector('#rLike_' + id);
        if (like) like.onclick = async () => {
            if (!myTgId()) { location.href = 'login.php'; return; }
            like.classList.add('busy');
            try {
                const d = await api('api/reels.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: withMe(new URLSearchParams({ id: r.id, action: 'like' }))
                });
                r.liked = d.liked; r.likes = d.likes;
                like.classList.toggle('on', d.liked);
                const n = el.querySelector('#rLikeN_' + id);
                if (n) n.textContent = d.likes ? fmtViews(d.likes) : '';
            } catch (e) { toast(e.message); }
            finally { like.classList.remove('busy'); }
        };

        // ---- izohlar
        const cmt = el.querySelector('#rComment_' + id);
        if (cmt) cmt.onclick = () => openComments(r);

        // ---- repost
        const rp = el.querySelector('#rRepost_' + id);
        if (rp) rp.onclick = () => toggleRepost(r, el);

        // ---- ulashish
        const share = el.querySelector('#rShare_' + id);
        if (share) share.onclick = () => shareReel(r, el);

        // ---- saqlash
        const save = el.querySelector('#rSave_' + id);
        if (save) save.onclick = () => toggleSave(r, el);

        // ---- more
        const more = el.querySelector('#rMore_' + id);
        if (more) more.onclick = () => openMenu(r);

        // ---- follow
        const fol = el.querySelector('#rFollow_' + id);
        if (fol) fol.onclick = () => toggleFollow(r, fol);

        // ---- izoh (caption): 2 qatorga qisqartirilgan, "… batafsil" bilan
        const cap = el.querySelector('.reels-caption');
        const cm = el.querySelector('.reels-cap-more');
        if (cap && cm) {
            cm.onclick = () => {
                cap.classList.toggle('open');
                cm.textContent = cap.classList.contains('open') ? 'yashirish' : '… batafsil';
            };
            const txt = cap.querySelector('.reels-cap-text');
            if (txt && txt.scrollHeight - 2 > txt.clientHeight) {
                cm.hidden = false;
            }
        }
    }

    // ---------------------------------------------------------------- like'dan
    async function toggleSave(r, el) {
        if (!myTgId()) { location.href = 'login.php'; return; }
        try {
            const d = await api('api/reels.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: withMe(new URLSearchParams({ id: r.id, action: 'save' }))
            });
            r.saved = d.saved; r.saves = d.saves;
            el.querySelector('#rSave_' + r.id).classList.toggle('on', d.saved);
            toast(d.saved ? 'Saqlandi' : 'Saqlashdan olindi');
        } catch (e) { toast(e.message); }
    }

    async function toggleRepost(r, el) {
        if (!myTgId()) { location.href = 'login.php'; return; }
        try {
            const d = await api('api/reels.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: withMe(new URLSearchParams({ id: r.id, action: 'repost' }))
            });
            r.reposted = d.reposted; r.reposts = d.reposts;
            el.querySelector('#rRepost_' + r.id).classList.toggle('on', d.reposted);
            const n = el.querySelector('#rRepostN_' + r.id);
            if (n) n.textContent = d.reposts ? fmtViews(d.reposts) : '';
            toast(d.reposted ? 'Repost qilindi' : 'Repost bekor qilindi');
        } catch (e) { toast(e.message); }
    }

    async function toggleFollow(r, btn) {
        if (!myTgId()) { location.href = 'login.php'; return; }
        btn.classList.add('busy');
        try {
            const d = await api('api/reels.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: withMe(new URLSearchParams({ id: r.author.id, action: 'follow' }))
            });
            r.following = d.following;
            btn.classList.toggle('on', d.following);
            btn.textContent = d.following ? 'Kuzatilmoqda' : 'Kuzatish';
            // Kuzatilganda foydalanuvchi chat ro'yxatiga ham qo'shiladi.
            if (d.following) {
                api('api/chat.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: withMe(new URLSearchParams({ action: 'add_contact', peer_id: r.author.id }))
                }).catch(() => {});
            }
        } catch (e) { toast(e.message); }
        finally { btn.classList.remove('busy'); }
    }

    async function shareReel(r, el) {
        const url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'reels.php?reel=' + r.id;
        try {
            if (navigator.share) {
                await navigator.share({ title: r.title, url: url });
            } else {
                await navigator.clipboard.writeText(url);
                toast('Havola nusxalandi');
            }
            fetch('api/reels.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                credentials: 'same-origin',
                body: withMe(new URLSearchParams({ id: r.id, action: 'share' }))
            }).catch(() => {});
            r.shares = (r.shares || 0) + 1;
        } catch (e) { /* bekor qilindi */ }
    }

    // ================================================================ hodisalar
    function wire() {
        let ticking = false;
        track.addEventListener('scroll', () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                ticking = false;
                const i = Math.round(track.scrollTop / track.clientHeight);
                if (i !== state.active) showSlide(i, false);
            });
        }, { passive: true });

        track.addEventListener('wheel', (e) => {
            if (Math.abs(e.deltaY) < 12) return;
            e.preventDefault();
            goTo(state.active + (e.deltaY > 0 ? 1 : -1));
        }, { passive: false });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeComments();
                closeAuthors();
                closeMenu();
                return;
            }
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
                return;
            }
            const cm = document.getElementById('commentsModal');
            if (cm && !cm.hidden) return;
            const mm = document.getElementById('reelMenu');
            if (mm && !mm.hidden) return;

            if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
                e.preventDefault(); goTo(state.active + 1);
            } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
                e.preventDefault(); goTo(state.active - 1);
            }
        });

        const prev = document.getElementById('reelsPrev');
        const next = document.getElementById('reelsNext');
        if (prev) prev.onclick = () => goTo(state.active - 1);
        if (next) next.onclick = () => goTo(state.active + 1);
    }

    function goTo(i) {
        if (i < 0) return;
        if (i >= state.slideEls.length) {
            if (state.hasMore && !state.loading) {
                state.offset = state.items.length;
                load(false);
            }
            return;
        }
        showSlide(i, true);
    }

    // ================================================================ "More"
    function menuRow(act, icon, label, cls) {
        return `<button class="reels-menu-row${cls ? ' ' + cls : ''}" data-menu-act="${act}" type="button">
            <span class="reels-menu-ico">${ICON[icon] || ''}</span>
            <span class="reels-menu-txt">${esc(label)}</span>
        </button>`;
    }

    function openMenu(r) {
        const menu = document.getElementById('reelMenu');
        const body = document.getElementById('reelMenuBody');
        if (!menu || !body) return;
        const mine = state.viewerId && r.author.id === state.viewerId;
        const rows = [
            menuRow('save', 'bookmark', r.saved ? 'Saqlashdan olish' : 'Saqlash'),
            menuRow('copy', 'link', 'Havolani nusxalash'),
            menuRow('authors', 'trophy', 'Top Authors'),
            menuRow('notint', 'eyeoff', 'Menga yoqmadi'),
            menuRow('report', 'flag', 'Shikoyat qilish')
        ];
        if (mine || CFG.isAdmin) {
            rows.push(menuRow('delete', 'trash', 'O‘chirish', 'danger'));
        }
        body.innerHTML = rows.join('');
        menu.dataset.reel = r.id;
        menu.hidden = false;
    }

    function closeMenu() {
        const menu = document.getElementById('reelMenu');
        if (menu) menu.hidden = true;
    }

    function hideReel(r) {
        const idx = state.items.findIndex(x => x.id === r.id);
        if (idx < 0) return;
        const el = state.slideEls[idx];
        state.items.splice(idx, 1);
        if (el) el.remove();
        state.slideEls = Array.from(track.querySelectorAll('.reels-slide'));
        state.active = -1;
        const target = Math.min(idx, Math.max(0, state.slideEls.length - 1));
        if (state.slideEls.length) showSlide(target, true);
    }

    document.addEventListener('click', async (e) => {
        if (e.target.closest && e.target.closest('[data-menu-close]')) { closeMenu(); return; }
        const btn = e.target.closest && e.target.closest('[data-menu-act]');
        if (!btn) return;
        const menu = document.getElementById('reelMenu');
        const r = itemById(menu && menu.dataset.reel);
        const act = btn.dataset.menuAct;
        closeMenu();
        if (!r) return;

        if (act === 'copy') {
            const url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'reels.php?reel=' + r.id;
            try { await navigator.clipboard.writeText(url); toast('Havola nusxalandi'); }
            catch (err) { prompt('Havola:', url); }
        } else if (act === 'save') {
            const el = state.slideEls[state.active];
            if (el) toggleSave(r, el);
        } else if (act === 'authors') {
            openAuthors();
        } else if (act === 'notint') {
            hideReel(r);
            toast('Menga yoqmadi — yashirildi');
        } else if (act === 'report') {
            toast('Shikoyat yuborildi. Rahmat!');
        } else if (act === 'delete') {
            if (!confirm('O‘chirilsinmi? Bu amalni qaytarib bo‘lmaydi.')) return;
            try {
                await api('api/reels.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: withMe(new URLSearchParams({ id: r.id, action: 'delete' }))
                });
                toast('O‘chirildi');
                setTimeout(() => location.reload(), 600);
            } catch (err) { toast(err.message); }
        }
    });

    // ================================================================ izohlar
    let commentsReel = null;

    // Telegram forum-guruh izohlari yoqilganmi? (tg-comments.js)
    function tgCommentsOn() {
        return !!(window.TGComments && window.TGComments.enabled());
    }

    function commentTime(ts) {
        if (!ts) return '';
        const d = new Date(String(ts).replace(' ', 'T'));
        if (isNaN(d.getTime())) return '';
        const diff = (Date.now() - d.getTime()) / 1000;
        if (diff < 60) return 'hozir';
        if (diff < 3600) return Math.floor(diff / 60) + ' daq';
        if (diff < 86400) return Math.floor(diff / 3600) + ' soat';
        if (diff < 604800) return Math.floor(diff / 86400) + ' kun';
        return d.toLocaleDateString();
    }

    function commentRow(c) {
        const mine = state.viewerId;
        const av = c.author.avatar
            ? `<img class="reels-c-av" src="${esc(c.author.avatar)}" alt="" referrerpolicy="no-referrer">`
            : `<div class="reels-c-av">${esc((c.author.name || '?').charAt(0))}</div>`;
        const del = ((mine && c.author.id === mine) || CFG.isAdmin)
            ? `<button class="reels-c-del" data-del-comment="${c.id}" title="O‘chirish">✕</button>` : '';
        return `<div class="reels-c-row" data-cid="${c.id}">
            <a class="reels-c-author" href="profile.php?user_id=${c.author.id}" onclick="event.stopPropagation()">${av}</a>
            <div class="reels-c-main">
                <a class="reels-c-name" href="profile.php?user_id=${c.author.id}">${esc(c.author.name)}</a>
                <div class="reels-c-body">${esc(c.body)}</div>
                <div class="reels-c-meta">${commentTime(c.created_at)}</div>
            </div>
            ${del}
        </div>`;
    }

    function setCommentCount(r, n) {
        if (!r || !(n >= 0)) return;
        r.comments = n;
        const cn = document.querySelector('#rCommentN_' + r.id);
        if (cn) cn.textContent = n ? fmtViews(n) : '';
        if (commentsReel && commentsReel.id === r.id) {
            const cc = document.getElementById('commentsCount');
            if (cc) cc.textContent = n ? '(' + fmtViews(n) + ')' : '';
        }
    }

    // ------------------------------------------------ izohlar soni (Telegram)
    // Izohlar serverda emas - Telegram forum-mavzusida yashaydi. DB'dagi
    // `comments` eskirgan bo'lgani uchun raqamni MTProto orqali olamiz
    // (izohlar oynasini ochmasdan, faqat ko'rinayotgan reel uchun).
    const cntAsk = new Map();

    function loadTgCommentCount(i) {
        const r = state.items[i];
        if (!r || !r.topic_id) return;
        if (!tgCommentsOn()) return;
        const TC = window.TGComments;
        if (!TC || !TC.commentCount) return;
        const key = r.id + ':' + r.topic_id;
        // GramJS hali yuklanayotgan bo'lishi mumkin - bir necha marta qayta
        // urinib ko'ramiz, keyin taslim qilamiz.
        const tries = cntAsk.get(key) || 0;
        if (tries >= 3) return;
        cntAsk.set(key, tries + 1);
        TC.commentCount(r).then((n) => {
            if (n >= 0) { cntAsk.set(key, 0); setCommentCount(r, n); }
            else { cntAsk.delete(key); }
        }).catch(() => { cntAsk.delete(key); });
    }

    async function loadComments(r) {
        const list = document.getElementById('commentsList');
        if (!list) return;
        try {
            const d = await api('api/reels.php?comments=' + r.id + '&limit=50');
            const items = d.comments || [];
            if (!items.length) {
                list.innerHTML = '<div class="reels-c-empty">Hali izoh yo‘q. Birinchi bo‘ling!</div>';
                return;
            }
            list.innerHTML = items.map(commentRow).join('');
        } catch (e) {
            list.innerHTML = '<div class="reels-c-empty">' + esc(e.message) + '</div>';
        }
    }

    async function openComments(r) {
        const modal = document.getElementById('commentsModal');
        if (!modal) return;
        commentsReel = r;
        const cc = document.getElementById('commentsCount');
        if (cc) cc.textContent = r.comments ? '(' + fmtViews(r.comments) + ')' : '';
        const list = document.getElementById('commentsList');
        if (list) list.innerHTML = '<div class="reels-c-loading"><span class="spinner"></span></div>';
        const input = document.getElementById('commentInput');
        if (input) { input.value = ''; input.style.height = 'auto'; }
        modal.hidden = false;
        if (tgCommentsOn()) {
            // Izohlar Telegram forum-guruhda (MTProto orqali).
            try { await window.TGComments.open(r); } catch (e) { /* tg-comments o'zi ko'rsatadi */ }
        } else {
            await loadComments(r);
        }
        if (input) { try { input.focus(); } catch (e) {} }
    }

    function closeComments() {
        const modal = document.getElementById('commentsModal');
        if (modal) modal.hidden = true;
        if (window.TGComments) { try { window.TGComments.close(); } catch (e) {} }
        commentsReel = null;
    }

    async function postComment(body) {
        if (!commentsReel) return false;
        const btn = document.getElementById('commentSend');
        if (btn) btn.disabled = true;
        try {
            if (tgCommentsOn()) {
                await window.TGComments.sendText(body);
                return true;
            }
            const d = await api('api/reels.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: withMe(new URLSearchParams({
                    id: commentsReel.id, action: 'comment', body: body
                }))
            });
            setCommentCount(commentsReel, d.comments);
            const list = document.getElementById('commentsList');
            if (list && d.comment) {
                const empty = list.querySelector('.reels-c-empty');
                if (empty) empty.remove();
                const wrap = document.createElement('div');
                wrap.innerHTML = commentRow(d.comment);
                list.insertBefore(wrap.firstElementChild, list.firstChild);
                list.scrollTop = 0;
            }
            return true;
        } catch (e) {
            toast(e.message);
            return false;
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    document.addEventListener('submit', async (e) => {
        const form = e.target.closest && e.target.closest('#commentForm');
        if (!form) return;
        e.preventDefault();
        const input = document.getElementById('commentInput');
        const body = (input && input.value ? input.value : '').trim();
        if (!body) return;
        const sent = await postComment(body);
        if (sent && input) { input.value = ''; input.style.height = 'auto'; }
    });

    // Kompozitor matn maydoni matn uzunligiga qarab O'SADI (chat kabi).
    const cinput = document.getElementById('commentInput');
    if (cinput) {
        cinput.addEventListener('input', (e) => {
            const t = e.target;
            t.style.height = 'auto';
            t.style.height = Math.min(120, t.scrollHeight) + 'px';
        });
        // Shift+Enter -> qator uzilishi; Enter -> yuborish.
        cinput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.shiftKey) return;
            e.preventDefault();
            const f = e.target.form;
            if (!f) return;
            if (f.requestSubmit) f.requestSubmit();
            else f.dispatchEvent(new Event('submit', { cancelable: true }));
        });
    }

    document.addEventListener('click', async (e) => {
        const del = e.target.closest && e.target.closest('[data-del-comment]');
        if (del) {
            e.preventDefault();
            const cid = Number(del.getAttribute('data-del-comment')) || 0;
            if (!cid || !confirm('Izoh o‘chirilsinmi?')) return;
            try {
                const d = await api('api/reels.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: withMe(new URLSearchParams({ action: 'comment_delete', comment_id: cid }))
                });
                const row = del.closest('.reels-c-row');
                if (row) row.remove();
                if (commentsReel) setCommentCount(commentsReel, d.comments);
            } catch (err) { toast(err.message); }
            return;
        }
        if (e.target.closest && e.target.closest('[data-close-comments]')) {
            closeComments();
        }
    });

    window.tapPlay = function (v, ev) {
        if (ev && ev.target.closest('.reels-meta, .reels-side, .reels-mute')) return;
        if (v.paused) { v.play(); } else { v.pause(); }
    };

    // ================================================================ reyting
    async function openAuthors() {
        const modal = document.getElementById('authorsModal');
        const list  = document.getElementById('authorsList');
        if (!modal) return;
        modal.hidden = false;
        list.innerHTML = '<div class="loading"><span class="spinner"></span>…</div>';
        try {
            const d = await api('api/reel-authors.php?sort=' + (state.sort === 'mine' ? 'mine' : 'all'));
            if (!d.users || !d.users.length) {
                list.innerHTML = '<p style="color:var(--muted);font-size:13px">Hali reyting yo‘q</p>';
                return;
            }
            list.innerHTML = d.users.map(u => `
                <div class="author-row">
                    <div class="author-rank">${u.rank}</div>
                    ${u.avatar
                        ? `<img class="author-av" src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">`
                        : `<div class="author-av">${esc((u.name || '?').charAt(0))}</div>`}
                    <div class="author-info">
                        <div class="author-name">${esc(u.name)}</div>
                        <div class="author-sub">${u.reels} reels · 👁 ${fmtViews(u.views)} · ❤️ ${fmtViews(u.likes)}</div>
                    </div>
                    <div class="author-score">${fmtViews(u.score)}</div>
                </div>`).join('');
        } catch (e) {
            list.innerHTML = '<p style="color:#ff9a9a;font-size:13px">' + esc(e.message) + '</p>';
        }
    }

    function closeAuthors() {
        const m = document.getElementById('authorsModal');
        if (m) m.hidden = true;
    }

    document.addEventListener('click', (e) => {
        if (e.target.closest('[data-close-authors]')) { closeAuthors(); }
    });

    // ---------------------------------------------------------------- start
    // Instagram Reels'da saralash tablari yo'q — oqim har doim "yangi".
    if (!myTgId()) {
        const fab = document.getElementById('reelsFab');
        if (fab) fab.remove();
    }

    // ---------------------------------------------------------------- teardown
    function releaseAll() {
        if (window.TgStream) {
            try { window.TgStream.release(); } catch (e) {}
        }
    }
    window.addEventListener('pagehide', releaseAll);
    window.addEventListener('beforeunload', releaseAll);
    document.addEventListener('click', (e) => {
        const a = e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        if (a.target === '_blank' || a.hasAttribute('download')) return;
        const href = a.getAttribute('href') || '';
        if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) return;
        if (a.host && a.host !== location.host) return;
        releaseAll();
    }, true);

    wire();
    load(true);

    // tg-comments.js "yangi izoh qo'shdim / o'chirdim" deganida yon
    // paneldagi raqamni shu orqali darhol yangilaydi.
    window.TGReels = { setCommentCount: setCommentCount, loadCommentCount: loadTgCommentCount };

    const wa = window.Telegram && window.Telegram.WebApp;
    if (wa) { wa.ready(); wa.expand(); }
})();
