// ============================================================================
// profile.js - Instagram uslubidagi profil sahifasi
// ============================================================================
// api/profile.php orqali: sarlavha, statistika, highlightlar va yorliq
// grid'larini yuklaydi. Yorliqlar (Reels/Yoqqanlar/Saqlangan) alohida
// yuklanadi, scroll pastda bo'lganda keyingi qism (offset) keladi.
// ============================================================================

const API_BASE   = 'api/profile.php';
const PAGE_SIZE  = 30;

const $  = (s) => document.querySelector(s);
const state = {
    tab: 'reels',
    offset: 0,
    hasMore: true,
    loading: false,
    data: null,     // api javobi (user, stats, is_me...)
    locked: false,  // profil maxfiy — grid ko'rsatilmaydi
};

// Grid yorliqlari (localStorage rejimi uchun alohida ro'yxat bor)
const GRID_TABS = ['reels', 'posts', 'videos', 'liked', 'saved', 'history'];

// Kutubxona (chap panel) havolalari: profile.php?tab=liked / ?tab=saved / ?tab=history
try {
    const q = new URLSearchParams(location.search).get('tab');
    if (GRID_TABS.includes(q)) state.tab = q;
} catch (e) {}

const els = {
    title:     $('#pfTitle'),
    avatar:    $('#pfAvatar'),
    name:      $('#pfName'),
    username:  $('#pfUsername'),
    bio:       $('#pfBio'),
    privBadge: $('#pfPrivateBadge'),
    locked:    $('#pfLocked'),
    stats:     $('#pfStats'),
    actions:   $('#pfActions'),
    hlWrap:    $('#pfHighlightsWrap'),
    highlights: $('#pfHighlights'),
    uploadBtn: $('#pfUploadBtn'),
    logoutBtn: $('#pfLogoutBtn'),
    setBtn:    $('#pfSettingsBtn'),
    grid:      $('#pfGrid'),
    empty:     $('#pfEmpty'),
    more:      $('#pfMore'),
    toast:     $('#pfToast'),
    modal:     $('#pfModal'),
    editForm:  $('#pfEditForm'),
    editErr:   $('#pfEditErr'),
    tabs:      $('#pfTabs'),
};

// Mahalliy rejim: PHP hisobi yo'q, faqat Telegram (MTProto) hisobi bilan
// kirilgan. Ma'lumot localStorage'dan (wc_tg_me_v1 + WCLib) olinadi.
const LOCAL = !PROFILE_ME_ID && !PROFILE_VIEW_ID;
if (LOCAL && (state.tab === 'reels' || state.tab === '' || state.tab === 'posts' || state.tab === 'videos')) state.tab = 'saved';

// =======================================================================
// Kichik yordamchilar
// =======================================================================
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function fmt(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
}

function avatarHTML(user) {
    const init = esc(((user.first_name || user.username || '?').charAt(0) || '?').toUpperCase());
    if (user.avatar) {
        // Rasm yuklanmasa - harf bilan almashtiriladi (onerror ichida " ishlatilmaydi!)
        return `<span class="pf-avatar-box">
            <img class="pf-avatar-img" loading="lazy" src="${esc(user.avatar)}" alt=""
                 onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
            <span class="pf-avatar-init" style="display:none">${init}</span>
        </span>`;
    }
    return `<span class="pf-avatar-init">${init}</span>`;
}

function showToast(msg, ok = true) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    els.toast.classList.toggle('err', !ok);
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { els.toast.hidden = true; }, 3200);
}

async function apiGet(url) {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const d = await r.json().catch(() => null);
    return d;
}

function profileUrl(id) {
    return 'profile.php' + (id ? '?user_id=' + id : '');
}

// =======================================================================
// Sarlavha
// =======================================================================
function renderHeader() {
    const u = state.data.user;
    const st = state.data.stats || {};
    state.locked = !!state.data.is_private && !state.data.is_me;

    els.title.textContent = u.username ? '@' + u.username : (u.first_name || 'Profil');
    document.title = (u.username ? '@' + u.username : (u.first_name || 'Profil')) + ' — ' + SITE_NAME;

    els.avatar.innerHTML = avatarHTML(u);
    els.name.textContent = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
    els.username.textContent = u.username ? '@' + u.username : '';
    els.bio.textContent = u.bio || '';
    if (els.privBadge) els.privBadge.hidden = !u.is_private;
    if (els.locked) els.locked.hidden = !state.locked;

    // Maxfiy profil bo'lsa grid va highlightlar ko'rsatilmaydi.
    if (els.tabs) els.tabs.hidden = state.locked;
    if (state.locked) {
        els.grid.innerHTML = '';
        els.empty.hidden = true;
        els.more.hidden = true;
    }

    // statistika
    els.stats.querySelector('[data-k="reels"]').textContent  = fmt(st.approved ?? st.reels ?? 0);
    els.stats.querySelector('[data-k="views"]').textContent  = fmt(st.views);
    els.stats.querySelector('[data-k="likes"]').textContent  = fmt(st.likes);

    // highlightlar
    if (!state.locked && state.data.highlights && state.data.highlights.length) {
        els.highlights.innerHTML = state.data.highlights.map((h) => `
            <a class="pf-hl" href="reels.php?reel=${h.id}" title="${esc(h.title)}">
                <span class="pf-hl-ring">
                    ${h.poster
                        ? `<img loading="lazy" src="${esc(h.poster)}" alt="">`
                        : `<span class="pf-hl-play">&#127916;</span>`}
                </span>
                <span class="pf-hl-label">${esc(h.title.slice(0, 18))}</span>
            </a>`).join('');
        els.hlWrap.hidden = false;
    } else {
        els.hlWrap.hidden = true;
    }
}

function renderActions() {
    const isMe = !!state.data.is_me;
    const isAdmin = !!state.data.is_admin;

    els.uploadBtn.hidden = !isMe;
    els.logoutBtn.hidden = !isMe;
    if (els.setBtn) els.setBtn.hidden = !isMe;

    if (!state.data.user.id) return;

    if (isMe) {
        els.actions.innerHTML = `
            <button class="pf-btn prim" id="pfEditBtn">&#9998; Tahrirlash</button>
            <a class="pf-btn" href="reels-upload.php">&#10133; Joylash</a>
            <a class="pf-btn ghost" href="settings.php">&#9881; Sozlamalar</a>
            ${isAdmin ? `
            <a class="pf-btn ghost" href="admin-content.php">&#128736; Admin</a>` : ''}`;
        $('#pfEditBtn').onclick = openModal;
    } else {
        const following = !!state.data.following;
        els.actions.innerHTML = `
            <button class="pf-btn ${following ? 'ghost' : 'prim'}" id="pfFollowBtn">${following ? 'Kuzatilmoqda' : 'Kuzatish'}</button>
            <a class="pf-btn soft" href="chat.php?u=${encodeURIComponent(state.data.user.id)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21.3 4.3 3.2 11.4a.55.55 0 0 0 .06 1.04l4.6 1.45 1.45 4.6a.55.55 0 0 0 1.04.06L21.3 4.3z"/><path d="M7.86 13.89 21.3 4.3"/></svg>
                Xabar
            </a>
            <button class="pf-btn ghost pf-block-btn" id="pfBlockBtn">${state.data.blocked ? 'Blokdan chiqarish' : 'Bloklash'}</button>`;
        const fb = $('#pfFollowBtn');
        if (fb) fb.onclick = () => toggleFollowProfile(fb);
        const bb = $('#pfBlockBtn');
        if (bb) bb.onclick = () => toggleBlockProfile(bb);
    }

    // Yorliqlar: faqat o'z profilida "Yoqqanlar" va "Saqlangan"
    document.querySelectorAll('.pf-tab[data-self]').forEach((b) => {
        b.hidden = !isMe;
    });
    // O'ziniki bo'lmasa, faqat kontent yorliqlari ochiladi
    if (!isMe && (state.tab === 'liked' || state.tab === 'saved')) {
        switchTab('reels');
    }
}

/**
 * Profilni bloklash / blokdan chiqarish.
 *
 * Blok qoidasi (serverda ham tekshiriladi):
 *   · bloklangan foydalanuvchi bu profilni (va kontentini) ko'ra olmaydi
 *   · bu profilga xabar yubora olmaydi
 */
async function toggleBlockProfile(btn) {
    const uid = state.data && state.data.user && state.data.user.id;
    if (!uid) return;
    const blocked = !!state.data.blocked;
    const raw = localMeRaw();

    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = blocked ? 'Ochirilmoqda…' : 'Bloklanmoqda…';
    try {
        const body = new URLSearchParams({
            action: blocked ? 'unblock' : 'block',
            user_id: String(uid)
        });
        if (raw) body.set('tg_me', raw);
        const r = await fetch('api/settings.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const d = await r.json().catch(() => null);
        if (d && d.success) {
            state.data.blocked = !!d.blocked;
            btn.textContent = state.data.blocked ? 'Blokdan chiqarish' : 'Bloklash';
            showToast(state.data.blocked ? 'Foydalanuvchi bloklandi' : 'Blokdan chiqarildi');
            if (state.data.blocked) {
                // Blokdan keyin profil ko'rinmaydi — o'z profiliga qaytamiz
                setTimeout(() => { location.href = 'profile.php'; }, 900);
            }
        } else {
            btn.textContent = old;
            showToast((d && d.message) || 'Xatolik yuz berdi');
        }
    } catch (e) {
        btn.textContent = old;
        showToast('Tarmoq xatosi');
    } finally {
        btn.disabled = false;
    }
}

// Kuzatish / kuzatishni bekor qilish (boshqa profil). Follow bosilganda
// foydalanuvchi chat ro'yxatiga ham qo'shiladi ("Xabar" bilan bir xil).
async function toggleFollowProfile(btn) {
    const uid = state.data && state.data.user && state.data.user.id;
    if (!uid) return;
    const raw = localMeRaw();
    btn.disabled = true;
    try {
        const body = new URLSearchParams({ action: 'follow', id: String(uid) });
        if (raw) body.set('tg_me', raw);
        const r = await fetch('api/reels.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const d = await r.json().catch(() => null);
        if (d && d.following === true) {
            btn.textContent = 'Kuzatilmoqda';
            btn.classList.remove('prim'); btn.classList.add('ghost');
            const cb = new URLSearchParams({ action: 'add_contact', peer_id: String(uid) });
            if (raw) cb.set('tg_me', raw);
            fetch('api/chat.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: cb.toString(),
            }).catch(() => {});
        } else if (d && d.following === false) {
            btn.textContent = 'Kuzatish';
            btn.classList.remove('ghost'); btn.classList.add('prim');
        } else {
            showToast((d && d.message) || 'Xatolik yuz berdi');
        }
    } catch (e) {
        showToast('Tarmoq xatosi');
    } finally {
        btn.disabled = false;
    }
}

// =======================================================================
// Grid
// =======================================================================
function reelCell(r) {
    const poster = r.poster
        ? `<img loading="lazy" src="${esc(r.poster)}" alt="">`
        : `<div class="pf-cell-ph">${r.format === 'post' ? '&#128247;' : '&#127916;'}</div>`;
    const badge = r.status !== 1
        ? (r.status === 0
            ? '<span class="pf-badge">&#9203;</span>'
            : '<span class="pf-badge bad">&#10005;</span>')
        : '';

    // Galereya (carousel) va format belgilari
    let tags = '';
    if (r.is_carousel) {
        tags += `<span class="pf-cell-tag" title="Galereya: ${r.media_count} ta rasm">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
                 stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3" width="13" height="13" rx="2"/><path d="M16 19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/></svg>
            ${r.media_count}</span>`;
    } else if (r.format === 'video') {
        tags += '<span class="pf-cell-tag" title="Uzun video">&#128250;</span>';
    } else if (r.format === 'post') {
        tags += '<span class="pf-cell-tag" title="Rasm post">&#128247;</span>';
    }

    // Reels (vertikal) boshqalardan ko'rinishi bilan ajralsin
    const cls = 'pf-cell' + (r.aspect === '9:16' ? ' tall' : r.aspect === '16:9' ? ' wide' : '');

    return `
        <a class="${cls}" href="reels.php?reel=${r.id}">
            <div class="pf-cell-media">
                ${poster}
                ${badge}
                ${tags}
                <div class="pf-cell-meta">&#128065; ${fmt(r.views)} <i>&#183;</i> &#10084; ${fmt(r.likes)}</div>
            </div>
        </a>`;
}

function savedCell(c) {
    const poster = c.poster
        ? `<img loading="lazy" src="${esc(c.poster)}" alt="">`
        : `<div class="pf-cell-ph">🎬</div>`;
    return `
        <a class="pf-cell" href="watch.php?c=${c.id}">
            <div class="pf-cell-media">
                ${poster}
                <div class="pf-cell-meta">${esc((c.category || '').slice(0, 14))}</div>
            </div>
        </a>`;
}

// Saqlanganlar gridi aralash bo'lishi mumkin: reels (server) + kontent.
// Boshqa yorliqlarda (reels / posts / videos / liked) hamma element — reel,
// shuning uchun to'g'ridan-to'g'ri reelCell ishlatiladi.
function cellFor(it, tab) {
    if (tab === 'saved') {
        return (it && it.type === 'reel') ? reelCell(it) : savedCell(it);
    }
    return (it && it.type === 'content') ? savedCell(it) : reelCell(it);
}

async function loadTab(tab, reset) {
    if (LOCAL) return;   // mahalliy rejimda API chaqirilmaydi
    if (!state.data) {
        // Profil hali yuklanmagan - avval sarlavhani kuting
        return;
    }
    // Maxfiy profil: kontent umuman yuklanmaydi (server ham 403 beradi).
    if (state.locked) {
        if (reset) {
            els.grid.innerHTML = '';
            els.empty.hidden = true;
        }
        return;
    }
    if (state.loading) return;
    if (!reset && !state.hasMore) return;

    state.loading = true;
    els.more.hidden = true;

    const qs = ['tab=' + encodeURIComponent(tab),
        'offset=' + state.offset,
        'limit=' + PAGE_SIZE];
    if (PROFILE_VIEW_ID) {
        qs.push('user_id=' + PROFILE_VIEW_ID);
    }
    const meRawTab = localMeRaw();
    if (meRawTab) qs.push('tg_me=' + encodeURIComponent(meRawTab));

    const d = await apiGet(API_BASE + '?' + qs.join('&'));
    state.loading = false;

    if (!d || !Array.isArray(d.items)) {
        showToast('Ma\'lumot yuklanmadi', false);
        return;
    }

    if (reset) {
        els.grid.innerHTML = '';
        state.offset = 0;
        state.hasMore = true;
    }

    if (!d.items.length) {
        state.hasMore = false;
        renderEmpty();
        els.more.hidden = true;
        return;
    }

    els.empty.hidden = true;
    els.grid.insertAdjacentHTML('beforeend', d.items.map((it) =>
        cellFor(it, tab)).join(''));

    state.offset += d.items.length;
    state.hasMore = !!d.has_more;
    if (state.hasMore) els.more.hidden = false;
}

/** Har yorliq uchun bo'sh holat matni. */
const EMPTY_TEXT = {
    reels:  'Hali reels yo‘q — birinchi reelsingizni yuklang! \u{1F4FA}',
    posts:  'Rasm postlar yo‘q — bitta yoki bir nechta rasm qo‘shing \u{1F5BC}',
    videos: 'Uzun videolar yo‘q — YouTube uslubidagi video yuklang \u{1F4FA}',
    liked:  'Hali hech narsani yoqtirmagansiz \u{1F49D}',
    saved:  'Saqlanganlar bo‘sh — reels yoki film saqlang \u{1F516}',
};

function renderEmpty() {
    const tab = state.tab;
    const mine = state.data && state.data.is_me;
    els.empty.textContent = EMPTY_TEXT[tab]
        || (mine ? EMPTY_TEXT.reels : 'Hali kontent yo‘q');
    els.empty.hidden = false;
}

// =======================================================================
// Tahrirlash modali
// =======================================================================
function openModal() {
    const u = state.data.user;
    els.editForm.first_name.value = u.first_name || '';
    els.editForm.last_name.value  = u.last_name || '';
    els.editForm.username.value   = u.username || '';
    els.editForm.avatar.value     = u.avatar || '';
    els.editForm.bio.value        = u.bio || '';
    els.editErr.textContent = '';
    els.modal.hidden = false;
    els.modal.classList.add('open');
}

function closeModal() {
    els.modal.classList.remove('open');
    setTimeout(() => { els.modal.hidden = true; }, 150);
}

els.editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.editErr.textContent = '';

    const body = new URLSearchParams();
    body.set('first_name', els.editForm.first_name.value.trim());
    body.set('last_name',  els.editForm.last_name.value.trim());
    body.set('username',   els.editForm.username.value.trim());
    body.set('avatar',     els.editForm.avatar.value.trim());
    body.set('bio',        els.editForm.bio.value.trim());

    const saveBtn = $('#pfModalSave');
    const oldTxt = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saqlanmoqda…';

    try {
        const r = await fetch('api/profile-update.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const d = await r.json().catch(() => null);
        if (r.ok && d && d.updated) {
            closeModal();
            showToast(d.message || '✅ Profil yangilandi');
            await loadProfile();
        } else {
            els.editErr.textContent = (d && d.message) || 'Xatolik yuz berdi';
        }
    } catch (err) {
        els.editErr.textContent = 'Tarmoq xatosi';
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = oldTxt;
    }
});

// =======================================================================
// Yorliqlar va scroll
// =======================================================================
function switchTab(tab) {
    state.tab = tab;
    state.offset = 0;
    state.hasMore = true;
    document.querySelectorAll('.pf-tab').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    els.grid.innerHTML = '';
    els.empty.hidden = true;
    loadTab(tab, true);
}

document.querySelectorAll('.pf-tab').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
});

// Infinitiya scroll
window.addEventListener('scroll', () => {
    if (state.loading || !state.hasMore) return;
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 400) {
        loadTab(state.tab, false);
    }
});

// =======================================================================
// MAHALLIY (MTProto) REJIM — localStorage'dagi kutubxona
// =======================================================================
function localTgUser() {
    let m = null;
    try {
        const raw = localStorage.getItem('wc_tg_me_v1');
        if (raw) m = JSON.parse(raw);
    } catch (e) {}
    if ((!m || !m.id) && window.TgStream && typeof window.TgStream.me === 'function') {
        try { m = window.TgStream.me(); } catch (e) {}
    }
    return m || {};
}

// Telegram profil rasmi (TgStream tomonidan data-URL sifatida saqlanadi).
function localPhoto() {
    try { return localStorage.getItem('wc_tg_photo_v1') || ''; } catch (e) { return ''; }
}

function localCell(c) {
    const poster = c.poster
        ? `<img loading="lazy" src="${esc(c.poster)}" alt="">`
        : `<div class="pf-cell-ph">🎬</div>`;
    const sub = String(c.category || c.year || '').slice(0, 14);
    return `
        <a class="pf-cell" href="watch.php?c=${encodeURIComponent(c.id)}">
            <div class="pf-cell-media">
                ${poster}
                ${sub ? `<div class="pf-cell-meta">${esc(sub)}</div>` : ''}
            </div>
        </a>`;
}

function mergeSavedCell(it) {
    return (it && it.type === 'reel') ? reelCell(it) : localCell(it);
}

// Serverda saqlangan reelslar (bookmark). Telegram-only rejimda ham ishlashi
// uchun `tg_me` (wc_tg_me_v1) so'rovga qo'shiladi.
function localMeRaw() {
    try { return localStorage.getItem('wc_tg_me_v1') || ''; } catch (e) { return ''; }
}
async function fetchSavedReels() {
    const qs = new URLSearchParams({ sort: 'saved', limit: 36, offset: 0 });
    const raw = localMeRaw();
    if (raw) qs.set('tg_me', raw);
    const d = await apiGet('api/reels.php?' + qs.toString());
    const items = (d && Array.isArray(d.items)) ? d.items : [];
    return items.map((r) => Object.assign({ type: 'reel' }, r));
}

const LOCAL_TABS = [
    { k: 'saved',   label: 'Saqlangan' },
    { k: 'liked',   label: 'Yoqqanlar' },
    { k: 'history', label: 'Tarix' },
];

function renderLocalHeader() {
    const u = localTgUser();
    const first = u.firstName || '';
    const full  = [first, u.lastName || ''].filter(Boolean).join(' ') || 'Foydalanuvchi';

    els.title.textContent = u.username ? '@' + u.username : full;
    document.title = (u.username ? '@' + u.username : full) + ' — ' + SITE_NAME;

    els.avatar.innerHTML = avatarHTML({
        first_name: first,
        username: u.username || '',
        avatar: localPhoto()
    });
    els.name.textContent = full;
    els.username.textContent = u.username ? '@' + u.username : '';
    els.bio.textContent = '';

    // Statistika — mahalliy kutubxona
    const c = (window.WCLib ? window.WCLib.counts() : { saved: 0, liked: 0, history: 0 });
    els.stats.innerHTML =
        `<div class="pf-stat"><b>${fmt(c.saved)}</b><span>Saqlangan</span></div>` +
        `<div class="pf-stat"><b>${fmt(c.liked)}</b><span>Yoqqan</span></div>` +
        `<div class="pf-stat"><b>${fmt(c.history)}</b><span>Tarix</span></div>`;

    els.hlWrap.hidden = true;
    els.uploadBtn.hidden = true;
    els.logoutBtn.hidden = true;

    // Amallar: Sozlamalar + Telegram bot
    els.actions.innerHTML = `
        <button class="pf-btn prim" id="pfSetBtn">⚙️ Sozlamalar</button>
        <a class="pf-btn ghost" href="https://t.me/${esc(APP_BOT || 'w_cinema_uz_bot')}" target="_blank" rel="noopener">✈️ Bot</a>`;
    const sb = $('#pfSetBtn');
    if (sb) sb.addEventListener('click', () => {
        const more = document.getElementById('igMoreBtn') || document.getElementById('igMoreBtnM');
        if (more) more.click();
    });

    // Yorliqlar (mahalliy)
    els.tabs.innerHTML = LOCAL_TABS.map((t) =>
        `<button class="pf-tab${t.k === state.tab ? ' active' : ''}" data-tab="${t.k}">${t.label}</button>`
    ).join('');
    els.tabs.querySelectorAll('.pf-tab').forEach((b) => {
        b.addEventListener('click', () => switchTabLocal(b.dataset.tab));
    });

    renderLocalTab(state.tab);
}

function renderLocalTab(tab) {
    state.tab = tab;
    state.hasMore = false;
    state.offset = 0;
    els.grid.innerHTML = '';

    const items = (window.WCLib ? window.WCLib.list(tab) : []) || [];

    function paint(reelItems) {
        const all = (reelItems || []).concat(items);
        if (!all.length) {
            els.empty.textContent = tab === 'liked' ? 'Hali hech narsani yoqtirmagansiz 🤍'
                : tab === 'history' ? 'Ko\'rish tarixi bo\'sh 🕓'
                : 'Saqlanganlar bo\'sh — reels yoki film saqlang 🔖';
            els.empty.hidden = false;
            return;
        }
        els.empty.hidden = true;
        els.grid.innerHTML = all.map(mergeSavedCell).join('');
    }

    // "Saqlangan" yorlig'ida serverdagi saqlangan reelslarni ham ko'rsatamiz
    // (Instagram "Saqlanganlar" bo'limiga o'xshab).
    if (tab === 'saved') {
        els.empty.hidden = true;
        fetchSavedReels().then(paint).catch(() => paint([]));
        return;
    }
    paint([]);
}

function switchTabLocal(tab) {
    els.tabs.querySelectorAll('.pf-tab').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    renderLocalTab(tab);
}

function renderLocal() {
    renderLocalHeader();
    // localStorage'da Telegram akkaunt YO'Q bo'lsa yoki profil rasmi hali
    // yuklanmagan bo'lsa — jim tekshiramiz (verify rasmni ham olib keladi).
    const u = localTgUser();
    if ((!u.id || !localPhoto()) && window.TgStream && typeof window.TgStream.verify === 'function') {
        window.TgStream.verify().then(() => { renderLocalHeader(); }).catch(() => {});
    }
}

// Telegram profil rasmi keyinroq yuklansa (TgStream verify), sarlavhani
// yangilaymiz — avatar o'sha zahoti rasmga almashadi.
window.addEventListener('wc:tgPhoto', () => {
    if (LOCAL) renderLocalHeader();
});

// =======================================================================
// Yuklash
// =======================================================================
async function loadProfile() {
    if (LOCAL) { renderLocal(); return; }
    const qp = new URLSearchParams();
    if (PROFILE_VIEW_ID) qp.set('user_id', PROFILE_VIEW_ID);
    const meRaw = localMeRaw();
    if (meRaw) qp.set('tg_me', meRaw);
    const d = await apiGet(API_BASE + (qp.toString() ? '?' + qp.toString() : ''));

    if (!d || !d.user) {
        showToast('Profil yuklanmadi', false);
        return;
    }
    state.data = d;

    renderHeader();
    renderActions();
    // Boshlang'ich yorliqni (query orqali tanlangan bo'lishi mumkin)
    // belgilaymiz — aks holda "Reels" tugmasi faol ko'rinib qolardi.
    document.querySelectorAll('.pf-tab').forEach((b) => {
        b.classList.toggle('active', b.dataset.tab === state.tab);
    });
    loadTab(state.tab, true);
}

// Modal'ni bosib yopish (o'rtadagi bo'sh joy)
els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeModal();
});
$('#pfModalCancel').addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

loadProfile();