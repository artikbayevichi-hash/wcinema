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
};

const els = {
    title:     $('#pfTitle'),
    avatar:    $('#pfAvatar'),
    name:      $('#pfName'),
    username:  $('#pfUsername'),
    bio:       $('#pfBio'),
    stats:     $('#pfStats'),
    actions:   $('#pfActions'),
    hlWrap:    $('#pfHighlightsWrap'),
    highlights: $('#pfHighlights'),
    uploadBtn: $('#pfUploadBtn'),
    logoutBtn: $('#pfLogoutBtn'),
    grid:      $('#pfGrid'),
    empty:     $('#pfEmpty'),
    more:      $('#pfMore'),
    toast:     $('#pfToast'),
    modal:     $('#pfModal'),
    editForm:  $('#pfEditForm'),
    editErr:   $('#pfEditErr'),
};

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

    els.title.textContent = u.username ? '@' + u.username : (u.first_name || 'Profil');
    document.title = (u.username ? '@' + u.username : (u.first_name || 'Profil')) + ' — ' + SITE_NAME;

    els.avatar.innerHTML = avatarHTML(u);
    els.name.textContent = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
    els.username.textContent = u.username ? '@' + u.username : '';
    els.bio.textContent = u.bio || '';

    // statistika
    els.stats.querySelector('[data-k="reels"]').textContent = fmt(state.data.stats.reels);
    els.stats.querySelector('[data-k="views"]').textContent = fmt(state.data.stats.views);
    els.stats.querySelector('[data-k="likes"]').textContent = fmt(state.data.stats.likes);

    // highlightlar
    if (state.data.highlights && state.data.highlights.length) {
        els.highlights.innerHTML = state.data.highlights.map((h) => `
            <a class="pf-hl" href="reels.php?reel=${h.id}" title="${esc(h.title)}">
                <span class="pf-hl-ring">
                    ${h.poster
                        ? `<img loading="lazy" src="${esc(h.poster)}" alt="">`
                        : `<span class="pf-hl-play">🎬</span>`}
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

    if (!state.data.user.id) return;

    if (isMe) {
        els.actions.innerHTML = `
            <button class="pf-btn prim" id="pfEditBtn">✏️ Tahrirlash</button>
            <a class="pf-btn" href="reels-upload.php">＋ Reels yuklash</a>
            ${isAdmin ? `
            <a class="pf-btn ghost" href="admin-reels.php">🛠 Admin</a>` : ''}
            <a class="pf-btn ghost" href="logout.php">⏻</a>`;
        $('#pfEditBtn').onclick = openModal;
    } else {
        els.actions.innerHTML = '';
    }

    // Yorliqlar: faqat o'z profilida "Yoqqanlar" va "Saqlangan"
    document.querySelectorAll('.pf-tab[data-self]').forEach((b) => {
        b.hidden = !isMe;
    });
    // O'ziniki bo'lmasa, "reels" yorlig'idan boshqasiga o'tib bo'lmaydi
    if (!isMe && state.tab !== 'reels') {
        switchTab('reels');
    }
}

// =======================================================================
// Grid
// =======================================================================
function reelCell(r) {
    const poster = r.poster
        ? `<img loading="lazy" src="${esc(r.poster)}" alt="">`
        : `<div class="pf-cell-ph">🎬</div>`;
    const badge = r.status !== 1
        ? (r.status === 0
            ? '<span class="pf-badge">⏳</span>'
            : '<span class="pf-badge bad">✕</span>')
        : '';
    return `
        <a class="pf-cell" href="reels.php?reel=${r.id}">
            <div class="pf-cell-media">
                ${poster}
                ${badge}
                <div class="pf-cell-meta">👁 ${fmt(r.views)} <i>·</i> ❤️ ${fmt(r.likes)}</div>
            </div>
        </a>`;
}

function savedCell(c) {
    const poster = c.poster
        ? `<img loading="lazy" src="${esc(c.poster)}" alt="">`
        : `<div class="pf-cell-ph">🎬</div>`;
    return `
        <a class="pf-cell" href="index.php?c=${c.id}">
            <div class="pf-cell-media">
                ${poster}
                <div class="pf-cell-meta">${esc((c.category || '').slice(0, 14))}</div>
            </div>
        </a>`;
}

async function loadTab(tab, reset) {
    if (!state.data) {
        // Profil hali yuklanmagan - avval sarlavhani kuting
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
        tab === 'saved' ? savedCell(it) : reelCell(it)).join(''));

    state.offset += d.items.length;
    state.hasMore = !!d.has_more;
    if (state.hasMore) els.more.hidden = false;
}

function renderEmpty() {
    const tab = state.tab;
    const msg = (state.data && state.data.is_me)
        ? (tab === 'reels' ? 'Hali reels yo\'q — birinchi reelsingizni yuklang! 🎬'
            : tab === 'liked' ? 'Hali hech narsani yoqtirmagansiz 🤍'
            : 'Saqlanganlar bo\'sh — film qo\'shing 🔖')
        : 'Hali reels yo\'q';
    els.empty.textContent = msg;
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
// Yuklash
// =======================================================================
async function loadProfile() {
    const qs = PROFILE_VIEW_ID ? 'user_id=' + PROFILE_VIEW_ID : '';
    const d = await apiGet(API_BASE + (qs ? '?' + qs : ''));

    if (!d || !d.user) {
        showToast('Profil yuklanmadi', false);
        return;
    }
    state.data = d;

    renderHeader();
    renderActions();
    loadTab(state.tab, true);
}

// Modal'ni bosib yopish (o'rtadagi bo'sh joy)
els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeModal();
});
$('#pfModalCancel').addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

loadProfile();