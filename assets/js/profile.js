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
    avatarOnly: false, // modal faqat rasmni tahrirlayapti (MTProto rejimi)
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
    blockedBadge: $('#pfBlockedBadge'),
    locked:    $('#pfLocked'),
    stats:     $('#pfStats'),
    analytics: $('#pfAnalytics'),
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
    modalTitle:$('#pfModalTitle'),
    avPreview: $('#pfAvPreview'),
    avFile:    $('#pfInAvatarFile'),
    avRemove:  $('#pfAvRemove'),
    tabs:      $('#pfTabs'),
    listModal: $('#pfListModal'),
    listTitle: $('#pfListTitle'),
    listBody:  $('#pfListBody'),
    listMore:  $('#pfListMore'),
    listX:     $('#pfListX'),
    moreBtn:   $('#pfProfileMoreBtn'),
    moreMenu:  $('#pfProfileMoreMenu'),
    moreBlock: $('#pfMenuBlockBtn'),
    shareModal: $('#pfShareModal'),
    shareUrl:  $('#pfShareUrl'),
    shareQr:   $('#pfShareQr'),
    shareCopy: $('#pfShareCopy'),
    shareX:    $('#pfShareX'),
};

// Mahalliy rejim: PHP hisobi yo'q, faqat Telegram (MTProto) hisobi bilan
// kirilgan. Ma'lumot localStorage'dan (wc_tg_me_v1 + WCLib) olinadi.
const LOCAL = !PROFILE_ME_ID && !PROFILE_VIEW_ID;
if (LOCAL && (state.tab === 'reels' || state.tab === '' || state.tab === 'posts' || state.tab === 'videos')) state.tab = 'saved';

// Saytga yuklangan profil rasmi kaliti. U `wc_tg_photo_v1` (Telegram rasmi)
// dan ustun turadi va navigatsiya/izohlar/chatda ham ishlatiladi.
const AVATAR_KEY = 'wc_avatar_url_v1';

// Modal ichidagi vaqtinchalik avatar holati.
let avatarFile   = null;   // tanlangan File (hali yuklanmagan)
let avatarRemove = false;  // "o'chirish" bosilgan

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

// Yorliq ikonkalari (mahalliy rejimda PHP ig_svg() mavjud bo'lmaydi).
const TAB_ICONS = {
    reels:   '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M15.03 9.44a.65.65 0 0 1 0 1.12l-4.06 2.35a.65.65 0 0 1-.97-.56V7.65c0-.52.56-.84.97-.56z"/><path d="M12 17v4"/><path d="M8 21h8"/>',
    posts:   '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="m21 15-4.5-4.5L7 20"/>',
    videos:  '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16"/><path d="M17 4v16"/><path d="M2 9h5"/><path d="M17 9h5"/><path d="M2 15h5"/><path d="M17 15h5"/>',
    liked:   '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>',
    saved:   '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
};

function tabIconHTML(key) {
    return `<svg class="pf-tab-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${TAB_ICONS[key] || ''}</svg>`;
}

const SHARE_SVG = '<svg class="pf-btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>'
    + '<path d="m8.6 10.5 6.8-4"/><path d="m8.6 13.5 6.8 4"/></svg>';

// Maxfiy profil uchun "So'rov yuborildi" holati faqat brauzerda saqlanadi:
// backendda follow_request jadvali yo'q, shuning uchun serverga yozmaymiz.
const REQ_KEY = 'wc_profile_follow_requests_v1';
function requestedIds() {
    try {
        const arr = JSON.parse(localStorage.getItem(REQ_KEY) || '[]');
        return Array.isArray(arr) ? arr.map(Number) : [];
    } catch (e) { return []; }
}
function isRequested(uid) {
    return requestedIds().indexOf(Number(uid)) !== -1;
}
function setRequested(uid, on) {
    const id = Number(uid);
    const ids = requestedIds().filter((x) => x !== id);
    if (on) ids.push(id);
    try { localStorage.setItem(REQ_KEY, JSON.stringify(ids)); } catch (e) {}
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

    // Asosiy qator: faqat 3 ko'rsatkich.
    const reEl = els.stats.querySelector('[data-k="reels"]');
    if (reEl) reEl.textContent = fmt(st.approved ?? st.reels ?? 0);

    // Analitika alohida kichik blokda (asosiy qatordan chiqarildi).
    if (els.analytics) {
        els.analytics.hidden = false;
        const vEl = els.analytics.querySelector('[data-k="views"]');
        const lEl = els.analytics.querySelector('[data-k="likes"]');
        if (vEl) vEl.textContent = fmt(st.views);
        if (lEl) lEl.textContent = fmt(st.likes);
    }

    // Kuzatuvchilar / kuzatilayotganlar (Instagram uslubi)
    const fc = state.data.follow_counts || {};
    const fEl = els.stats.querySelector('[data-k="followers"]');
    const gEl = els.stats.querySelector('[data-k="following"]');
    if (fEl) fEl.textContent = fmt(fc.followers ?? 0);
    if (gEl) gEl.textContent = fmt(fc.following ?? 0);

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
    const u = state.data.user || {};
    const uid = u.id || 0;

    els.uploadBtn.hidden = !isMe;
    els.logoutBtn.hidden = !isMe;
    if (els.setBtn) els.setBtn.hidden = !isMe;

    // ⋯ faqat BOSHQA profilda; u orqali blok/shikoyat/havola ishlaydi.
    if (els.moreBtn) els.moreBtn.hidden = isMe || LOCAL || !uid;
    closeProfileMoreMenu();
    if (els.blockedBadge) els.blockedBadge.hidden = !state.data.blocked;
    if (els.moreBlock) {
        els.moreBlock.textContent = state.data.blocked ? 'Blokdan chiqarish' : 'Bloklash';
    }

    if (!uid) return;

    if (isMe) {
        els.actions.innerHTML = `
            <button class="pf-btn prim" id="pfEditBtn">&#9998; Tahrirlash</button>
            <a class="pf-btn" href="reels-upload.php">&#10133; Joylash</a>
            <button class="pf-btn ghost" id="pfShareBtn">${SHARE_SVG} Profilni ulashish</button>
            <a class="pf-btn ghost" href="settings.php">&#9881; Sozlamalar</a>
            ${isAdmin ? `
            <a class="pf-btn ghost" href="admin-content.php">&#128736; Admin</a>` : ''}`;
        const eb = $('#pfEditBtn');
        if (eb) eb.onclick = () => openEditModal(false);
    } else {
        const following = !!state.data.following;
        const isPrivate = !!u.is_private;
        const requested = !following && isPrivate && isRequested(uid);
        const followLabel = following ? 'Kuzatilmoqda'
            : (requested ? 'So\u2018rov yuborildi' : 'Kuzatish');
        const followCls = (following || requested) ? 'ghost' : 'prim';

        // Asosiy qator: FAQAT Kuzatish + Xabar + Ulashish.
        els.actions.innerHTML = `
            <button class="pf-btn ${followCls}" id="pfFollowBtn"
                    ${requested ? 'data-requested="1"' : ''}>${followLabel}</button>
            <a class="pf-btn soft" href="chat.php?u=${encodeURIComponent(uid)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21.3 4.3 3.2 11.4a.55.55 0 0 0 .06 1.04l4.6 1.45 1.45 4.6a.55.55 0 0 0 1.04.06L21.3 4.3z"/><path d="M7.86 13.89 21.3 4.3"/></svg>
                Xabar
            </a>
            <button class="pf-btn ghost" id="pfShareBtn">${SHARE_SVG} Ulashish</button>`;
        const fb = $('#pfFollowBtn');
        if (fb) fb.onclick = () => toggleFollowProfile(fb);
    }

    const sb = $('#pfShareBtn');
    if (sb) sb.onclick = () => openShareModal();

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
            // Sahifani qayta yuklamaymiz: api/profile.php bloklangan profil
            // uchun 404 qaytaradi. Holat shu sahifada qoladi.
            renderActions();
            showToast(state.data.blocked ? 'Foydalanuvchi bloklandi' : 'Blokdan chiqarildi');
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
// Maxfiy profilda backendda follow_request yozuvi yo'qligi uchun "So'rov"
// holati faqat localStorage'da saqlanadi va APIga yozilmaydi.
async function toggleFollowProfile(btn) {
    const u = (state.data && state.data.user) || {};
    const uid = u.id;
    if (!uid) return;

    const following = !!state.data.following;
    if (!!u.is_private && !following) {
        const requested = !isRequested(uid);
        setRequested(uid, requested);
        btn.textContent = requested ? 'So\u2018rov yuborildi' : 'Kuzatish';
        btn.classList.toggle('ghost', requested);
        btn.classList.toggle('prim', !requested);
        if (requested) btn.setAttribute('data-requested', '1');
        else btn.removeAttribute('data-requested');
        showToast(requested ? 'So\u2018rov yuborildi' : 'So\u2018rov bekor qilindi');
        return;
    }

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
            state.data.following = true;
            setRequested(uid, false);
            btn.textContent = 'Kuzatilmoqda';
            btn.classList.remove('prim'); btn.classList.add('ghost');
            btn.removeAttribute('data-requested');
            const cb = new URLSearchParams({ action: 'add_contact', peer_id: String(uid) });
            if (raw) cb.set('tg_me', raw);
            fetch('api/chat.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: cb.toString(),
            }).catch(() => {});
        } else if (d && d.following === false) {
            state.data.following = false;
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
// ULASHISH + ⋯ MENYU
// =======================================================================
function closeProfileMoreMenu() {
    if (!els.moreMenu) return;
    els.moreMenu.hidden = true;
    if (els.moreBtn) els.moreBtn.setAttribute('aria-expanded', 'false');
}

function openProfileMoreMenu() {
    if (!els.moreMenu || !els.moreBtn || els.moreBtn.hidden) return;
    els.moreMenu.hidden = false;
    els.moreBtn.setAttribute('aria-expanded', 'true');
}

function profileShareURL() {
    const u = (state.data && state.data.user) || {};
    const tail = u.id ? '?user_id=' + encodeURIComponent(u.id) : '';
    try { return new URL('profile.php' + tail, location.href).href; }
    catch (e) { return profileUrl(u.id); }
}

// Tashqi kutubxonasiz, URL matnidan deterministik SVG "QR" naqsh.
// Bu haqiqiy QR skanerlash kafolatlamaydi, lekin havola bilan birga
// ko'rinadigan mahalliy kod beradi (CDN/orqali kutubxona yo'q).
function buildQrSVG(text) {
    const n = 21;
    const grid = Array.from({ length: n }, () => Array(n).fill(false));
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    function finder(ox, oy) {
        for (let y = 0; y < 7; y++) {
            for (let x = 0; x < 7; x++) {
                const edge = x === 0 || y === 0 || x === 6 || y === 6;
                const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
                grid[oy + y][ox + x] = edge || core;
            }
        }
    }
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const reserved = (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
            if (reserved) continue;
            h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
            grid[y][x] = ((h >>> 0) % 3) === 0;
        }
    }
    let rects = '';
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid[y][x]) rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
        }
    }
    return `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" role="img" aria-label="QR">`
        + `<rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/>`
        + `<g fill="#000">${rects}</g></svg>`;
}

function openShareModal() {
    if (!els.shareModal) return;
    const url = profileShareURL();
    if (els.shareUrl) els.shareUrl.textContent = url;
    if (els.shareQr) els.shareQr.innerHTML = buildQrSVG(url);
    els.shareModal.hidden = false;
    requestAnimationFrame(() => els.shareModal.classList.add('open'));
}

function closeShareModal() {
    if (!els.shareModal) return;
    els.shareModal.classList.remove('open');
    setTimeout(() => { els.shareModal.hidden = true; }, 150);
}

async function copyProfileLink() {
    const url = profileShareURL();
    let copied = false;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            copied = true;
        }
    } catch (e) { copied = false; }
    if (!copied) {
        try {
            const ta = document.createElement('textarea');
            ta.value = url;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            copied = document.execCommand('copy');
            document.body.removeChild(ta);
        } catch (e) { copied = false; }
    }
    showToast(copied ? 'Havola nusxalandi' : 'Havolani nusxalab bo\u2018lmadi', copied);
}

function openComplaintDialog() {
    closeProfileMoreMenu();
    const trigger = document.querySelector('[data-feedback-open]');
    if (!trigger) {
        showToast('Shikoyat oynasi topilmadi', false);
        return;
    }
    trigger.click();
    const complaint = document.querySelector('#feedbackForm input[name="feedbackType"][value="complaint"]');
    if (complaint) complaint.checked = true;
}

function initProfileExtras() {
    if (els.moreBtn) {
        els.moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!els.moreMenu) return;
            if (els.moreMenu.hidden) openProfileMoreMenu();
            else closeProfileMoreMenu();
        });
    }
    if (els.moreMenu) {
        els.moreMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            const b = e.target.closest ? e.target.closest('[data-more]') : null;
            if (!b) return;
            const kind = b.getAttribute('data-more');
            if (kind === 'copy') { closeProfileMoreMenu(); copyProfileLink(); }
            else if (kind === 'block') { closeProfileMoreMenu(); toggleBlockProfile(b); }
            else if (kind === 'report') openComplaintDialog();
        });
    }
    document.addEventListener('click', (e) => {
        if (!els.moreMenu || els.moreMenu.hidden) return;
        if (e.target.closest && e.target.closest('#pfProfileMoreMenu, #pfProfileMoreBtn')) return;
        closeProfileMoreMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        closeProfileMoreMenu();
        if (els.shareModal && !els.shareModal.hidden) closeShareModal();
    });

    if (els.shareX) els.shareX.addEventListener('click', closeShareModal);
    if (els.shareCopy) els.shareCopy.addEventListener('click', copyProfileLink);
    if (els.shareModal) {
        els.shareModal.addEventListener('click', (e) => {
            if (e.target === els.shareModal) closeShareModal();
        });
    }
}

// =======================================================================
// Kuzatuvchilar / Kuzatilayotganlar RO'YXATI (Instagram uslubi)
// -----------------------------------------------------------------------
// Profil sarlavhasidagi "Kuzatuvchilar" yoki "Kuzatilayotgan" soni
// bosilganda ochiladi. Sahifalash pastga skroll qilinganda davom etadi.
// =======================================================================
const LIST_LIMIT = 40;
const listState = { which: '', offset: 0, hasMore: true, loading: false, busy: false };

function listAvaHTML(u) {
    const init = esc(((u.full_name || u.username || '?').charAt(0) || '?').toUpperCase());
    if (u.avatar) {
        return `<span class="pf-li-ava"><img src="${esc(u.avatar)}" alt="" loading="lazy"`
             + ` onerror="this.parentNode.textContent='${init}'"></span>`;
    }
    return `<span class="pf-li-ava">${init}</span>`;
}

function renderListItems(items, append) {
    if (!els.listBody) return;
    const html = items.map((u) => {
        const name = u.full_name || u.username || 'Foydalanuvchi';
        const handle = u.username ? '@' + u.username : '';
        const btn = u.is_me ? ''
            : `<button type="button" class="pf-li-btn ${u.following ? 'ghost' : 'prim'}"`
              + ` data-follow="${u.id}" data-following="${u.following ? '1' : '0'}">`
              + `${u.following ? 'Kuzatilmoqda' : 'Kuzatish'}</button>`;
        return `<div class="pf-li" data-uid="${u.id}">`
            + `<a class="pf-li-l" href="profile.php?user_id=${encodeURIComponent(u.id)}">`
            + listAvaHTML(u)
            + `<span class="pf-li-txt">`
            + `<span class="pf-li-name">${esc(name)}</span>`
            + (handle ? `<span class="pf-li-user">${esc(handle)}</span>` : '')
            + `</span></a>${btn}</div>`;
    }).join('');
    if (append) els.listBody.insertAdjacentHTML('beforeend', html);
    else els.listBody.innerHTML = html;
}

async function loadList(reset) {
    if (!els.listModal || listState.loading) return;
    if (reset) {
        listState.offset = 0;
        listState.hasMore = true;
        els.listBody.innerHTML = '<div class="pf-li-empty">Yuklanmoqda&hellip;</div>';
    }
    if (!listState.hasMore) return;

    listState.loading = true;
    if (els.listMore) els.listMore.hidden = false;

    const uid = (state.data && state.data.user && state.data.user.id) || 0;
    const params = new URLSearchParams({
        user_id: String(uid),
        list:    listState.which,
        limit:   String(LIST_LIMIT),
        offset:  String(listState.offset),
    });
    const raw = localMeRaw();
    if (raw) params.set('tg_me', raw);

    try {
        const r = await fetch(API_BASE + '?' + params.toString(), { credentials: 'same-origin' });
        const d = await r.json().catch(() => null);
        const items = (d && d.items) || [];

        if (reset) els.listBody.innerHTML = '';
        if (!items.length && reset) {
            els.listBody.innerHTML = '<div class="pf-li-empty">'
                + (listState.which === 'followers'
                    ? 'Hali kuzatuvchilar yo\u2018q'
                    : 'Hali hech kim kuzatilmayapti')
                + '</div>';
        } else if (items.length) {
            renderListItems(items, !reset);
            listState.offset += items.length;
        }

        // Sanoqlarni serverdagi aniq qiymat bilan yangilaymiz.
        if (d && d.counts) {
            const fEl = els.stats && els.stats.querySelector('[data-k="followers"]');
            const gEl = els.stats && els.stats.querySelector('[data-k="following"]');
            if (fEl) fEl.textContent = fmt(d.counts.followers ?? 0);
            if (gEl) gEl.textContent = fmt(d.counts.following ?? 0);
            if (state.data) state.data.follow_counts = d.counts;
        }
        listState.hasMore = items.length >= LIST_LIMIT;
    } catch (e) {
        if (reset) els.listBody.innerHTML = '<div class="pf-li-empty">Tarmoq xatosi</div>';
    } finally {
        listState.loading = false;
        if (els.listMore) els.listMore.hidden = true;
    }
}

function openList(which) {
    if (!els.listModal) return;
    if (which !== 'followers' && which !== 'following') return;
    if (state.locked) return;                       // maxfiy profil — ro'yxat yopiq
    listState.which   = which;
    listState.offset  = 0;
    listState.hasMore = true;
    if (els.listTitle) {
        els.listTitle.textContent = which === 'followers' ? 'Kuzatuvchilar' : 'Kuzatilayotgan';
    }
    // Ko'rinish `.open` klassi orqali boshqariladi (`.pf-modal` bilan bir xil):
    // `hidden` yolg'iz o'zi ishlamaydi, chunki klassda `display: flex` bor.
    els.listModal.hidden = false;
    requestAnimationFrame(() => els.listModal.classList.add('open'));
    document.body.classList.add('pf-list-open');
    loadList(true);
}

function closeList() {
    if (!els.listModal) return;
    els.listModal.classList.remove('open');
    document.body.classList.remove('pf-list-open');
    setTimeout(() => { els.listModal.hidden = true; }, 150);
}

// Ro'yxatdagi "Kuzatish / Kuzatilmoqda" tugmasi.
async function toggleListFollow(btn) {
    const id = Number(btn.getAttribute('data-follow')) || 0;
    if (!id || listState.busy) return;
    listState.busy = true;
    btn.disabled = true;
    try {
        const raw = localMeRaw();
        const body = new URLSearchParams({ action: 'follow', id: String(id) });
        if (raw) body.set('tg_me', raw);
        const r = await fetch('api/reels.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const d = await r.json().catch(() => null);
        if (d && typeof d.following === 'boolean') {
            btn.setAttribute('data-following', d.following ? '1' : '0');
            btn.textContent = d.following ? 'Kuzatilmoqda' : 'Kuzatish';
            btn.classList.toggle('ghost', d.following);
            btn.classList.toggle('prim', !d.following);
        } else {
            showToast((d && d.message) || 'Xatolik yuz berdi');
        }
    } catch (e) {
        showToast('Tarmoq xatosi');
    } finally {
        btn.disabled = false;
        listState.busy = false;
    }
}

function initFollowList() {
    // Mahalliy (localStorage) rejimda kuzatish serverda saqlanmaydi,
    // shuning uchun ro'yxat tugmalarini ko'rsatmaymiz.
    if (LOCAL) {
        document.querySelectorAll('.pf-stat-link').forEach((b) => { b.hidden = true; });
        return;
    }
    if (els.stats) {
        els.stats.addEventListener('click', (e) => {
            const b = e.target.closest ? e.target.closest('[data-list]') : null;
            if (b) openList(b.getAttribute('data-list'));
        });
    }
    if (els.listX) els.listX.onclick = closeList;
    if (els.listModal) {
        els.listModal.addEventListener('click', (e) => {
            if (e.target === els.listModal) closeList();          // fon bosildi
            const fb = e.target.closest ? e.target.closest('[data-follow]') : null;
            if (fb) { e.preventDefault(); toggleListFollow(fb); }
        });
    }
    if (els.listBody) {
        els.listBody.addEventListener('scroll', () => {
            const el = els.listBody;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) loadList(false);
        }, { passive: true });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && els.listModal && !els.listModal.hidden) closeList();
    });
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
// Modalni ochadi. `avatarOnly = true` bo'lsa (MTProto/Telegram rejimi)
// faqat profil rasmi ko'rinadi va tahrirlanadi.
function openEditModal(avatarOnly) {
    state.avatarOnly = !!avatarOnly;
    els.editErr.textContent = '';
    if (els.avFile) els.avFile.value = '';
    avatarFile = null;
    avatarRemove = false;

    if (avatarOnly) {
        els.modal.classList.add('avatar-only');
        if (els.modalTitle) els.modalTitle.textContent = '\uD83D\uDCF7 Profil rasmi';
        // Ism maydoni yashirin; `required` validatsiyasi formani to'smasin.
        els.editForm.first_name.required = false;
        els.editForm.first_name.disabled = true;
        const u = localTgUser();
        els.editForm.first_name.value = u.firstName || '';
        els.editForm.last_name.value  = u.lastName  || '';
        els.editForm.username.value   = u.username  || '';
        els.editForm.bio.value        = '';
        renderModalAvatar(localPhoto());
    } else {
        els.modal.classList.remove('avatar-only');
        if (els.modalTitle) els.modalTitle.textContent = '\u270E Profilni tahrirlash';
        els.editForm.first_name.required = true;
        els.editForm.first_name.disabled = false;
        const u = (state.data && state.data.user) ? state.data.user : {};
        els.editForm.first_name.value = u.first_name || '';
        els.editForm.last_name.value  = u.last_name  || '';
        els.editForm.username.value   = u.username   || '';
        els.editForm.bio.value        = u.bio        || '';
        renderModalAvatar(u.avatar || '');
    }
    els.modal.hidden = false;
    els.modal.classList.add('open');
}

// --- Profil rasmi (avatar) yordamchilari -------------------------------

// Brauzerdagi MTProto identifikatori (JSON). PHP sessiyasi bo'lmasa
// `api/avatar.php` foydalanuvchini shu orqali topadi.
function tgMeRawFull() {
    const raw = localMeRaw();
    if (raw) return raw;
    if (window.TgStream && typeof window.TgStream.me === 'function') {
        try {
            const m = window.TgStream.me();
            if (m && m.id) return JSON.stringify(m);
        } catch (e) {}
    }
    return '';
}

// Rasmni hamma joyga (navigatsiya, izohlar, chat) tarqatamiz.
function mirrorAvatar(url) {
    try {
        if (url) localStorage.setItem(AVATAR_KEY, url);
        else localStorage.removeItem(AVATAR_KEY);
    } catch (e) {}
    try { window.dispatchEvent(new Event('wc:tgPhoto')); } catch (e) {}
}

function renderModalAvatar(url) {
    if (!els.avPreview) return;
    if (!url) {
        const ch = ((els.name.textContent || '?').charAt(0) || '?').toUpperCase();
        els.avPreview.innerHTML = '<span class="pf-av-init">' + esc(ch) + '</span>';
        return;
    }
    els.avPreview.innerHTML = '<img src="' + esc(url) + '" alt="">';
}

async function uploadAvatarFile(file) {
    const fd = new FormData();
    fd.append('avatar', file);
    const raw = tgMeRawFull();
    if (raw) fd.append('tg_me', raw);
    const r = await fetch('api/avatar.php', { method: 'POST', body: fd, credentials: 'same-origin' });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || !d.success) throw new Error((d && d.message) || 'Rasm yuklanmadi');
    return d.avatar || '';
}

async function removeAvatarRemote() {
    const body = new URLSearchParams({ remove: '1' });
    const raw = tgMeRawFull();
    if (raw) body.set('tg_me', raw);
    const r = await fetch('api/avatar.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || !d.success) throw new Error((d && d.message) || 'Rasm o\u2019chirilmadi');
    return '';
}

function closeModal() {
    els.modal.classList.remove('open');
    setTimeout(() => { els.modal.hidden = true; }, 150);
}

els.editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.editErr.textContent = '';

    const saveBtn = $('#pfModalSave');
    const oldTxt = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saqlanmoqda…';

    try {
        // 1) Profil rasmi — tanlangan yoki o'chirilgan bo'lsa.
        if (avatarFile || avatarRemove) {
            const url = avatarFile ? await uploadAvatarFile(avatarFile) : await removeAvatarRemote();
            mirrorAvatar(url || '');
        }

        // 2) Qolgan maydonlar — faqat PHP hisobi uchun (MTProto rejimida
        //    ism/username Telegram'dan keladi, serverda tahrirlanmaydi).
        if (!state.avatarOnly) {
            const body = new URLSearchParams();
            body.set('first_name', els.editForm.first_name.value.trim());
            body.set('last_name',  els.editForm.last_name.value.trim());
            body.set('username',   els.editForm.username.value.trim());
            body.set('bio',        els.editForm.bio.value.trim());

            const r = await fetch('api/profile-update.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
            });
            const d = await r.json().catch(() => null);
            if (!r.ok || !d || !d.updated) {
                els.editErr.textContent = (d && d.message) || 'Xatolik yuz berdi';
                return;
            }
        }

        closeModal();
        showToast('✅ Saqlandi');
        if (LOCAL) renderLocalHeader();
        else await loadProfile();
    } catch (err) {
        els.editErr.textContent = (err && err.message) ? err.message : 'Tarmoq xatosi';
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = oldTxt;
    }
});

// Avatar fayli tanlanganda — darhol ko'rinish (preview).
if (els.avFile) {
    els.avFile.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        avatarRemove = false;
        avatarFile = f || null;
        if (f) {
            let url = '';
            try { url = URL.createObjectURL(f); } catch (err) {}
            renderModalAvatar(url);
        } else {
            renderModalAvatar('');
        }
    });
}

// "O'chirish" — keyingi saqlashda rasm olib tashlanadi.
if (els.avRemove) {
    els.avRemove.addEventListener('click', () => {
        avatarFile = null;
        avatarRemove = true;
        if (els.avFile) els.avFile.value = '';
        renderModalAvatar('');
    });
}

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
    try {
        // Avval saytga yuklangan rasm, u bo'lmasa Telegram rasmi.
        return localStorage.getItem(AVATAR_KEY)
            || localStorage.getItem('wc_tg_photo_v1') || '';
    } catch (e) { return ''; }
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

    // Asosiy qator ham 3 ko'rsatkich; analitika mahalliy rejimda yashirin.
    const c = (window.WCLib ? window.WCLib.counts() : { saved: 0, liked: 0, history: 0 });
    els.stats.innerHTML =
        `<div class="pf-stat"><b>${fmt(c.saved)}</b><span>Saqlangan</span></div>` +
        `<div class="pf-stat"><b>${fmt(c.liked)}</b><span>Yoqqan</span></div>` +
        `<div class="pf-stat"><b>${fmt(c.history)}</b><span>Tarix</span></div>`;
    if (els.analytics) els.analytics.hidden = true;
    if (els.moreBtn) els.moreBtn.hidden = true;
    if (els.blockedBadge) els.blockedBadge.hidden = true;

    els.hlWrap.hidden = true;
    els.uploadBtn.hidden = true;
    els.logoutBtn.hidden = true;

    // Amallar: Tahrirlash (rasm) + Sozlamalar + Telegram bot
    els.actions.innerHTML = `
        <button class="pf-btn prim" id="pfEditAvatarBtn">&#9998; Tahrirlash</button>
        <button class="pf-btn" id="pfSetBtn">&#9881;&#65039; Sozlamalar</button>
        <a class="pf-btn ghost" href="https://t.me/${esc(APP_BOT || 'w_cinema_uz_bot')}" target="_blank" rel="noopener">&#9992;&#65039; Bot</a>`;
    const ab = $('#pfEditAvatarBtn');
    if (ab) ab.addEventListener('click', () => openEditModal(true));
    const sb = $('#pfSetBtn');
    if (sb) sb.addEventListener('click', () => {
        const more = document.getElementById('igMoreBtn') || document.getElementById('igMoreBtnM');
        if (more) more.click();
    });

    // Yorliqlar (mahalliy) — ikonkalar PHP ig_svg() bo'lmagani uchun JS'dan.
    els.tabs.innerHTML = LOCAL_TABS.map((t) =>
        `<button class="pf-tab${t.k === state.tab ? ' active' : ''}" data-tab="${t.k}">`
        + tabIconHTML(t.k) + `<span>${t.label}</span></button>`
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

// Kutubxona server bilan sinxronlashganda mahalliy profil ham darhol
// yangilanadi (boshqa qurilmadan qo'shilgan Saqlanganlar/Yoqqanlar ko'rinadi).
window.addEventListener('wc:library', () => {
    if (LOCAL) renderLocal();
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

initFollowList();
initProfileExtras();
loadProfile();