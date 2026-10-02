<?php
// ============================================================================
// admin-content.php - Kontent va qismlar boshqaruvi (faqat ADMIN)
// ============================================================================
// Kontent (film/serial meta) + qismlar (episodes). Shu paytgacha kontent
// faqat SQL orqali qo'shilar edi - endi admin brauzerda yaratadi, o'zgartiradi,
// videoni yuklaydi va boshqaradi.
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

if (!$auth->isAdmin()) {
    http_response_code(403);
    $denied = true;
} else {
    $denied = false;
}
?>
<!DOCTYPE html>
<html lang="uz">
<head>
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
        .adm-hint { font-size:11.5px; color:var(--muted); margin-top:4px; line-height:1.4; white-space:pre-line; word-break:break-word; }
        .adm-hint.ok   { color:#7fe0ae; }
        .adm-hint.warn { color:#ffc48a; }
        .adm-hint.err  { color:#ff9e9e; }
        #tgActions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:8px; }
        #tgActions[hidden] { display:none; }
        .c-list { display:grid; gap:8px; }
        .c-row { display:flex; align-items:center; gap:10px; padding:10px 12px;
                 background:var(--surface,#1e1b26); border:1px solid var(--border,#3a3644);
                 border-radius:12px; cursor:pointer; }
        .c-row:hover { border-color:#6a5cff; }
        .c-badge { font-size:11px; padding:3px 8px; border-radius:99px; background:#2a2740; color:#b7aef0; }
        .c-badge.series { background:#143a2c; color:#7fe0ae; }
        .c-badge.archived { background:#3a2430; color:#ff9e9e; }
        .c-badge.draft { background:#3a3324; color:#ffd08a; }
        .ep-row { display:flex; align-items:center; gap:10px; padding:9px 11px;
                  background:var(--surface,#1e1b26); border:1px solid var(--border,#3a3644);
                  border-radius:12px; margin-bottom:8px; flex-wrap:wrap; }
        .ep-type { font-weight:600; font-size:11px; padding:2px 8px; border-radius:99px; }
        .ep-type.direct  { background:#143a2c; color:#7fe0ae; }
        .ep-type.file    { background:#20304a; color:#8fc1ff; }
        .ep-type.embed   { background:#3a2430; color:#ff9e9e; }
        .ep-type.hls     { background:#3a2d14; color:#ffc48a; }
        .ep-type.none    { background:#2a2740; color:#b7aef0; }
        .ml-a { margin-left:auto; display:flex; gap:6px; align-items:center; }
        .adm-btn.mini { padding:5px 10px; font-size:12px; }
        .up-link { color:#8fc1ff; text-decoration:none; }
        #uploadBar { display:none; height:5px; background:#2a2740; border-radius:99px; overflow:hidden; }
        #uploadBar i { display:block; height:100%; width:0; background:#6a5cff; transition:width .15s; }

        /* ===== Yangi: statistika + qidiruv + post kartalari ===== */
        .adm-stats {
            display:grid;
            grid-template-columns:repeat(auto-fit,minmax(120px,1fr));
            gap:8px;
            margin-bottom:14px;
        }
        .adm-stat {
            background:linear-gradient(150deg,var(--card),rgba(255,255,255,.03));
            border:1px solid rgba(255,255,255,.08);
            border-radius:14px;
            padding:12px 14px;
            display:flex;
            flex-direction:column;
            gap:2px;
        }
        .adm-stat b { font-size:22px; line-height:1.1; }
        .adm-stat span { font-size:11.5px; color:var(--muted); }
        .adm-search {
            flex:1;
            min-width:180px;
            max-width:340px;
            padding:9px 12px;
            border-radius:10px;
            border:1px solid rgba(255,255,255,.12);
            background:rgba(255,255,255,.04);
            color:inherit;
            font-size:13.5px;
            outline:none;
        }
        .adm-search:focus { border-color:#8fc1ff; background:rgba(255,255,255,.07); }
        .c-row { display:flex; gap:12px; align-items:center; cursor:pointer; }
        .c-thumb {
            width:52px; height:74px; flex-shrink:0;
            border-radius:9px; overflow:hidden;
            background:linear-gradient(140deg,#2a2740,#1a1830);
            display:flex; align-items:center; justify-content:center;
            font-size:22px;
            box-shadow:0 2px 8px rgba(0,0,0,.35);
        }
        .c-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
        .c-thumb.none { color:var(--muted); }
        .c-sub { display:flex; gap:5px; margin-top:6px; flex-wrap:wrap; }
        .c-badge { display:inline-block; white-space:nowrap; }
        .c-badge.series { background:#143a2c; color:#7fe0ae; }
        .c-badge.film   { background:#3a2d14; color:#ffc48a; }
        .c-badge.st-published { background:#143a2c; color:#7fe0ae; }
        .c-badge.st-draft     { background:#3a2430; color:#ff9e9e; }
        .c-badge.st-archived  { background:#2a2740; color:#b7aef0; }
    </style>
</head>
<body class="adm-body ig-shell">

<!-- Instagram uslubidagi navigatsiya -->
<?php $NAV_ACTIVE = ''; require __DIR__ . '/includes/nav.php'; ?>

<?php if ($denied): ?>
    <div class="up-card" style="margin-top:60px;text-align:center">
        <div style="font-size:44px">🚫</div>
        <h1 style="font-size:19px;margin:10px 0 6px">Ruxsat yo'q</h1>
        <p style="color:var(--muted);font-size:13.5px;margin-bottom:18px">
            Bu sahifa faqat administratorlar uchun.
        </p>
        <a class="up-btn" href="index.php">Bosh sahifa</a>
    </div>
<?php else: ?>

<header class="up-top">
    <a class="reels-back" href="index.php" aria-label="Orqaga">←</a>
    <div class="up-title">Kontent boshqaruvi</div>
    <span style="width:34px"></span>
</header>

<nav class="adm-tabs">
    <button class="chip adm-tab active" onclick="location.href='admin-content.php'">🎬 Kontent</button>
    <button class="chip adm-tab" onclick="location.href='admin-reels.php'">🎞 Reels moderatsiya</button>
</nav>

<div class="adm-msg" id="admMsg" hidden></div>

<div id="view-list">
    <div class="adm-stats">
        <div class="adm-stat"><b id="stTotal">0</b><span>Jami kontent</span></div>
        <div class="adm-stat"><b id="stSeries">0</b><span>📺 Serial</span></div>
        <div class="adm-stat"><b id="stFilms">0</b><span>🎬 Film</span></div>
        <div class="adm-stat"><b id="stDraft">0</b><span>📝 Draft</span></div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
        <button class="up-btn" onclick="openEditor(0)">＋ Yangi kontent</button>
        <input id="listSearch" class="adm-search" type="search" placeholder="🔍 Qidirish (nomi, kategoriya)…" autocomplete="off">
        <span style="font-size:12.5px;color:var(--muted);margin-left:auto" id="listCount"></span>
    </div>
    <div class="c-list" id="listBox"></div>
</div>

<div id="view-edit" hidden>
    <button class="adm-btn ok mini" onclick="showList()" style="margin-bottom:10px">← Ro'yxatga</button>

    <div class="adm-card" style="padding:14px">
        <h2 style="font-size:15px;margin:0 0 12px" id="editTitle">Yangi kontent</h2>
        <div class="adm-form" id="contentForm">
            <input type="hidden" id="f_id">
            <div class="row">
                <div><label>Sarlavha *</label><input id="f_title" maxlength="255" placeholder="Masalan: Qasoskorlar"></div>
                <div><label>Kategoriya *</label><select id="f_category"></select></div>
            </div>
            <div class="row">
                <div><label>Turi</label><select id="f_is_series">
                    <option value="0">Film (yagona qism)</option>
                    <option value="1">Serial (bir necha qism)</option>
                </select></div>
                <div><label>Holat</label><select id="f_status">
                    <option value="published">📢 Published (saytda ko'rinadi)</option>
                    <option value="draft">📝 Draft (yashirin)</option>
                    <option value="archived">🗄 Archived</option>
                </select></div>
            </div>
            <div class="row3">
                <div><label>Yil</label><input id="f_release_year" type="number" min="1895" max="2100" placeholder="2024"></div>
                <div><label>Baho (0-10)</label><input id="f_rating" type="number" step="0.1" min="0" max="10" placeholder="8.5"></div>
                <div><label>Davomiyligi (daqiqa)</label><input id="f_duration" type="number" min="0" placeholder="120"></div>
            </div>
            <div class="row">
                <div><label>Davlat</label><input id="f_country" maxlength="100" placeholder="AQSh"></div>
                <div><label>Til</label><input id="f_language" maxlength="50" placeholder="O'zbekcha (tarjima)"></div>
            </div>
            <div><label>Poster (URL yoki uploads/... yo'l)</label>
                <div style="display:flex;gap:8px;align-items:center">
                    <input id="f_poster" maxlength="500" placeholder="uploads/posters/poster.jpg  ·  t.me post ham ishlaydi">
                    <label class="adm-btn mini" style="cursor:pointer;white-space:nowrap;flex-shrink:0" title="Rasmni kompyuterdan yuklash">
                        ⬆️ Rasm
                        <input type="file" id="posterFile" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.png,.webp,.gif" hidden>
                    </label>
                </div>
                <p class="adm-hint" id="posterHint"></p>
            </div>
            <div><label>Tavsif</label><textarea id="f_description" maxlength="5000" placeholder="Qisqacha tavsif..."></textarea></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
            <button class="up-btn" onclick="saveContent()" id="saveContentBtn">💾 Saqlash</button>
            <?php if (!$denied && false): ?><?php endif; ?>
        </div>
    </div>

    <div class="adm-card" style="padding:14px;margin-top:12px" id="epBlock" hidden>
        <h2 style="font-size:15px;margin:0 0 6px">📺 Qismlar (<span id="epCount">0</span>)</h2>
        <p class="adm-hint" style="margin:0 0 10px">
            Serialda har qism alohida video. Filmda bitta qism (1-fasl 1-qism) yetarli.
            "Direkt" — to'g'ridan-to'g'ri MP4 havola (seek ishlaydi), "Fayl" — serverga yuklangan,
            "Embed" — YouTube/iframe (bo'lak kesib bo'lmaydi).
            Telegram (t.me) havolasi qo'ysangiz — post OCHIQ kanalda bo'lishi va postda
            video aynan o'sha postda ko'rinishi kerak, aks holda fayl turini tanlab yuklang.
        </p>
        <div id="epList"></div>

        <h3 style="font-size:13px;margin:14px 0 8px" id="epFormTitle">＋ Qism qo'shish</h3>
        <div class="adm-form">
            <input type="hidden" id="e_id">
            <div class="row3">
                <div><label>Fasl</label><input id="e_season" type="number" min="1" value="1"></div>
                <div><label>Qism raqami *</label><input id="e_number" type="number" min="1" value="1"></div>
                <div><label>Davomiyligi (soniya)</label><input id="e_duration" type="number" min="0" placeholder="3600"></div>
            </div>
            <div class="row">
                <div><label>Qism nomi</label><input id="e_title" maxlength="255" placeholder="1-qism"></div>
                <div><label>Manba turi</label><select id="e_type">
                    <option value="direct">Direct — to'g'ridan-to'g'ri MP4 havola</option>
                    <option value="file">Fayl — serverdagi uploads/... yo'l</option>
                    <option value="embed">Embed — YouTube / iframe</option>
                    <option value="hls">HLS — .m3u8 oqim</option>
                    <option value="none">Yo'q — video hali kiritilmagan</option>
                </select></div>
            </div>
            <div>
                <label>Video manzili * (t.me havola, URL yoki uploads/... yo'l)</label>
                <div style="display:flex;gap:8px">
                    <input id="e_url" maxlength="1000" style="flex:1" placeholder="https://t.me/kanal/postid  |  https://...mp4  |  uploads/videos/fayl.mp4">
                    <button class="adm-btn ok mini" type="button" onclick="checkTgUrl()" style="white-space:nowrap">🔍 Tekshirish</button>
                </div>
                <p class="adm-hint" id="epUrlHint"></p>
                <div id="tgActions" hidden>
                    <button class="adm-btn ok mini" type="button" id="tgPullBtn" onclick="tgPullVideo()" style="white-space:nowrap">📥 Telegram'dan yuklab olish</button>
                    <span class="adm-hint" id="tgPullHint" style="margin:0"></span>
                    <span class="adm-hint" id="tgPullNote" style="margin:0"></span>
                </div>
            </div>
            <div class="row">
                <div><label>720p (ixtiyoriy)</label><input id="e_url720" maxlength="1000"></div>
                <div><label>1080p (ixtiyoriy)</label><input id="e_url1080" maxlength="1000"></div>
            </div>
            <div><label>Tavsif</label><textarea id="e_desc" maxlength="2000"></textarea></div>
            <div>
                <input type="checkbox" id="e_premium" style="width:auto"> <label for="e_premium" style="display:inline">💎 Premium qism</label>
            </div>
        </div>
        <div id="uploadBar"><i></i></div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="up-btn" onclick="saveEpisode()" id="saveEpBtn">💾 Qismni saqlash</button>
            <label class="adm-btn ok mini" style="cursor:pointer">
                ⬆️ Videoni serverga yuklash
                <input type="file" id="videoFile" accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv,.m4v" hidden>
            </label>
            <button class="adm-btn del mini" onclick="cancelEpEdit()" id="cancelEpBtn" hidden>✖ Bekor qilish</button>
        </div>
        <p class="adm-hint" id="upHint"></p>
    </div>
</div>

<?php endif; ?>

<script>
'use strict';

// Telegram'dan yuklab olish tayyormi? (server holati, har sahifa ochilganda)
const TG_PULL_LIB  = <?php echo is_file(__DIR__ . '/vendor/autoload.php') ? 'true' : 'false'; ?>;
const TG_PULL_CRED = <?php echo (TG_API_ID > 0 && TG_API_HASH !== '' && TELEGRAM_BOT_TOKEN !== '') ? 'true' : 'false'; ?>;
let tgPollTimer = null;

let CATS = [];
let CURRENT = 0;      // ochilgan content id (0 = yangi)
let EPS = [];

const $  = (id) => document.getElementById(id);
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

// ---------------------------------------------------------------- t.me tekshirish
// Kiritilgan video manzili (yoki t.me havola) ishlaydimi — serverdan aniqlaydi.
async function checkTgUrl() {
    const hint = $('epUrlHint');
    const url = $('e_url').value.trim();
    if (!url) { hint.className = 'adm-hint err'; hint.hidden = false; hint.textContent = '⚠️ Avval video manzilini kiriting.'; return; }
    if (/^https?:\/\/(www\.)?(t\.me|telegram\.me)\//i.test(url)) {
        // t.me post — server tekshirib, HAQIQIY holatini aytadi
        hint.className = 'adm-hint'; hint.hidden = false; hint.textContent = '⏳ Telegram post tekshirilmoqda…';
        try {
            const r = await api('api/tg-resolve.php?url=' + encodeURIComponent(url));
            let cls, txt;
            if (r.video) {
                cls = 'ok';
                txt = '✅ Postda HAQIQIY video bor — playerda o‘ynaydi (Cloudflare CDN orqali).\nMANBA: ' + r.video;
            } else if (r.media_big) {
                cls = 'err';
                txt = '⚠️ Telegram veb-player katta videoni (film) tashqarida o‘ynatmaydi — “Media is too big”. Faylni “⬆️ Videoni serverga yuklash” bilan qo‘shing yoki kichikroq video post qiling.';
            } else if (r.has_video && !r.embed_ok) {
                cls = 'err';
                txt = '⚠️ Bu postda VIDEO bor, lekin Telegram uni ommaviy ko‘rsatmayapti (“Please open Telegram”). Saytda o‘ynamaydi — videoni “⬆️ Videoni serverga yuklash” bilan qo‘shing.';
            } else if (r.embed_ok) {
                cls = 'warn';
                txt = 'ℹ️ Telegram post ko‘rinadi — embed iframe orqali o‘ynashi mumkin.';
            } else if (r.has_post) {
                cls = 'err';
                txt = '⚠️ Post media-sini tashqarida ko‘rsatmaydi — saytda o‘ynamaydi. Fayl yuklang.';
            } else {
                cls = 'err';
                txt = '❌ Post anonimlarga ko‘rinmayapti yoki mavjud emas. Boshqa havola qo‘ying yoki fayl yuklang.';
            }
            hint.className = 'adm-hint ' + cls;
            hint.hidden = false;
            hint.textContent = txt;
        } catch (e) {
            hint.className = 'adm-hint err'; hint.hidden = false;
            hint.textContent = '❌ Tekshirib bo‘lmadi: ' + e.message;
        }
        return;
    }
    // t.me emas — shunchaki manzil formati
    if (/^https?:\/\//i.test(url) || /^uploads\//i.test(url)) {
        hint.className = 'adm-hint ok'; hint.hidden = false;
        hint.textContent = 'ℹ️ Ochiq manzil — “▶ Sinash” tugmasi orqali playerda tekshiring.';
    } else {
        hint.className = 'adm-hint err'; hint.hidden = false;
        hint.textContent = '⚠️ Manzil http(s):// yoki uploads/... bilan boshlanishi kerak.';
    }
}

// ---------------------------------------------------------------- ro'yxat
let LIST_ITEMS = [];

// Poster manzilini to'liq URL'ga aylantiradi (admin sahifa ildizda turadi)
function posterUrl(p) {
    if (!p) return '';
    if (/^https?:\/\//i.test(p) || p.indexOf('//') === 0) return p;
    if (p.indexOf('uploads/') === 0) return p;
    if (p.indexOf('/') === 0) return p;
    return 'uploads/' + p;
}

function applySearch() {
    const q = ($('listSearch').value || '').trim().toLowerCase();
    const box = $('listBox');
    box.innerHTML = '';
    let shown = 0;
    for (const c of LIST_ITEMS) {
        const hay = ((c.title || '') + ' ' + (c.category_name || '')).toLowerCase();
        if (q && hay.indexOf(q) === -1) continue;
        const el = document.createElement('div');
        el.className = 'c-row';
        el.onclick = () => openEditor(c.id);
        const badge = c.is_series == 1 ? 'Serial' : 'Film';
        el.innerHTML =
            '<div class="c-thumb">' +
                (c.poster
                    ? '<img src="' + escapeHtml(posterUrl(c.poster)) + '" alt="" loading="lazy" ' +
                      'onerror="this.parentNode.classList.add(\'none\');this.remove()">'
                    : '<span>🎬</span>') +
            '</div>' +
            '<div style="flex:1;min-width:0">' +
                '<b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                    escapeHtml(c.title) + '</b>' +
                '<span style="font-size:11.5px;color:var(--muted)">' +
                    escapeHtml(c.category_name || '') + ' · ' + (c.release_year || '—') +
                    ' · ⭐ ' + (+c.rating || 0).toFixed(1) + '</span>' +
                '<div class="c-sub">' +
                    '<span class="c-badge' + (c.is_series == 1 ? ' series' : ' film') + '">' + badge + '</span>' +
                    '<span class="c-badge st-' + (c.status || 'draft') + '">' +
                        (c.status === 'published' ? '📢 Published' : c.status === 'archived' ? '🗄 Archived' : '📝 Draft') +
                    '</span>' +
                    '<span class="c-badge">📺 ' + (+c.episodes_count) + '</span>' +
                '</div>' +
            '</div>' +
            '<button class="adm-btn del mini" data-del="' + c.id + '" ' +
                'onclick="event.stopPropagation();delContent(' + c.id + ')">🗑</button>';
        box.appendChild(el);
        shown++;
    }
    $('listCount').textContent = shown + ' ta ko\'rsatilmoqda / ' + LIST_ITEMS.length + ' jami';
}

async function loadList() {
    try {
        const d = await api('api/content-admin.php?list=1');
        CATS = d.categories || [];
        LIST_ITEMS = d.items || [];
        // Statistika
        $('stTotal').textContent = LIST_ITEMS.length;
        $('stSeries').textContent = LIST_ITEMS.filter(c => c.is_series == 1).length;
        $('stFilms').textContent = LIST_ITEMS.filter(c => c.is_series != 1).length;
        $('stDraft').textContent = LIST_ITEMS.filter(c => c.status === 'draft').length;
        applySearch();
    } catch (err) {
        msg($('admMsg'), err.message, true);
    }
}

// Qidiruv maydoniga amallar
document.addEventListener('DOMContentLoaded', function () {
    const s = $('listSearch');
    if (s) s.addEventListener('input', applySearch);
});

// ---------------------------------------------------------------- editor
function showList() {
    $('view-list').hidden = false;
    $('view-edit').hidden = true;
}

async function openEditor(id) {
    CURRENT = id;
    try {
        let item = {};
        let eps = [];
        if (id > 0) {
            const d = await api('api/content-admin.php?id=' + id);
            item = d.item || {};
            eps = d.episodes || [];
        }
        CATS = (CATS.length ? CATS : await (await fetch('api/content-admin.php?list=1')).json().then(x => x.categories || []));
        fillContentForm(item);
        EPS = eps;
        renderEpisodes();
        $('view-list').hidden = true;
        $('view-edit').hidden = false;
        $('editTitle').textContent = id > 0 ? '✏️ ' + (item.title || '') : '＋ Yangi kontent';
        window.scrollTo(0, 0);
    } catch (err) {
        msg($('admMsg'), err.message, true);
    }
}

function fillContentForm(item) {
    $('f_id').value = item.id || '';
    $('f_title').value = item.title || '';
    $('f_category').innerHTML = CATS.map(c =>
        '<option value="' + c.id + '"' + (+c.id === +(item.category_id || 0) ? ' selected' : '') + '>' +
        escapeHtml(c.name) + '</option>').join('');
    $('f_is_series').value = item.is_series == 1 ? '1' : '0';
    $('f_status').value = item.status || 'published';
    $('f_release_year').value = item.release_year || '';
    $('f_rating').value = item.rating || '';
    $('f_duration').value = item.duration || '';
    $('f_country').value = item.country || '';
    $('f_language').value = item.language || '';
    $('f_poster').value = item.poster || '';
    $('f_description').value = item.description || '';
    // Qismlar bloki faqat saqlangan kontentda ochiladi
    $('epBlock').hidden = CURRENT <= 0;
    if (CURRENT <= 0) cancelEpEdit();
}

async function saveContent() {
    const btn = $('saveContentBtn');
    btn.disabled = true;
    try {
        const body = { action: CURRENT > 0 ? 'update_content' : 'create_content' };
        if (CURRENT > 0) body.id = CURRENT;
        body.title = $('f_title').value.trim();
        body.category_id = $('f_category').value;
        body.is_series = $('f_is_series').value;
        body.status = $('f_status').value;
        body.release_year = $('f_release_year').value;
        body.rating = $('f_rating').value;
        body.duration = $('f_duration').value;
        body.country = $('f_country').value;
        body.language = $('f_language').value;
        body.poster = $('f_poster').value.trim();
        body.description = $('f_description').value;

        const d = await api('api/content-admin.php', body);
        const nid = +d.id;
        msg($('admMsg'), d.message + (CURRENT > 0 ? '' : ' — endi qism qo‘shing'));
        if (CURRENT <= 0) {
            CURRENT = nid;                 // yangi kontent → qismlarni biriktiramiz
            $('editTitle').textContent = '✏️ ' + $('f_title').value;
            $('epBlock').hidden = false;
        }
    } catch (err) {
        msg($('admMsg'), err.message, true);
    } finally {
        btn.disabled = false;
    }
}

async function delContent(id) {
    if (!confirm('Butunlay o‘chirilsinmi? Qismlar, reels bo‘laklari ham o‘chadi.')) return;
    try {
        await api('api/content-admin.php', { action: 'delete_content', id: id });
        loadList();
    } catch (err) {
        msg($('admMsg'), err.message, true);
    }
}

// ---------------------------------------------------------------- qismlar
function renderEpisodes() {
    const box = $('epList');
    box.innerHTML = '';
    $('epCount').textContent = EPS.length;
    if (!EPS.length) {
        box.innerHTML = '<p class="adm-hint">Qism yo‘q. Quyida birinchi qismni qo‘shing.</p>';
        return;
    }
    for (const e of EPS) {
        const t = document.createElement('div');
        t.className = 'ep-row';
        const pb = e.playback || {};
        const type = e.video_type || 'none';
        const url = pb.url || e.video_url || '';
        t.innerHTML =
            '<span class="ep-type ' + escapeHtml(type) + '">' + escapeHtml(type) + '</span>' +
            '<div style="flex:1;min-width:0">' +
                '<b>' + (+e.season) + '-' + (+e.episode_number) + '. '
                    + escapeHtml(e.title || ('Qism ' + e.episode_number)) + '</b>' +
                (url ? '<div class="adm-hint" style="margin:0;word-break:break-all">' + escapeHtml(url) + '</div>' : '') +
                ((pb.warning) ? '<div class="adm-hint" style="color:#ffc48a;margin:2px 0 0">⚠ ' + escapeHtml(pb.warning) + '</div>' : '') +
            '</div>' +
            '<span style="font-size:11.5px;color:var(--muted)">' + (+e.duration || 0) + 's</span>' +
            '<span class="ml-a">' +
                '<a class="up-link adm-btn ok mini" href="index.php?c=' + CURRENT + '&e=' + e.id + '" target="_blank">▶ Sinash</a>' +
                '<button class="adm-btn mini" onclick="editEpisode(' + e.id + ')">✏️</button>' +
                '<button class="adm-btn del mini" onclick="delEpisode(' + e.id + ')">🗑</button>' +
            '</span>';
        box.appendChild(t);
    }
}

function editEpisode(id) {
    const e = EPS.find(x => +x.id === +id);
    if (!e) return;
    $('e_id').value = e.id;
    $('e_season').value = e.season;
    $('e_number').value = e.episode_number;
    $('e_title').value = e.title || '';
    $('e_type').value = e.video_type || 'direct';
    $('e_url').value = e.video_url || '';
    $('e_url720').value = e.video_url_720p || '';
    $('e_url1080').value = e.video_url_1080p || '';
    $('e_duration').value = e.duration || '';
    $('e_desc').value = e.description || '';
    $('e_premium').checked = e.is_premium == 1;
    $('epFormTitle').textContent = '✏️ ' + e.season + '-' + e.episode_number + ' − qismni tahrirlash';
    $('cancelEpBtn').hidden = false;
    $('saveEpBtn').textContent = '💾 Yangilash';
    $('epFormTitle').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cancelEpEdit() {
    $('e_id').value = '';
    $('e_season').value = 1;
    $('e_number').value = EPS.length ? +EPS[EPS.length - 1].episode_number + 1 : 1;
    $('e_title').value = '';
    $('e_type').value = 'direct';
    $('e_url').value = '';
    $('e_url720').value = '';
    $('e_url1080').value = '';
    $('e_duration').value = '';
    $('e_desc').value = '';
    $('e_premium').checked = false;
    $('epFormTitle').textContent = '＋ Qism qo‘shish';
    $('cancelEpBtn').hidden = true;
    $('saveEpBtn').textContent = '💾 Qismni saqlash';
    $('upHint').textContent = '';
}

async function saveEpisode() {
    if (CURRENT <= 0) {
        msg($('admMsg'), 'Avval kontentni saqlang', true);
        return;
    }
    const editId = $('e_id').value;
    const btn = $('saveEpBtn');
    btn.disabled = true;
    try {
        const body = {
            action: editId ? 'update_episode' : 'add_episode',
            content_id: CURRENT,
            season: $('e_season').value || 1,
            episode_number: $('e_number').value,
            title: $('e_title').value,
            video_type: $('e_type').value,
            video_url: $('e_url').value.trim(),
            video_url_720p: $('e_url720').value.trim(),
            video_url_1080p: $('e_url1080').value.trim(),
            duration: $('e_duration').value,
            description: $('e_desc').value,
            is_premium: $('e_premium').checked ? '1' : '0',
        };
        if (editId) body.id = editId;
        const d = await api('api/content-admin.php', body);
        // qismlar ro'yxatini yangilaymiz
        const dd = await api('api/content-admin.php?id=' + CURRENT);
        EPS = dd.episodes || [];
        renderEpisodes();
        const tg = d.tg || null;
        let m = d.message + ' — playback: ' + (d.playback ? d.playback.type : '?');
        // DIQQAT: 'telegram' normal holat (film "o'ynalmaydi" emas) — saytda
        // «Telegram'da ko'rish» tugmasi chiqadi, video Telegram CDN'dan oqadi.
        // Xato faqat 'none' bo'lganda.
        let err = !!(d.playback && d.playback.type === 'none');
        if (tg) {
            if (tg.video) {
                m += ' ✅ Postda HAQIQIY video topildi — sayt ichida Telegram CDN dan to‘g‘ridan-to‘g‘ri o‘ynaydi (sayt yuki 0).';
            } else if (tg.media_big) {
                m = '✅ Katta film — sayt uni Telegram serveridan to‘g‘ridan-to‘g‘ri o‘ynatadi (sayt yuki 0). Ilovaga o‘tish shart emas.';
            } else if (tg.embed_ok || tg.has_video) {
                m += ' ℹ️ Video Telegram’da ochiladi (sayt yuki 0).';
            } else if (tg.has_post) {
                m = '⚠️ Bu Telegram posti media-sini tashqarida ko‘rsatmaydi. «Telegram’da ko‘rish» tugmasi yana ham ish beradi, lekin kanalga kirish talab qilishi mumkin. Boshqa ochiq VIDEO post havolasini qo‘ying yoki fayl yuklang.';
            } else {
                m = '⚠️ Telegram post ommaviy ko‘rinmayapti (kanal link-preview o‘chirilgan yoki post xususiy). Boshqa ochiq VIDEO post havolasini qo‘ying yoki fayl yuklang.';
                err = true;
            }
        }
        msg($('admMsg'), m, err);
        cancelEpEdit();
    } catch (err) {
        msg($('admMsg'), err.message, true);
    } finally {
        btn.disabled = false;
    }
}

async function delEpisode(id) {
    if (!confirm('Qism o‘chirilsinmi?')) return;
    try {
        await api('api/content-admin.php', { action: 'delete_episode', id: id });
        const dd = await api('api/content-admin.php?id=' + CURRENT);
        EPS = dd.episodes || [];
        renderEpisodes();
    } catch (err) {
        msg($('admMsg'), err.message, true);
    }
}

// ---------------------------------------------------------------- video yuklash
$('videoFile').addEventListener('change', function () {
    const f = this.files && this.files[0];
    if (!f) return;
    const bar = $('uploadBar');
    const fill = bar.querySelector('i');
    const fd = new FormData();
    fd.append('video', f);
    bar.style.display = 'block';
    fill.style.width = '0%';
    $('upHint').textContent = 'Yuklanmoqda: ' + f.name + ' (' + Math.round(f.size / 1048576) + ' MB)...';
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/content-upload.php');
    xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) fill.style.width = Math.round(ev.loaded / ev.total * 100) + '%';
    };
    xhr.onload = function () {
        bar.style.display = 'none';
        try {
            const d = JSON.parse(xhr.responseText);
            if (!d.success) throw new Error(d.message || 'Yuklashda xatolik');
            $('e_type').value = 'file';
            $('e_url').value = d.url;
            $('upHint').textContent = '✅ Saqlandi: ' + d.url + ' (' + Math.round(d.size / 1048576) + ' MB)';
        } catch (err) {
            $('upHint').textContent = '❌ ' + err.message;
        }
        this.value = '';
    };
    xhr.onerror = () => { bar.style.display = 'none'; $('upHint').textContent = '❌ Ulanish xatosi'; this.value = ''; };
    xhr.send(fd);
});

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// ---------------------------------------------------------------- poster yuklash
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
            $('posterHint').textContent = '✅ Saqlandi: ' + d.url;
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
    if (/t\.me/i.test(v)) {
        $('posterHint').textContent = '⚠ t.me post — saqlashda rasmi avtomatik serverga yuklab olinadi (post ochiq bo‘lishi kerak).';
    } else {
        $('posterHint').textContent = '';
    }
}

function updateEpUrlHint() {
    const v = $('e_url').value.trim();
    const h = $('epUrlHint');
    const isTg = /t\.me|telegram\.me/i.test(v);
    h.className = 'adm-hint';
    $('tgActions').hidden = !isTg;
    if (isTg) {
        h.className = 'adm-hint warn';
        h.textContent = '⚠ Telegram post — post havolasi ochiq bo‘lsa «🔍 Tekshirish» aniq holatni aytadi. Katta video bo‘lsa (Telegram "Media is too big" qaytaradi) — «📥 Telegram’dan yuklab olish» bilan uni serverga tushirib olamiz.';
        tgPullNote();
    } else {
        h.textContent = '';
    }
}

// "Telegram'dan yuklab olish" tugmasi holati — sozlamalar yetishmasa ogohlantiradi.
function tgPullNote() {
    const note = $('tgPullNote');
    const btn  = $('tgPullBtn');
    if (!TG_PULL_LIB) {
        note.className = 'adm-hint err';
        note.textContent = 'Kutubxona o‘rnatilmagan (vendor/).';
        btn.disabled = true;
        return;
    }
    if (!TG_PULL_CRED) {
        note.className = 'adm-hint warn';
        note.textContent = 'Ishlashi uchun .env ga API_ID va API_HASH kiriting (my.telegram.org → API development tools, 2 daqiqa).';
        btn.disabled = true;
        return;
    }
    note.className = 'adm-hint';
    note.textContent = '';
    btn.disabled = false;
}

// Telegram'dan video nusxalab yuklab olish (job boshlamoqchi).
async function tgPullVideo() {
    const url = $('e_url').value.trim();
    if (!/t\.me|telegram\.me/i.test(url)) return;
    const hint = $('tgPullHint');
    const btn  = $('tgPullBtn');
    btn.disabled = true;
    hint.className = 'adm-hint';
    hint.textContent = '⏳ Ish boshlandi…';
    try {
        const d = await api('api/tg-pull.php', { url });
        if (!d.job) {
            throw new Error(d.message || 'Job yaratilmadi');
        }
        tgPollJob(d.job, hint, btn);
    } catch (e) {
        hint.className = 'adm-hint err';
        hint.textContent = e.message;
        btn.disabled = false;
    }
}

// Yuklanish holatini so‘rab turadi; tugaganida maydonlarni to‘ldiradi.
function tgPollJob(job, hint, btn) {
    if (tgPollTimer) clearInterval(tgPollTimer);
    tgPollTimer = setInterval(async () => {
        try {
            const s = await api('api/tg-pull.php?job=' + encodeURIComponent(job));
            if (s.status === 'done') {
                clearInterval(tgPollTimer);
                tgPollTimer = null;
                if (s.path) {
                    $('e_url').value = s.path;
                    $('e_type').value = 'file';
                }
                hint.className = 'adm-hint ok';
                hint.textContent = '✅ Yuklab olindi (' + fmtSize(s.size) + ') → '
                    + (s.path || '') + '. Endi «Saqlash» tugmasini bosing.';
                btn.disabled = false;
                updateEpUrlHint();
            } else if (s.status === 'error') {
                clearInterval(tgPollTimer);
                tgPollTimer = null;
                hint.className = 'adm-hint err';
                hint.textContent = s.error || 'Xato yuz berdi.';
                btn.disabled = false;
            } else {
                hint.className = 'adm-hint';
                const spd = s.speed ? (' (' + fmtSize(s.speed) + '/s)') : '';
                hint.textContent = '⏳ Yuklab olinmoqda: ' + (s.progress || 0) + '%' + spd
                    + ' — bir necha daqiqa ketishi mumkin, sahifa ochiq tursin.';
            }
        } catch (e) {
            clearInterval(tgPollTimer);
            tgPollTimer = null;
            hint.className = 'adm-hint err';
            hint.textContent = 'Holatni o‘qishda xato: ' + e.message;
            btn.disabled = false;
        }
    }, 2500);
}

function fmtSize(b) {
    b = Number(b) || 0;
    if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
    if (b >= 1048576)    return (b / 1048576).toFixed(1) + ' MB';
    if (b >= 1024)       return Math.round(b / 1024) + ' KB';
    return b + ' B';
}

$('f_poster').addEventListener('input', updatePosterHint);
$('e_url').addEventListener('input', updateEpUrlHint);

loadList();
</script>
</body>
</html>
