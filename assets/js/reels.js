/* ==========================================================================
   W CINEMA - Reels oqimi
   ========================================================================== */
(function () {
    'use strict';

    const CFG = window.REELS || {};
    const track   = document.getElementById('reelsTrack');
    const sideBody = document.getElementById('reelsSideBody');
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

    // ---------------------------------------------------------------- state
    const state = {
        sort: 'new',
        items: [],
        offset: 0,
        hasMore: false,
        loading: false,
        active: -1,          // hozir ko'rsatilayotgan slayd indeksi
        seen: new Set(),     // ko'rish uchun hisobga olingan reel idlar
        slideEls: []
    };

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

    // ================================================================ render
    function slideHTML(r) {
        const pb = r.playback || {};
        let media;

        if (pb.type === 'file' || pb.type === 'direct' || pb.type === 'hls') {
            // Virtual reel (clip) bo'lsa, boshlanish vaqtiga sakraydi
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

        return `
            <div class="reels-slide" data-id="${r.id}" data-index="${state.items.length}">
                ${statusBadge}
                ${media}
            </div>`;
    }

    function metaHTML(r) {
        const av = r.author.avatar
            ? `<img class="reels-author-avatar" src="${esc(r.author.avatar)}" alt="">`
            : `<div class="reels-author-avatar">${esc((r.author.name || '?').charAt(0))}</div>`;

        const src = r.source ? `
            <a class="reels-source" href="index.php?c=${r.source.content_id}${
                r.source.episode ? '&e=' + r.source.episode : ''}#t=${
                (r.playback && r.playback.start) || 0}">
                📺 ${esc(r.source.title)}${r.source.episode_no
                    ? ' · ' + r.source.episode_no + '-qism' : ''}
            </a>` : '';

        const cta = r.cta ? `
            <a class="reels-cta" href="${esc(r.cta.url)}">${esc(r.cta.label)}</a>` : '';

        // Rad etilgan reelda sababni ko'rsatamiz. Aks holda muallif
        // "yo'qoldi, nima bo'ldi?" deb o'ylab, qayta yubora boshlaydi
        // (yoki butunay tashlab ketadi).
        const rej = r.status === 2 && r.reject_reason ? `
            <div class="reels-reject">❌ ${esc(r.reject_reason)}</div>` : '';

        return `
            <a class="reels-author" href="profile.php?user_id=${r.author.id}" onclick="event.stopPropagation()">
                ${av}
                <span class="reels-author-name">${esc(r.author.name)}</span>
            </a>
            <div class="reels-title">${esc(r.title)}</div>
            ${r.description ? `<div class="reels-desc">${esc(r.description)}</div>` : ''}
            ${rej}${src}${cta}`;
    }

    function sideHTML(r) {
        return `
            <button class="reels-btn${r.liked ? ' on' : ''}" id="rLike_${r.id}" title="Yoqish">
                <span class="reels-btn-icon">${r.liked ? '❤️' : '🤍'}</span>
                <span class="reels-btn-n">${fmtViews(r.likes)}</span>
            </button>
            <div class="reels-btn" style="pointer-events:none">
                <span class="reels-btn-icon">👁</span>
                <span class="reels-btn-n">${fmtViews(r.views)}</span>
            </div>
            <button class="reels-btn" id="rShare_${r.id}" title="Ulashish">
                <span class="reels-btn-icon">↗</span>
            </button>
            <button class="reels-btn" id="rAuthors" title="Top Authors">
                <span class="reels-btn-icon">🏆</span>
            </button>
            ${(CFG.userId && r.author.id === CFG.userId) ? `
            <button class="reels-btn" id="rDel_${r.id}" title="O'chirish">
                <span class="reels-btn-icon">🗑</span>
            </button>` : ''}`;
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
            const d = await api('api/reels.php?' + q.toString());
            const items = d.items || [];

            if (reset && !items.length) {
                track.innerHTML = `<div class="reels-empty">
                    <div class="reels-empty-icon">${state.sort === 'mine' ? '📭' : '🎬'}</div>
                    <div>${state.sort === 'mine'
                        ? 'Siz hali reels yaratmadingiz'
                        : 'Hali reels yo‘q'}</div>
                    ${CFG.userId ? '<a href="reels-upload.php">Birinchi reels yuklang →</a>' : ''}
                </div>`;
                return;
            }

            if (reset) track.innerHTML = '';
            const frag = document.createElement('div');
            state.offset = state.items.length;
            items.forEach((r) => {
                state.items.push(r);
                frag.insertAdjacentHTML('beforeend', slideHTML(r));
            });
            track.appendChild(frag);

            state.hasMore = !!d.has_more;
            state.slideEls = Array.from(track.querySelectorAll('.reels-slide'));

            if (reset) {
                wire();
                // Chuqur havola bilan ochilgan reel
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
    function playAt(i) {
        const el = state.slideEls[i];
        if (!el) return;
        const v = el.querySelector('video');
        if (!v) return;
        // Avval to'g'rilash (clip bo'lsa)
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
        });
    }

    function showSlide(i, scroll) {
        if (i < 0 || i >= state.slideEls.length) return;
        const changed = state.active !== i;
        state.active = i;

        pauseAll(i);
        playAt(i);

        if (scroll && state.slideEls[i]) {
            state.slideEls[i].scrollIntoView({ behavior: 'auto', block: 'start' });
        }

        if (changed) {
            renderSide(i);
            countView(i);
            // Yaqinlikda tugadi - oldindan yuklab qo'yamiz
            if (i + 2 >= state.items.length && state.hasMore) {
                state.offset = state.items.length;
                load(false);
            }
        }
    }

    let sideIdx = -1;
    function renderSide(i) {
        if (i === sideIdx) return;
        sideIdx = i;
        const r = state.items[i];
        if (!r || !sideBody) return;

        sideBody.innerHTML = sideHTML(r);

        const meta = document.getElementById('reelsMeta');
        if (meta) meta.innerHTML = metaHTML(r);

        wireSide(r);
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
            body: new URLSearchParams({ id: r.id, action: 'view' })
        }).then(res => res.json()).then(d => {
            if (d && d.success && r) {
                r.views = d.views;
                // panelni yangilash
                const n = sideBody.querySelectorAll('.reels-btn-n')[1];
                if (n) n.textContent = fmtViews(d.views);
            }
        }).catch(() => {});
    }

    // ================================================================ hodisalar
    function wire() {
        // scroll -> aktiv slaydni aniqlash
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

        // Sichqoncha gildirish (kompyuterda)
        track.addEventListener('wheel', (e) => {
            if (Math.abs(e.deltaY) < 12) return;
            e.preventDefault();
            goTo(state.active + (e.deltaY > 0 ? 1 : -1));
        }, { passive: false });

        // Klaviatura
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
                e.preventDefault(); goTo(state.active + 1);
            } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
                e.preventDefault(); goTo(state.active - 1);
            } else if (e.key === 'Escape') {
                closeAuthors();
            }
        });
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

    function wireSide(r) {
        // ---- like
        const like = document.getElementById('rLike_' + r.id);
        if (like) like.onclick = async () => {
            if (!CFG.userId) {
                location.href = 'login.php';
                return;
            }
            like.classList.add('busy');
            try {
                const d = await api('api/reels.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ id: r.id, action: 'like' })
                });
                r.liked = d.liked;
                r.likes = d.likes;
                like.classList.toggle('on', d.liked);
                like.querySelector('.reels-btn-icon').textContent = d.liked ? '❤️' : '🤍';
                like.querySelector('.reels-btn-n').textContent = fmtViews(d.likes);
            } catch (e) {
                alert(e.message);
            } finally {
                like.classList.remove('busy');
            }
        };

        // ---- ulashish
        const share = document.getElementById('rShare_' + r.id);
        if (share) share.onclick = async () => {
            const url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'reels.php?reel=' + r.id;
            try {
                if (navigator.share) {
                    await navigator.share({ title: r.title, url: url });
                } else {
                    await navigator.clipboard.writeText(url);
                    share.querySelector('.reels-btn-icon').textContent = '✓';
                    setTimeout(() => { share.querySelector('.reels-btn-icon').textContent = '↗'; }, 1500);
                }
                fetch('api/reels.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    credentials: 'same-origin',
                    body: new URLSearchParams({ id: r.id, action: 'share' })
                }).catch(() => {});
            } catch (e) { /* bekor qilindi */ }
        };

        // ---- o'chirish
        const del = document.getElementById('rDel_' + r.id);
        if (del) del.onclick = async () => {
            if (!confirm('O‘chirilsinmi? Bu amalni qaytarib bo‘lmaydi.')) return;
            try {
                await api('api/reels.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ id: r.id, action: 'delete' })
                });
                alert('O‘chirildi');
                location.reload();
            } catch (e) { alert(e.message); }
        };
    }

    // Ekranni bosish - video o'ynash/to'xtatish
    window.tapPlay = function (v, ev) {
        if (ev && ev.target.closest('.reels-meta, .reels-side')) return;
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
            // Reyting oqimga qarab o'zgaradi: "mine" da o'z natijangiz
            const d = await api('api/reel-authors.php?sort=' + (state.sort === 'mine' ? 'mine' : 'all'));
            if (!d.users || !d.users.length) {
                list.innerHTML = '<p style="color:var(--muted);font-size:13px">Hali reyting yo‘q</p>';
                return;
            }
            list.innerHTML = d.users.map(u => `
                <div class="author-row">
                    <div class="author-rank">${u.rank}</div>
                    ${u.avatar
                        ? `<img class="author-av" src="${esc(u.avatar)}" alt="">`
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
        if (e.target.closest('#rAuthors')) { openAuthors(); return; }
        if (e.target.closest('[data-close-authors]')) { closeAuthors(); }
    });

    // ================================================================ tabs
    document.addEventListener('click', (e) => {
        const tab = e.target.closest('#reelsTabs .reels-tab');
        if (!tab) return;
        document.querySelectorAll('#reelsTabs .reels-tab')
            .forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.sort = tab.dataset.sort;
        sideIdx = -1;
        load(true);
    });

    // ---------------------------------------------------------------- start
    // "Mening" tabi faqat login qilganlarga
    if (!CFG.userId) {
        const mine = document.querySelector('#reelsTabs .reels-tab[data-sort="mine"]');
        if (mine) mine.remove();
    }

    // reels-meta qutisi (sahifada yo'q bo'lsa yaratamiz)
    if (!document.getElementById('reelsMeta')) {
        const m = document.createElement('div');
        m.className = 'reels-meta';
        m.id = 'reelsMeta';
        document.body.appendChild(m);
    }

    load(true);

    const wa = window.Telegram && window.Telegram.WebApp;
    if (wa) { wa.ready(); wa.expand(); }
})();
