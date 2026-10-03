<?php
// ============================================================================
// admin-content.php - Kontent va qismlar boshqaruvi (faqat ADMIN)
// ============================================================================
// Soddalashtirilgan panel:
//   1) Ro'yxat + tepada qidiruv (nomi, kategoriya yoki avtomatik ID bo'yicha).
//   2) "＋ Yangi qo'shish": avval katalog (Kino / Multfilm / Anime / Serial).
//      - Kino va Multfilm: nom + video URL shu yerda (1-qism bo'lib saqlanadi).
//      - Anime va Serial: nom + nechta qism; video qismlar bo'limida qo'shiladi.
//   3) Qismlar: qism raqami + URL + daqiqa. Har qator chekkasida Saqlash/O'chirish.
//
// Video manbasi FAQAT Telegram/URL orqali. "Media is too big" endi to'sqinlik
// qilmaydi — har qanday havola saqlanadi (sayt uni Telegram'dan oqizadi).
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

if (!$auth->isAdmin()) {
    // Admin kaliti bilan kirilmagan — kalit formasiga yo'naltiramiz.
    $here = (string) ($_SERVER['SCRIPT_NAME'] ?? '/admin-content.php');
    header('Location: admin-login.php?next=' . rawurlencode($here));
    exit;
}
?>
<!DOCTYPE html>
<html lang="uz">
<head>
    <link rel="icon" type="image/png" href="assets/img/favicon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/favicon.png') ?: 1; ?>">
    <link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?php echo @filemtime(__DIR__ . '/assets/img/apple-touch-icon.png') ?: 1; ?>">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Kontent boshqaruvi — <?php echo htmlspecialchars(SITE_NAME); ?></title>
    <link rel="stylesheet" href="assets/css/style.css">
    <link rel="stylesheet" href="assets/css/reels.css">
    <link rel="stylesheet" href="assets/css/instagram.css">
    <style>
        .adm-form { display:grid; gap:10px; }
        .adm-form .row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        .adm-form .row3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }
        .adm-form label { font-size:12px; color:var(--muted); display:block; margin-bottom:3px; }
        .adm-form input, .adm-form select, .adm-form textarea {
            width:100%; box-sizing:border-box; padding:9px 10px; font-size:14px;
            border:1px solid var(--border,#3a3644); border-radius:10px;
            background:var(--surface,#1e1b26); color:var(--text,#eae6f2);
        }
        .adm-form textarea { resize:vertical; min-height:64px; }
        .adm-hint { font-size:11.5px; color:var(--muted); margin-top:4px; line-height:1.4;
                    white-space:pre-line; word-break:break-word; }
        .adm-hint.ok   { color:#7fe0ae; }
        .adm-hint.warn { color:#ffc48a; }
        .adm-hint.err  { color:#ff9e9e; }

        /* ---- qidiruv (eng tepada) ---- */
        .adm-search {
            width:100%; box-sizing:border-box;
            padding:12px 14px; border-radius:12px;
            border:1px solid rgba(255,255,255,.12);
            background:rgba(255,255,255,.05);
            color:inherit; font-size:14.5px; outline:none;
        }
        .adm-search:focus { border-color:#8fc1ff; background:rgba(255,255,255,.08); }

        /* ---- katalog tanlash ---- */
        .cat-pick { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; }
        .cat-btn {
            display:flex; flex-direction:column; align-items:center; gap:8px;
            padding:18px 10px; cursor:pointer; text-align:center;
            background:linear-gradient(150deg,var(--card),rgba(255,255,255,.03));
            border:1px solid rgba(255,255,255,.1); border-radius:16px;
            color:inherit; font-size:14px; font-weight:600;
        }
        .cat-btn:hover { border-color:#8fc1ff; transform:translateY(-1px); }
        .cat-btn i { font-size:30px; font-style:normal; }

        /* ---- kontent ro'yxati ---- */
        .c-list { display:grid; gap:8px; }
        .c-row { display:flex; align-items:center; gap:12px; padding:10px 12px;
                 background:var(--surface,#1e1b26); border:1px solid var(--border,#3a3644);
                 border-radius:12px; cursor:pointer; }
        .c-row:hover { border-color:#6a5cff; }
        .c-thumb {
            width:52px; height:74px; flex-shrink:0; border-radius:9px; overflow:hidden;
            background:linear-gradient(140deg,#2a2740,#1a1830);
            display:flex; align-items:center; justify-content:center; font-size:22px;
            box-shadow:0 2px 8px rgba(0,0,0,.35);
        }
        .c-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
        .c-thumb.none { color:var(--muted); }
        .c-id { font-size:11px; color:#8fc1ff; background:rgba(143,193,255,.12);
                border-radius:99px; padding:1px 7px; margin-left:6px; }
        .c-badge { font-size:11px; padding:3px 8px; border-radius:99px; background:#2a2740; color:#b7aef0; }
        .c-badge.st-published { background:#143a2c; color:#7fe0ae; }
        .c-badge.st-draft     { background:#3a2430; color:#ff9e9e; }

        /* ---- qismlar (inline) ---- */
        .ep-row { display:flex; align-items:center; gap:8px; padding:8px 10px; flex-wrap:wrap;
                  background:var(--surface,#1e1b26); border:1px solid var(--border,#3a3644);
                  border-radius:12px; margin-bottom:8px; }
        .ep-row.ep-add { border-style:dashed; background:rgba(255,255,255,.02); margin-top:6px; }
        .ep-row input { box-sizing:border-box; padding:8px 9px; font-size:13.5px;
                        border:1px solid var(--border,#3a3644); border-radius:9px;
                        background:var(--bg,#141119); color:var(--text,#eae6f2); }
        .ep-num { width:74px; }
        .ep-url { flex:1; min-width:170px; }
        .ep-min { width:92px; }
        .ep-actions { margin-left:auto; display:flex; gap:6px; align-items:center; }
        .adm-btn.mini { padding:6px 11px; font-size:12px; }
        .ml-a { margin-left:auto; display:flex; gap:6px; align-items:center; }
        #uploadBar { display:none; height:5px; background:#2a2740; border-radius:99px; overflow:hidden; margin-top:8px; }
        #uploadBar i { display:block; height:100%; width:0; background:#6a5cff; transition:width .15s; }
    </style>
</head>
<body class="adm-body ig-shell">

<!-- Instagram uslubidagi navigatsiya -->
<?php $NAV_ACTIVE = ''; require __DIR__ . '/includes/nav.php'; ?>

<header class="up-top">
    <a class="reels-back" href="index.php" aria-label="Orqaga">←</a>
    <div class="up-title">Kontent boshqaruvi</div>
    <span style="width:34px"></span>
</header>

<div class="adm-msg" id="admMsg" hidden></div>

<!-- ============================== RO'YXAT ============================== -->
<div id="view-list">
    <input id="listSearch" class="adm-search" type="search"
           placeholder="🔍 Qidirish — nomi, katalog yoki ID (#12)…" autocomplete="off"
           style="margin-bottom:10px">
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
        <button class="up-btn" onclick="openCreate()">＋ Yangi qo'shish</button>
        <span style="font-size:12.5px;color:var(--muted);margin-left:auto" id="listCount"></span>
    </div>
    <div class="c-list" id="listBox"></div>
</div>

<!-- ============================== TAHRIR / YANGI ============================== -->
<div id="view-edit" hidden>
    <button class="adm-btn ok mini" onclick="showList()" style="margin-bottom:10px">← Ro'yxatga</button>

    <!-- Katalog tanlash (faqat yangi qo'shganda) -->
    <div class="adm-card" style="padding:14px" id="catPick" hidden>
        <h2 style="font-size:15px;margin:0 0 12px">Katalogni tanlang</h2>
        <div class="cat-pick" id="catPickBox"></div>
    </div>

    <div class="adm-card" style="padding:14px" id="contentForm" hidden>
        <h2 style="font-size:15px;margin:0 0 12px" id="editTitle">Yangi</h2>
        <div class="adm-form">
            <input type="hidden" id="f_id">
            <div class="row">
                <div><label>Sarlavha *</label><input id="f_title" maxlength="255" placeholder="Masalan: Qasoskorlar"></div>
                <div><label>Katalog *</label><select id="f_category"></select></div>
            </div>

            <!-- Kino / Multfilm: video shu yerda -->
            <div id="singleBlock">
                <div class="row">
                    <div><label>Video URL * (Telegram yoki boshqa havola)</label>
                        <input id="f_video_url" maxlength="1000" placeholder="https://t.me/kanal/post yoki video manzil"></div>
                    <div><label>Davomiyligi (daqiqa)</label>
                        <input id="f_video_min" type="number" min="0" placeholder="120"></div>
                </div>
                <p class="adm-hint">Telegram havolasi bo'lsa — "Media is too big" bo'lsa ham saqlanadi;
                   video Telegram serveridan oqiziladi, serverga yuk tushmaydi.</p>
            </div>

            <!-- Anime / Serial: nechta qism -->
            <div id="multiBlock" hidden>
                <div class="row">
                    <div><label>Nechta qismdan iborat</label>
                        <input id="f_total_ep" type="number" min="0" placeholder="12"></div>
                    <div><label>Davomiyligi (daqiqa, umumiy)</label>
                        <input id="f_duration" type="number" min="0" placeholder="24"></div>
                </div>
                <p class="adm-hint">Qismlarni saqlagandan keyin, pastdagi «Qismlar» bo'limida
                   1-qismdan boshlab URL qo'shasiz.</p>
            </div>

            <div class="row3">
                <div><label>Yil</label><input id="f_release_year" type="number" min="1895" max="2100" placeholder="2024"></div>
                <div><label>Baho (0-10)</label><input id="f_rating" type="number" step="0.1" min="0" max="10" placeholder="8.5"></div>
                <div><label>Holat</label><select id="f_status">
                    <option value="published">📢 Published (saytda ko'rinadi)</option>
                    <option value="draft">📝 Draft (yashirin)</option>
                    <option value="archived">🗄 Archived</option>
                </select></div>
            </div>
            <div class="row">
                <div><label>Davlat</label><input id="f_country" maxlength="100" placeholder="AQSh"></div>
                <div><label>Til</label><input id="f_language" maxlength="50" placeholder="O'zbekcha (tarjima)"></div>
            </div>
            <div><label>Poster (URL yoki uploads/... yo'l)</label>
                <div style="display:flex;gap:8px;align-items:center">
                    <input id="f_poster" maxlength="500" placeholder="uploads/posters/poster.jpg · t.me post ham ishlaydi">
                    <label class="adm-btn mini" style="cursor:pointer;white-space:nowrap;flex-shrink:0" title="Rasmni kompyuterdan yuklash">
                        ⬆️ Rasm
                        <input type="file" id="posterFile" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.png,.webp,.gif" hidden>
                    </label>
                </div>
                <p class="adm-hint" id="posterHint"></p>
            </div>
            <div><label>Tavsif</label>
                <textarea id="f_description" maxlength="5000" placeholder="Qisqacha tavsif..."></textarea></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
            <button class="up-btn" onclick="saveContent()" id="saveContentBtn">💾 Saqlash</button>
        </div>
    </div>

    <!-- Qismlar (faqat saqlangan kontentda) -->
    <div class="adm-card" style="padding:14px;margin-top:12px" id="epBlock" hidden>
        <h2 style="font-size:15px;margin:0 0 10px">📺 Qismlar (<span id="epCount">0</span>)</h2>
        <p class="adm-hint" style="margin:0 0 12px">
            Har qator: <b>qism raqami</b> · <b>video URL</b> · <b>davomiyligi (daqiqa)</b>.
            Tugmalar qatorning chekkasida.
        </p>
        <div id="epList"></div>
    </div>
</div>

<script>
'use strict';

let CATS = [];
let LIST_ITEMS = [];
let EPS = [];
let CURRENT = 0;

const MULTI_SLUGS = ['anime', 'serial'];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const msg = (el, txt, err) => {
    el.hidden = false;
    el.className = 'adm-msg' + (err ? ' err' : '');
    el.textContent = txt;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

async function api(url, body) {
    const opt = { credentials: 'same-origin' };
    if (body) {
        opt.method = 'POST';
        opt.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        opt.body = new URLSearchParams(body);
    }
    const res = await fetch(url, opt);
    let d = null;
    try { d = await res.json(); } catch (e) { /* bo'sh */ }
    if (!res.ok || !d || !d.success) {
        throw new Error((d && d.message) || ('Xato ' + res.status));
    }
    return d;
}

const catById = (id) => CATS.find(c => +c.id === +id) || null;
const isMulti = (cat) => !!cat && MULTI_SLUGS.indexOf(String(cat.slug || '').toLowerCase()) !== -1;
const toSec = (min) => Math.max(0, parseInt(min || '0', 10) || 0) * 60;
const toMin = (sec) => (sec && +sec > 0) ? Math.round(+sec / 60) : '';

// ============================================================ RO'YXAT
async function loadList() {
    try {
        const d = await api('api/content-admin.php?list=1');
        CATS = d.categories || [];
        LIST_ITEMS = d.items || [];
        applySearch();
    } catch (err) {
        msg($('admMsg'), err.message, true);
    }
}

function renderCatPick() {
    const box = $('catPickBox');
    box.innerHTML = '';
    const icons = { kino: '🎬', multfilm: '🎨', anime: '🍥', serial: '📺', dokumental: '🎞' };
    for (const c of CATS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cat-btn';
        b.innerHTML = '<i>' + (icons[c.slug] || '🎞') + '</i>' + esc(c.name);
        b.onclick = () => chooseCat(c.id);
        box.appendChild(b);
    }
}

function chooseCat(id) {
    $('f_category').value = id;
    $('catPick').hidden = true;
    $('contentForm').hidden = false;
    applyMode();
}

function applySearch() {
    const q = ($('listSearch').value || '').trim().toLowerCase();
    const box = $('listBox');
    box.innerHTML = '';
    let shown = 0;
    for (const c of LIST_ITEMS) {
        const hay = ('#' + c.id + ' ' + (c.title || '') + ' ' + (c.category_name || '')).toLowerCase();
        if (q && hay.indexOf(q) === -1) continue;

        const el = document.createElement('div');
        el.className = 'c-row';
        el.onclick = () => openEditor(c.id);
        el.innerHTML =
            '<div class="c-thumb' + (c.poster ? '' : ' none') + '">' +
                (c.poster
                    ? '<img src="' + esc(posterUrl(c.poster)) + '" alt="" loading="lazy" ' +
                      'onerror="this.parentNode.classList.add(\'none\');this.remove()">'
                    : '🎬') +
            '</div>' +
            '<div style="flex:1;min-width:0">' +
                '<b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                    esc(c.title) + '<span class="c-id">#' + c.id + '</span></b>' +
                '<span class="adm-hint" style="margin:2px 0 0">' +
                    esc(c.category_name || '') + ' · ' + (c.release_year || '—') +
                    ' · ⭐ ' + (+c.rating || 0).toFixed(1) +
                    ' · 📺 ' + (+c.episodes_count) +
                '</span>' +
                '<span class="c-badge st-' + esc(c.status || 'draft') + '" style="margin-top:5px;display:inline-block">' +
                    (c.status === 'published' ? '📢 Published'
                     : c.status === 'archived' ? '🗄 Archived' : '📝 Draft') +
                '</span>' +
            '</div>' +
            '<button class="adm-btn del mini" data-del="' + c.id + '" ' +
                'onclick="event.stopPropagation();delContent(' + c.id + ')">🗑</button>';
        box.appendChild(el);
        shown++;
    }
    $('listCount').textContent = shown + ' ta ko\'rsatilmoqda / ' + LIST_ITEMS.length + ' jami';
    if (!shown) {
        box.innerHTML = '<p class="adm-hint">Hech narsa topilmadi.</p>';
    }
}

function posterUrl(p) {
    if (!p) return '';
    if (/^https?:\/\//i.test(p) || p.indexOf('//') === 0) return p;
    if (p.indexOf('uploads/') === 0) return p;
    if (p.indexOf('/') === 0) return p;
    return 'uploads/' + p;
}

function showList() {
    $('view-list').hidden = false;
    $('view-edit').hidden = true;
    loadList();
}

// ============================================================ TAHRIR
function openCreate() {
    CURRENT = 0;
    $('f_id').value = '';
    fillForm({}, []);
    $('view-list').hidden = true;
    $('view-edit').hidden = false;
    $('contentForm').hidden = true;
    $('epBlock').hidden = true;
    $('catPick').hidden = false;
    $('editTitle').textContent = '＋ Yangi qo\'shish';
    renderCatPick();
    window.scrollTo(0, 0);
}

async function openEditor(id) {
    try {
        const d = await api('api/content-admin.php?id=' + id);
        CURRENT = id;
        if (d.categories && d.categories.length) CATS = d.categories;
        fillForm(d.item || {}, d.episodes || []);
        $('view-list').hidden = true;
        $('view-edit').hidden = false;
        $('catPick').hidden = true;
        $('contentForm').hidden = false;
        $('epBlock').hidden = false;
        $('editTitle').textContent = '✏️ ' + ((d.item && d.item.title) || '');
        window.scrollTo(0, 0);
    } catch (err) {
        msg($('admMsg'), err.message, true);
    }
}

function fillForm(item, eps) {
    $('f_id').value = item.id || '';
    $('f_title').value = item.title || '';
    $('f_category').innerHTML = CATS.map(c =>
        '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    if (item.category_id) $('f_category').value = item.category_id;
    $('f_status').value = item.status || 'published';
    $('f_release_year').value = item.release_year || '';
    $('f_rating').value = item.rating || '';
    $('f_duration').value = item.duration || '';
    $('f_total_ep').value = item.total_episodes || '';
    $('f_country').value = item.country || '';
    $('f_language').value = item.language || '';
    $('f_poster').value = item.poster || '';
    $('f_description').value = item.description || '';
    $('f_video_url').value = '';
    $('f_video_min').value = '';
    $('posterHint').textContent = '';
    EPS = eps || [];
    renderEpisodes();
    applyMode();
}

function applyMode() {
    const cat = catById($('f_category').value);
    const multi = isMulti(cat);
    // Video URL faqat YANGI kino/multfilmda ko'rinadi. Tahrirlashda video
    // qismlar bo'limida boshqariladi.
    $('singleBlock').hidden = multi || CURRENT > 0;
    $('multiBlock').hidden = !multi;
}

async function saveContent() {
    const btn = $('saveContentBtn');
    btn.disabled = true;
    try {
        const title = $('f_title').value.trim();
        if (!title) throw new Error('Sarlavha kerak');
        const cat = catById($('f_category').value);
        if (!cat) throw new Error('Katalogni tanlang');
        const multi = isMulti(cat);

        const body = {
            action: CURRENT > 0 ? 'update_content' : 'create_content',
            title: title,
            category_id: $('f_category').value,
            is_series: multi ? '1' : '0',
            status: $('f_status').value,
            release_year: $('f_release_year').value,
            rating: $('f_rating').value,
            duration: $('f_duration').value,
            total_episodes: multi ? ($('f_total_ep').value || '0') : '0',
            country: $('f_country').value,
            language: $('f_language').value,
            poster: $('f_poster').value.trim(),
            description: $('f_description').value,
        };
        if (CURRENT > 0) body.id = CURRENT;

        if (CURRENT <= 0 && !multi) {
            const u = $('f_video_url').value.trim();
            if (!u) throw new Error('Video URL kiriting (Telegram yoki boshqa havola)');
            body.first_episode_url = u;
            body.first_episode_duration = String(toSec($('f_video_min').value));
        }

        const d = await api('api/content-admin.php', body);
        msg($('admMsg'), d.message || 'Saqlandi');

        if (CURRENT <= 0) {
            CURRENT = +d.id;
            $('editTitle').textContent = '✏️ ' + title;
            $('epBlock').hidden = false;
            applyMode();
            await reloadEpisodes();
        }
    } catch (err) {
        msg($('admMsg'), err.message, true);
    } finally {
        btn.disabled = false;
    }
}

async function delContent(id) {
    if (!confirm('Butunlay o\'chirilsinmi? Qismlar ham o\'chadi.')) return;
    try {
        await api('api/content-admin.php', { action: 'delete_content', id: id });
        showList();
    } catch (err) {
        msg($('admMsg'), err.message, true);
    }
}

// ============================================================ QISMLAR
function renderEpisodes() {
    const box = $('epList');
    box.innerHTML = '';
    $('epCount').textContent = EPS.length;

    const sorted = EPS.slice().sort((a, b) =>
        (+a.season - +b.season) || (+a.episode_number - +b.episode_number));

    if (!sorted.length) {
        const p = document.createElement('p');
        p.className = 'adm-hint';
        p.style.margin = '0 0 6px';
        p.textContent = 'Qism yo\'q. Quyida 1-qismdan boshlab qo\'shing.';
        box.appendChild(p);
    }

    for (const e of sorted) {
        const url = e.video_url || (e.playback && e.playback.url) || '';
        const row = document.createElement('div');
        row.className = 'ep-row';
        row.dataset.id = e.id;
        row.innerHTML =
            '<input class="ep-num" type="number" min="1" value="' + (+e.episode_number) + '" title="Qism raqami">' +
            '<input class="ep-url" type="text" value="' + esc(url) + '" placeholder="https://t.me/kanal/post yoki video URL">' +
            '<input class="ep-min" type="number" min="0" value="' + esc(toMin(e.duration)) + '" placeholder="daqiqa" title="Davomiyligi (daqiqa)">' +
            '<span class="ep-actions">' +
                '<button class="adm-btn ok mini" onclick="saveEpRow(' + e.id + ')">💾 Saqlash</button>' +
                '<button class="adm-btn del mini" onclick="deleteEp(' + e.id + ')">🗑 O\'chirish</button>' +
            '</span>';
        box.appendChild(row);
    }

    const nextNum = sorted.length ? (+sorted[sorted.length - 1].episode_number + 1) : 1;
    const add = document.createElement('div');
    add.className = 'ep-row ep-add';
    add.innerHTML =
        '<input id="addNum" class="ep-num" type="number" min="1" value="' + nextNum + '" title="Qism raqami">' +
        '<input id="addUrl" class="ep-url" type="text" placeholder="https://t.me/kanal/post yoki video URL">' +
        '<input id="addMin" class="ep-min" type="number" min="0" placeholder="daqiqa" title="Davomiyligi (daqiqa)">' +
        '<span class="ep-actions"><button class="adm-btn ok mini" onclick="addEpisode()">＋ Qo\'shish</button></span>';
    box.appendChild(add);
}

async function reloadEpisodes() {
    const d = await api('api/content-admin.php?id=' + CURRENT);
    EPS = d.episodes || [];
    renderEpisodes();
}

async function saveEpRow(id) {
    const row = document.querySelector('.ep-row[data-id="' + id + '"]');
    if (!row) return;
    const url = row.querySelector('.ep-url').value.trim();
    if (!url) { msg($('admMsg'), 'Video URL kiriting', true); return; }
    try {
        const d = await api('api/content-admin.php', {
            action: 'update_episode',
            id: id,
            season: 1,
            episode_number: row.querySelector('.ep-num').value,
            video_type: 'direct',
            video_url: url,
            duration: String(toSec(row.querySelector('.ep-min').value)),
        });
        msg($('admMsg'), d.message || 'Yangilandi');
        await reloadEpisodes();
    } catch (err) {
        msg($('admMsg'), err.message, true);
    }
}

async function addEpisode() {
    const url = $('addUrl').value.trim();
    if (!url) { msg($('admMsg'), 'Video URL kiriting', true); return; }
    try {
        const d = await api('api/content-admin.php', {
            action: 'add_episode',
            content_id: CURRENT,
            season: 1,
            episode_number: $('addNum').value,
            video_type: 'direct',
            video_url: url,
            duration: String(toSec($('addMin').value)),
        });
        msg($('admMsg'), d.message || 'Qo\'shildi');
        await reloadEpisodes();
    } catch (err) {
        msg($('admMsg'), err.message, true);
    }
}

async function deleteEp(id) {
    if (!confirm('Bu qism o\'chirilsinmi?')) return;
    try {
        await api('api/content-admin.php', { action: 'delete_episode', id: id });
        await reloadEpisodes();
    } catch (err) {
        msg($('admMsg'), err.message, true);
    }
}

// ============================================================ POSTER
$('posterFile').addEventListener('change', function () {
    const f = this.files && this.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('image', f);
    $('posterHint').textContent = 'Yuklanmoqda: ' + f.name + '...';
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/content-upload.php');
    xhr.onload = function () {
        try {
            const d = JSON.parse(xhr.responseText);
            if (!d.success) throw new Error(d.message || 'Yuklashda xatolik');
            $('f_poster').value = d.url;
            updatePosterHint();
        } catch (err) {
            $('posterHint').textContent = '❌ ' + err.message;
        }
        this.value = '';
    };
    xhr.onerror = () => { $('posterHint').textContent = '❌ Ulanish xatosi'; this.value = ''; };
    xhr.send(fd);
});

function updatePosterHint() {
    const v = $('f_poster').value.trim();
    $('posterHint').textContent = /t\.me/i.test(v)
        ? '⚠ t.me post — saqlashda rasmi avtomatik serverga yuklab olinadi (post ochiq bo\'lishi kerak).'
        : '';
}
$('f_poster').addEventListener('input', updatePosterHint);
$('f_category').addEventListener('change', applyMode);

// ============================================================ START
$('listSearch').addEventListener('input', applySearch);
loadList();
</script>
</body>
</html>
