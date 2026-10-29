/* ============================================================================
   admin-panel.js — yangi admin panel (SPA, vanilla JS)
   ----------------------------------------------------------------------------
   Bo'limlar: #/dashboard  #/content  #/edit/<id|new>  #/reels  #/users
              #/notify     #/stats    #/settings        #/logs
   Barcha ma'lumotlar mavjud JSON API'lardan olinadi:
     api/content-admin.php, api/reel-moderate.php, api/admin-users.php,
     api/admin-notify.php, api/admin-settings.php, api/admin-logs.php,
     api/admin-stats.php
   ========================================================================== */
(function () {
    'use strict';

    var BASE = (window.ADM && window.ADM.base) || '';
    var $  = function (s, el) { return (el || document).querySelector(s); };
    var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function num(n) {
        return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }
    function fmtDate(s) {
        if (!s) return '—';
        return String(s).replace('T', ' ').slice(0, 16);
    }

    /* ------------------------------- API -------------------------------- */
    function api(path, opts) {
        opts = opts || {};
        opts.credentials = 'same-origin';
        return fetch(BASE + path, opts).then(function (r) {
            return r.json().catch(function () {
                return { success: false, message: 'JSON xatosi (HTTP ' + r.status + ')' };
            });
        });
    }
    function post(path, data) {
        var fd = new FormData();
        Object.keys(data || {}).forEach(function (k) {
            if (data[k] !== undefined && data[k] !== null) fd.append(k, data[k]);
        });
        return api(path, { method: 'POST', body: fd });
    }

    /* ------------------------------ toast ------------------------------- */
    var toastTimer = null;
    function toast(msg, type) {
        var old = $('.toast');
        if (old) old.remove();
        var t = document.createElement('div');
        t.className = 'toast ' + (type || 'ok');
        t.textContent = msg;
        document.body.appendChild(t);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.remove(); }, 3200);
    }

    /* ------------------------------ state ------------------------------- */
    var S = {
        cats: [],
        content: null,
        contentQuery: '',
        contentCat: '',
        contentPage: 1,
        reelsStatus: 0,
        users: { q: '', filter: 'all', page: 1 },
        editId: 0
    };

    /* ---- Kontent moduli v2 (assets/js/admin-content.js); yuklanmasa eski ko'rinish ishlaydi ---- */
    var CM = null;
    try {
        if (window.ADM_MODULES && window.ADM_MODULES.content) {
            CM = window.ADM_MODULES.content({
                BASE: BASE, $: $, $$: $$, esc: esc, num: num, api: api, post: post,
                toast: toast, render: render, setTitle: setTitle, S: S
            });
        }
    } catch (e) { CM = null; if (window.console) console.error('admin-content.js', e); }

    /* ------------------------------ router ------------------------------ */
    function route() {
        var h = (location.hash || '').replace(/^#\/?/, '');
        var parts = h.split('/');
        var view = parts[0] || 'dashboard';
        var arg = parts[1] || '';

        document.body.classList.remove('nav-open');
        $$('.nav-item').forEach(function (b) {
            b.classList.toggle('on', b.getAttribute('data-view') === view ||
                (view === 'edit' && b.getAttribute('data-view') === 'content'));
        });

        var map = {
            dashboard: viewDashboard,
            content: (CM && CM.content) || viewContent,
            edit: (CM && CM.edit) || viewEdit,
            reels: viewReels,
            users: viewUsers,
            notify: viewNotify,
            stats: viewStats,
            settings: viewSettings,
            logs: viewLogs
        };
        (map[view] || viewDashboard)(arg);
    }

    function setTitle(t, sub) {
        var h = $('.topbar h1');
        if (h) h.textContent = t;
        var s = $('.topbar .sub');
        if (s) s.textContent = sub || '';
    }

    function render(html) {
        var v = $('#view');
        if (v) v.innerHTML = html;
    }

    /* =============================== DASHBOARD =========================== */
    function viewDashboard() {
        setTitle('Boshqaruv paneli', 'Umumiy holat');
        render('<div class="empty">Yuklanmoqda…</div>');

        Promise.all([
            api('/api/admin-stats.php?days=14'),
            api('/api/admin-notify.php')
        ]).then(function (res) {
            var st = res[0] && res[0].success ? res[0] : null;
            var tot = (st && st.totals) || {};
            var cats = (st && st.days) ? st.days.length : 0;

            var html = ''
                + '<div class="cards">'
                + card(num(tot.content), 'Kontent')
                + card(num(tot.users), 'Foydalanuvchilar')
                + card(num(tot.views), 'Ko‘rishlar')
                + '<div class="stat' + ((tot.pending || 0) > 0 ? ' warn' : '') + '"><b>' + num(tot.pending) + '</b><span>Kutayotgan reels</span></div>'
                + '</div>'
                + '<div class="panel">'
                + '<h2>🎬 Tez qo‘shish — Telegram havola bilan</h2>'
                + '<p class="hint">Nom + t.me havola → film darhol katalogda.</p>'
                + '<form id="qa">'
                + '<div class="row2">'
                + '<div class="field"><label>Nomi *</label><input name="title" required maxlength="255" placeholder="Interstellar"></div>'
                + '<div class="field"><label>Kategoriya *</label><select name="category_id" id="qaCat" required></select></div>'
                + '</div>'
                + '<div class="field"><label>Telegram havola *</label><input name="first_episode_url" required placeholder="https://t.me/kanal/123"></div>'
                + '<div class="row2">'
                + '<div class="field"><label>Turi</label><select name="is_series"><option value="0">Kino / multfilm</option><option value="1">Serial / anime</option></select></div>'
                + '<div class="field"><label>Davomiyligi (daqiqa)</label><input name="first_episode_duration" type="number" min="0"></div>'
                + '</div>'
                + '<button class="btn" type="submit">Qo‘shish</button>'
                + '</form></div>'
                + '<div class="panel"><h2>Statistika — ' + cats + ' kun</h2>'
                + '<canvas class="chart" id="dashChart"></canvas></div>';

            render(html);

            // kategoriyalar
            api('/api/content-admin.php?list=1').then(function (d) {
                if (!d || !d.categories) return;
                S.cats = d.categories;
                var sel = $('#qaCat');
                if (sel) sel.innerHTML = d.categories.map(function (c) {
                    return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
                }).join('');
            });

            var f = $('#qa');
            if (f) f.addEventListener('submit', function (e) {
                e.preventDefault();
                var d = {};
                new FormData(f).forEach(function (v, k) { d[k] = v; });
                d.action = 'create_content';
                post('/api/content-admin.php', d).then(function (r) {
                    if (r && r.success) {
                        toast('Qo‘shildi (ID ' + r.id + ')');
                        location.hash = '#/edit/' + r.id;
                    } else {
                        toast((r && r.message) || 'Xatolik', 'err');
                    }
                });
            });

            if (st) drawChart($('#dashChart'), st);
        });
    }

    function card(v, label, warn) {
        return '<div class="stat' + (warn ? ' warn' : '') + '"><b>' + v + '</b><span>' + esc(label) + '</span></div>';
    }

    /* ------------------------------- chart ------------------------------- */
    function drawChart(cv, data) {
        if (!cv || !cv.getContext) return;
        var ctx = cv.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        var w = cv.clientWidth || 700, h = 180;
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        var users = data.users || [], views = data.views || [], days = data.days || [];
        var maxU = Math.max.apply(null, users.concat([1]));
        var maxV = Math.max.apply(null, views.concat([1]));
        var n = days.length || 1;
        var padL = 30, padR = 8, padT = 8, padB = 20;
        var iw = w - padL - padR, ih = h - padT - padB;
        var step = iw / n;

        var css = getComputedStyle(document.documentElement);
        var line = css.getPropertyValue('--line') || '#2c2739';
        var acc = css.getPropertyValue('--acc') || '#6a5cff';
        var ok = css.getPropertyValue('--ok') || '#46d39a';
        var dim = css.getPropertyValue('--dim') || '#9b93ad';

        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = line;
        for (var g = 0; g <= 3; g++) {
            var y = padT + ih * g / 3;
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
        }
        for (var i = 0; i < n; i++) {
            var bh = (users[i] / maxU) * ih;
            ctx.fillStyle = acc;
            ctx.globalAlpha = 0.75;
            ctx.fillRect(padL + i * step + step * 0.22, padT + ih - bh, Math.max(2, step * 0.56), bh);
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = ok;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var j = 0; j < n; j++) {
            var vx = padL + j * step + step / 2;
            var vy = padT + ih - (views[j] / maxV) * ih;
            if (j === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
        }
        ctx.stroke();

        ctx.fillStyle = dim;
        ctx.font = '10px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center';
        for (var t = 0; t < n; t += 3) {
            ctx.fillText((days[t] || '').slice(5), padL + t * step + step / 2, h - 5);
        }
    }

    /* =============================== CONTENT ============================= */
    function viewContent() {
        setTitle('Kontent', 'Film, serial, anime');
        render('<div class="empty">Yuklanmoqda…</div>');

        api('/api/content-admin.php?list=1').then(function (d) {
            if (!d || !d.success) { render('<div class="empty">Xatolik</div>'); return; }
            S.content = d;
            S.cats = d.categories || [];

            var html = ''
                + '<div class="toolbar">'
                + '<input type="search" id="cq" placeholder="Nomi yoki ID bo‘yicha qidirish…" value="' + esc(S.contentQuery) + '">'
                + '<select id="ccat" class="btn ghost" style="padding:9px 10px">'
                + '<option value="">Barcha kategoriyalar</option>'
                + S.cats.map(function (c) {
                    return '<option value="' + c.id + '"' + (String(S.contentCat) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + '</option>';
                }).join('')
                + '</select>'
                + '<a class="btn" href="#/edit/new">+ Yangi</a>'
                + '</div>'
                + '<div id="clist"></div>';
            render(html);

            $('#cq').addEventListener('input', function () {
                S.contentQuery = this.value;
                S.contentPage = 1;
                renderContentList();
            });
            $('#ccat').addEventListener('change', function () {
                S.contentCat = this.value;
                S.contentPage = 1;
                renderContentList();
            });

            renderContentList();
        });
    }

    function renderContentList() {
        var d = S.content;
        if (!d) return;
        var q = S.contentQuery.toLowerCase().trim();
        var cat = String(S.contentCat || '');

        var rows = (d.items || []).filter(function (it) {
            if (cat && String(it.category_id) !== cat) return false;
            if (!q) return true;
            return String(it.title || '').toLowerCase().indexOf(q) !== -1
                || String(it.id) === q;
        });

        var per = 20;
        var pages = Math.max(1, Math.ceil(rows.length / per));
        if (S.contentPage > pages) S.contentPage = pages;
        var page = rows.slice((S.contentPage - 1) * per, S.contentPage * per);

        var html = '<div class="muted" style="margin-bottom:8px">' + rows.length + ' ta yozuv</div>';
        if (!page.length) {
            html += '<div class="empty">Hech narsa topilmadi</div>';
        } else {
            html += '<div class="tbl-wrap"><table class="tbl"><thead><tr>'
                + '<th>ID</th><th>Nomi</th><th>Kategoriya</th><th>Qismlar</th><th>Ko‘rish</th><th>Holat</th><th></th>'
                + '</tr></thead><tbody>';
            page.forEach(function (it) {
                html += '<tr>'
                    + '<td class="muted">#' + it.id + '</td>'
                    + '<td><a href="#/edit/' + it.id + '">' + esc(it.title) + '</a></td>'
                    + '<td class="muted">' + esc(it.category_name || '—') + '</td>'
                    + '<td>' + num(it.episodes_count) + '</td>'
                    + '<td class="muted">' + num(it.views) + '</td>'
                    + '<td>' + (it.status === 'published'
                        ? '<span class="badge ok">ochiq</span>'
                        : '<span class="badge dim">' + esc(it.status) + '</span>') + '</td>'
                    + '<td class="actions">'
                    + '<a class="btn ghost sm" href="#/edit/' + it.id + '">Tahrir</a> '
                    + '<button class="btn bad sm" data-del="' + it.id + '">O‘chirish</button>'
                    + '</td></tr>';
            });
            html += '</tbody></table></div>';

            if (pages > 1) {
                html += '<div class="pager">'
                    + '<button class="btn ghost sm" data-pg="' + (S.contentPage - 1) + '"' + (S.contentPage <= 1 ? ' disabled' : '') + '>←</button>'
                    + '<span class="muted">' + S.contentPage + ' / ' + pages + '</span>'
                    + '<button class="btn ghost sm" data-pg="' + (S.contentPage + 1) + '"' + (S.contentPage >= pages ? ' disabled' : '') + '>→</button>'
                    + '</div>';
            }
        }
        $('#clist').innerHTML = html;

        $$('#clist [data-pg]').forEach(function (b) {
            b.onclick = function () {
                S.contentPage = Number(b.getAttribute('data-pg')) || 1;
                renderContentList();
            };
        });
        $$('#clist [data-del]').forEach(function (b) {
            b.onclick = function () {
                var id = b.getAttribute('data-del');
                if (!confirm('Kontent va uning barcha qismlari o‘chiriladi. Davom etasizmi?')) return;
                post('/api/content-admin.php', { action: 'delete_content', id: id }).then(function (r) {
                    if (r && r.success) {
                        toast('O‘chirildi');
                        viewContent();
                    } else {
                        toast((r && r.message) || 'Xatolik', 'err');
                    }
                });
            };
        });
    }

    /* ============================== EDIT FORM ============================ */
    function viewEdit(arg) {
        var isNew = !arg || arg === 'new';
        var id = isNew ? 0 : Number(arg) || 0;
        S.editId = id;

        setTitle(isNew ? 'Yangi kontent' : 'Kontent #' + id, 'Tahrirlash');
        render('<div class="empty">Yuklanmoqda…</div>');

        var load = isNew
            ? Promise.resolve({ success: true, item: {}, episodes: [], categories: S.cats })
            : api('/api/content-admin.php?id=' + id);

        load.then(function (d) {
            if (!d || !d.success) { render('<div class="empty">Topilmadi</div>'); return; }
            var it = d.item || {};
            var eps = d.episodes || [];
            S.cats = d.categories || S.cats;

            var html = '<div class="panel"><h2>' + (isNew ? 'Yangi kontent' : esc(it.title)) + '</h2>'
                + '<form id="cform">'
                + '<div class="row2">'
                + '<div class="field"><label>Sarlavha *</label><input name="title" required maxlength="255" value="' + esc(it.title) + '"></div>'
                + '<div class="field"><label>Kategoriya *</label><select name="category_id">'
                + S.cats.map(function (c) {
                    return '<option value="' + c.id + '"' + (Number(it.category_id) === Number(c.id) ? ' selected' : '') + '>' + esc(c.name) + '</option>';
                }).join('')
                + '</select></div></div>'
                + '<div class="row3">'
                + '<div class="field"><label>Turi</label><select name="is_series">'
                + '<option value="0"' + (Number(it.is_series) === 0 ? ' selected' : '') + '>Kino / multfilm</option>'
                + '<option value="1"' + (Number(it.is_series) === 1 ? ' selected' : '') + '>Serial / anime</option>'
                + '</select></div>'
                + '<div class="field"><label>Yil</label><input name="release_year" type="number" min="1895" max="2100" value="' + (it.release_year || '') + '"></div>'
                + '<div class="field"><label>Baho (0–10)</label><input name="rating" type="number" step="0.1" min="0" max="10" value="' + (it.rating || '') + '"></div>'
                + '</div>'
                + '<div class="row2">'
                + '<div class="field"><label>Holat</label><select name="status">'
                + ['published', 'draft', 'archived'].map(function (s) {
                    return '<option value="' + s + '"' + (it.status === s ? ' selected' : '') + '>' + s + '</option>';
                }).join('')
                + '</select></div>'
                + '<div class="field"><label>Poster / t.me havola</label><input name="poster" maxlength="500" value="' + esc(it.poster) + '" placeholder="https://… yoki t.me/kanal/1"></div>'
                + '</div>'
                + (isNew
                    ? '<div class="row2"><div class="field"><label>Telegram havola (1-qism)</label><input name="first_episode_url" placeholder="https://t.me/kanal/123"></div>'
                      + '<div class="field"><label>Davomiyligi (daqiqa)</label><input name="first_episode_duration" type="number" min="0"></div></div>'
                    : '')
                + '<div class="field"><label>Tavsif</label><textarea name="description" maxlength="5000">' + esc(it.description) + '</textarea></div>'
                + '<button class="btn" type="submit">Saqlash</button> '
                + '<a class="btn ghost" href="#/content">Bekor qilish</a>'
                + '</form></div>';

            if (!isNew) {
                html += '<div class="panel"><h2>Qismlar (' + eps.length + ')</h2>'
                    + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Fasl</th><th>Qism</th><th>Manba</th><th>Davomiylik</th><th></th></tr></thead><tbody>'
                    + (eps.length ? eps.map(function (e) {
                        return '<tr><td class="muted">' + e.id + '</td>'
                            + '<td>' + e.season + '</td>'
                            + '<td>' + e.episode_number + '</td>'
                            + '<td class="muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
                            + esc(e.video_url || '—') + '</td>'
                            + '<td class="muted">' + (e.duration ? e.duration + ' daq' : '—') + '</td>'
                            + '<td class="actions"><button class="btn bad sm" data-dep="' + e.id + '">O‘chirish</button></td></tr>';
                    }).join('') : '<tr><td colspan="6" class="empty">Qismlar yo‘q</td></tr>')
                    + '</tbody></table></div>'
                    + '<form id="eform" style="margin-top:14px">'
                    + '<div class="row3">'
                    + '<div class="field"><label>Fasl</label><input name="season" type="number" min="1" value="1"></div>'
                    + '<div class="field"><label>Qism raqami *</label><input name="episode_number" type="number" min="1" required value="' + (eps.length + 1) + '"></div>'
                    + '<div class="field"><label>Davomiylik (daqiqa)</label><input name="duration" type="number" min="0"></div>'
                    + '</div>'
                    + '<div class="field"><label>Video havola * (t.me/… yoki URL)</label><input name="video_url" required placeholder="https://t.me/kanal/123"></div>'
                    + '<button class="btn ok" type="submit">+ Qism qo‘shish</button>'
                    + '</form></div>';
            }

            render(html);

            $('#cform').addEventListener('submit', function (ev) {
                ev.preventDefault();
                var f = ev.target;
                var data = {};
                new FormData(f).forEach(function (v, k) { data[k] = v; });
                data.action = isNew ? 'create_content' : 'update_content';
                if (!isNew) data.id = id;
                post('/api/content-admin.php', data).then(function (r) {
                    if (r && r.success) {
                        toast(isNew ? 'Yaratildi' : 'Saqlandi');
                        if (isNew) location.hash = '#/edit/' + r.id;
                    } else {
                        toast((r && r.message) || 'Xatolik', 'err');
                    }
                });
            });

            if (!isNew) {
                var ef = $('#eform');
                if (ef) ef.addEventListener('submit', function (ev) {
                    ev.preventDefault();
                    var data = {};
                    new FormData(ef).forEach(function (v, k) { data[k] = v; });
                    data.action = 'add_episode';
                    data.content_id = id;
                    post('/api/content-admin.php', data).then(function (r) {
                        if (r && r.success) {
                            toast('Qism qo‘shildi');
                            viewEdit(String(id));
                        } else {
                            toast((r && r.message) || 'Xatolik', 'err');
                        }
                    });
                });
                $$('[data-dep]').forEach(function (b) {
                    b.onclick = function () {
                        if (!confirm('Qism o‘chirilsinmi?')) return;
                        post('/api/content-admin.php', { action: 'delete_episode', id: b.getAttribute('data-dep') })
                            .then(function (r) {
                                if (r && r.success) { toast('O‘chirildi'); viewEdit(String(id)); }
                                else toast((r && r.message) || 'Xatolik', 'err');
                            });
                    };
                });
            }
        });
    }

    /* ================================ REELS ============================== */
    function viewReels() {
        setTitle('Reels moderatsiyasi', 'Tasdiqlash va rad etish');
        render('<div class="empty">Yuklanmoqda…</div>');

        api('/api/reel-moderate.php?status=' + S.reelsStatus + '&limit=60').then(function (d) {
            if (!d || !d.success) { render('<div class="empty">Xatolik</div>'); return; }
            var c = d.counts || {};
            var items = d.items || [];

            var html = '<div class="tabs">'
                + tab(0, 'Kutilmoqda', c.pending)
                + tab(1, 'Tasdiqlangan', c.approved)
                + tab(2, 'Rad etilgan', c.rejected)
                + '</div>';

            if (!items.length) {
                html += '<div class="empty">Bu bo‘limda hech narsa yo‘q</div>';
            } else {
                html += '<div class="cards">';
                items.forEach(function (r) {
                    var poster = r.poster || r.thumb || '';
                    html += '<div class="panel" style="margin:0">'
                        + (poster ? '<img src="' + esc(poster) + '" alt="" style="width:100%;height:150px;object-fit:cover;border-radius:10px;margin-bottom:10px" loading="lazy" onerror="this.remove()">' : '')
                        + '<b style="font-size:13.5px">' + esc(r.title || ('Reel #' + r.id)) + '</b>'
                        + '<div class="muted" style="font-size:12px;margin:4px 0 10px">'
                        + '#' + r.id + ' · ' + esc(r.format || r.kind || '') + ' · ' + fmtDate(r.created_at) + '</div>'
                        + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
                        + (S.reelsStatus !== 1 ? '<button class="btn ok sm" data-approve="' + r.id + '">Tasdiqlash</button>' : '')
                        + (S.reelsStatus !== 2 ? '<button class="btn ghost sm" data-reject="' + r.id + '">Rad etish</button>' : '')
                        + '<button class="btn bad sm" data-rdel="' + r.id + '">O‘chirish</button>'
                        + '</div></div>';
                });
                html += '</div>';
            }
            render(html);

            $$('.tabs button').forEach(function (b) {
                b.onclick = function () {
                    S.reelsStatus = Number(b.getAttribute('data-st'));
                    viewReels();
                };
            });
            $$('[data-approve]').forEach(function (b) {
                b.onclick = function () { moderate(b.getAttribute('data-approve'), 1); };
            });
            $$('[data-reject]').forEach(function (b) {
                b.onclick = function () {
                    var reason = prompt('Rad etish sababi:', '') || '';
                    moderate(b.getAttribute('data-reject'), 2, reason);
                };
            });
            $$('[data-rdel]').forEach(function (b) {
                b.onclick = function () {
                    if (!confirm('Butunlay o‘chirilsinmi?')) return;
                    post('/api/reel-moderate.php', { action: 'delete', id: b.getAttribute('data-rdel') })
                        .then(function (r) { toast(r && r.success ? 'O‘chirildi' : 'Xatolik', r && r.success ? 'ok' : 'err'); viewReels(); });
                };
            });
        });

        function tab(st, label, n) {
            return '<button data-st="' + st + '"' + (S.reelsStatus === st ? ' class="on"' : '') + '>'
                + esc(label) + ' (' + (n || 0) + ')</button>';
        }
        function moderate(id, status, reason) {
            post('/api/reel-moderate.php', { id: id, status: status, reason: reason || '' }).then(function (r) {
                if (r && r.success) { toast('Bajarildi'); viewReels(); }
                else toast((r && r.message) || 'Xatolik', 'err');
            });
        }
    }

    /* ================================ USERS ============================== */
    function viewUsers() {
        setTitle('Foydalanuvchilar', 'Ban · premium');
        render('<div class="empty">Yuklanmoqda…</div>');
        load();

        function load() {
            var qs = '?q=' + encodeURIComponent(S.users.q)
                + '&filter=' + encodeURIComponent(S.users.filter)
                + '&page=' + S.users.page;

            api('/api/admin-users.php' + qs).then(function (d) {
                if (!d || !d.success) { render('<div class="empty">Xatolik</div>'); return; }
                var sm = d.summary || {};

                var html = '<div class="cards">'
                    + card(num(sm.total), 'Jami')
                    + card(num(sm.premium), 'Premium')
                    + card(num(sm.banned), 'Ban', sm.banned > 0)
                    + card(num(sm.today), 'Bugun')
                    + '</div>'
                    + '<div class="toolbar">'
                    + '<input type="search" id="uq" placeholder="Ism, @username, Telegram ID…" value="' + esc(S.users.q) + '">'
                    + '<select id="uf" class="btn ghost" style="padding:9px 10px">'
                    + ['all', 'premium', 'banned'].map(function (f) {
                        return '<option value="' + f + '"' + (S.users.filter === f ? ' selected' : '') + '>'
                            + ({ all: 'Hammasi', premium: 'Premium', banned: 'Ban qilingan' })[f] + '</option>';
                    }).join('')
                    + '</select></div>'
                    + '<div id="ulist"></div>';
                render(html);

                $('#uq').addEventListener('input', function () {
                    S.users.q = this.value; S.users.page = 1;
                    clearTimeout(window.__uqT);
                    window.__uqT = setTimeout(load, 300);
                });
                $('#uf').addEventListener('change', function () {
                    S.users.filter = this.value; S.users.page = 1; load();
                });

                var list = '<div class="tbl-wrap"><table class="tbl"><thead><tr>'
                    + '<th>ID</th><th>Foydalanuvchi</th><th>Telegram</th><th>Holat</th><th>Faollik</th><th></th>'
                    + '</tr></thead><tbody>';

                (d.rows || []).forEach(function (u) {
                    list += '<tr>'
                        + '<td class="muted">#' + u.id + '</td>'
                        + '<td><b>' + esc(u.name || 'Foydalanuvchi') + '</b>'
                        + (u.username ? '<div class="muted">@' + esc(u.username) + '</div>' : '') + '</td>'
                        + '<td class="muted">' + esc(u.tg || '—') + '</td>'
                        + '<td>' + (u.premium ? '<span class="badge prem">PREMIUM</span> ' : '')
                        + (u.banned ? '<span class="badge ban" title="' + esc(u.ban_reason) + '">BAN</span>' : '')
                        + (!u.premium && !u.banned ? '<span class="badge dim">oddiy</span>' : '') + '</td>'
                        + '<td class="muted">' + fmtDate(u.last_active) + '</td>'
                        + '<td class="actions">'
                        + '<button class="btn ' + (u.premium ? 'ghost' : 'ok') + ' sm" data-prem="' + u.id + '" data-on="' + (u.premium ? 0 : 1) + '">'
                        + (u.premium ? 'Premiumni olish' : 'Premium') + '</button> '
                        + (u.banned
                            ? '<button class="btn ok sm" data-unban="' + u.id + '">Unban</button>'
                            : '<button class="btn bad sm" data-ban="' + u.id + '">Ban</button>')
                        + '</td></tr>';
                });
                list += '</tbody></table></div>';

                if (d.pages > 1) {
                    list += '<div class="pager">'
                        + '<button class="btn ghost sm" data-up="' + (d.page - 1) + '"' + (d.page <= 1 ? ' disabled' : '') + '>←</button>'
                        + '<span class="muted">' + d.page + ' / ' + d.pages + '</span>'
                        + '<button class="btn ghost sm" data-up="' + (d.page + 1) + '"' + (d.page >= d.pages ? ' disabled' : '') + '>→</button>'
                        + '</div>';
                }
                $('#ulist').innerHTML = list;

                $$('[data-up]').forEach(function (b) {
                    b.onclick = function () { S.users.page = Number(b.getAttribute('data-up')); load(); };
                });
                $$('[data-prem]').forEach(function (b) {
                    b.onclick = function () {
                        act({ action: 'premium', id: b.getAttribute('data-prem'), on: b.getAttribute('data-on') });
                    };
                });
                $$('[data-ban]').forEach(function (b) {
                    b.onclick = function () {
                        var reason = prompt('Ban sababi (ixtiyoriy):', '');
                        if (reason === null) return;
                        act({ action: 'ban', id: b.getAttribute('data-ban'), reason: reason });
                    };
                });
                $$('[data-unban]').forEach(function (b) {
                    b.onclick = function () { act({ action: 'unban', id: b.getAttribute('data-unban') }); };
                });
            });

            function act(data) {
                post('/api/admin-users.php', data).then(function (r) {
                    if (r && r.success) { toast('Bajarildi'); load(); }
                    else toast((r && r.message) || 'Xatolik', 'err');
                });
            }
        }
    }

    /* =============================== NOTIFY ============================== */
    function viewNotify() {
        setTitle('Bildirishnoma', 'Sayt + Telegram');
        render('<div class="empty">Yuklanmoqda…</div>');

        api('/api/admin-notify.php').then(function (d) {
            var c = (d && d.counts) || { all: 0, premium: 0, tg: 0 };

            render(''
                + '<div class="panel">'
                + '<div class="field"><label>Kimga</label><select id="nAud">'
                + '<option value="all">Hamma (' + c.all + ')</option>'
                + '<option value="premium">Premium (' + c.premium + ')</option>'
                + '<option value="one">Bitta foydalanuvchi</option>'
                + '</select></div>'
                + '<div class="field" id="nWhoWrap" style="display:none"><label>Foydalanuvchi (ID / @username)</label><input id="nWho" placeholder="8715394666"></div>'
                + '<div class="field"><label>Sarlavha</label><input id="nTitle" maxlength="120" placeholder="Yangi film"></div>'
                + '<div class="field"><label>Matn</label><textarea id="nMsg" maxlength="1000" placeholder="Bugun premyera…"></textarea></div>'
                + '<div class="row2">'
                + '<div class="field"><label>Havola (ixtiyoriy)</label><input id="nUrl" maxlength="500" placeholder="watch.php?c=1"></div>'
                + '<div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" id="nTg"> Telegram DM (chat ulangan: ' + c.tg + ')</label></div>'
                + '</div>'
                + '<button class="btn" id="nSend">Yuborish</button>'
                + '<div id="nRes" class="muted" style="margin-top:10px"></div>'
                + '</div>');

            $('#nAud').addEventListener('change', function () {
                $('#nWhoWrap').style.display = this.value === 'one' ? '' : 'none';
            });

            $('#nSend').onclick = function () {
                var btn = this;
                var title = $('#nTitle').value.trim();
                var msg = $('#nMsg').value.trim();
                if (!title || !msg) { toast('Sarlavha va matn kerak', 'err'); return; }

                btn.disabled = true;
                $('#nRes').textContent = 'Yuborilmoqda…';

                post('/api/admin-notify.php', {
                    audience: $('#nAud').value,
                    who: $('#nWho').value,
                    title: title,
                    message: msg,
                    url: $('#nUrl').value,
                    to_telegram: $('#nTg').checked ? 1 : ''
                }).then(function (r) {
                    btn.disabled = false;
                    if (r && r.success) {
                        $('#nRes').textContent = 'Yuborildi: ' + r.inapp + '/' + r.total
                            + (r.tg_ok || r.tg_err ? ' · Telegram: ' + r.tg_ok + ' yetdi, ' + r.tg_err + ' xato' : '');
                        toast('Yuborildi');
                    } else {
                        $('#nRes').textContent = '';
                        toast((r && r.message) || 'Xatolik', 'err');
                    }
                });
            };
        });
    }

    /* =============================== STATS =============================== */
    function viewStats() {
        setTitle('Statistika', '14 kun');
        render('<div class="empty">Yuklanmoqda…</div>');

        api('/api/admin-stats.php?days=14').then(function (d) {
            if (!d || !d.success) { render('<div class="empty">Xatolik</div>'); return; }
            var top = (d.top || []).map(function (t, i) {
                return '<tr><td class="muted">' + (i + 1) + '</td><td>' + esc(t.title) + '</td><td>' + num(t.views) + '</td></tr>';
            }).join('');

            render('<div class="panel"><canvas class="chart" id="chart2"></canvas></div>'
                + '<div class="panel"><h2>Eng ko‘p ko‘rilgan</h2>'
                + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Kontent</th><th>Ko‘rish</th></tr></thead><tbody>'
                + (top || '<tr><td colspan="3" class="empty">Ma’lumot yo‘q</td></tr>')
                + '</tbody></table></div></div>');

            drawChart($('#chart2'), d);
        });
    }

    /* ============================== SETTINGS ============================= */
    function viewSettings() {
        setTitle('Sozlamalar', 'Sayt · e’lon · texnik ish');
        render('<div class="empty">Yuklanmoqda…</div>');

        api('/api/admin-settings.php').then(function (d) {
            var s = (d && d.settings) || {};
            render('<div class="panel"><form id="sform">'
                + '<div class="field"><label>Sayt nomi</label><input name="site_name" maxlength="60" value="' + esc(s.site_name) + '" placeholder="W CINEMA"></div>'
                + '<div class="field"><label>E’lon (sayt tepasida)</label><input name="notice" maxlength="300" value="' + esc(s.notice) + '" placeholder="Yangi yil aksiyasi: 30% chegirma"></div>'
                + '<div class="row2">'
                + '<div class="field"><label>E’lon havolasi</label><input name="notice_link" maxlength="500" value="' + esc(s.notice_link) + '" placeholder="watch.php?c=1"></div>'
                + '<div class="field"><label>Banner rasm URL</label><input name="banner_url" maxlength="500" value="' + esc(s.banner_url) + '" placeholder="https://…"></div>'
                + '</div>'
                + '<label class="check" style="margin:6px 0 14px"><input type="checkbox" name="maintenance" value="1"' + (Number(s.maintenance) === 1 ? ' checked' : '') + '> Texnik ish rejimi (faqat admin ko‘radi)</label>'
                + '<button class="btn" type="submit">Saqlash</button>'
                + '</form></div>');

            $('#sform').addEventListener('submit', function (e) {
                e.preventDefault();
                var f = e.target;
                var data = {};
                new FormData(f).forEach(function (v, k) { data[k] = v; });
                data.maintenance = f.querySelector('[name=maintenance]').checked ? 1 : 0;
                post('/api/admin-settings.php', data).then(function (r) {
                    if (r && r.success) toast('Saqlandi');
                    else toast((r && r.message) || 'Xatolik', 'err');
                });
            });
        });
    }

    /* ================================ LOGS =============================== */
    function viewLogs() {
        setTitle('Loglar', 'Admin amallari');
        render('<div class="empty">Yuklanmoqda…</div>');

        api('/api/admin-logs.php?limit=150').then(function (d) {
            if (!d || !d.success) { render('<div class="empty">Xatolik</div>'); return; }
            var rows = (d.rows || []).map(function (r) {
                return '<tr><td class="muted">' + fmtDate(r.created_at) + '</td>'
                    + '<td><code>' + esc(r.action) + '</code></td>'
                    + '<td class="muted" style="max-width:420px;word-break:break-word">' + esc(r.details) + '</td>'
                    + '<td class="muted">' + esc(r.ip || '') + '</td></tr>';
            }).join('');

            render('<div class="panel"><div class="muted" style="margin-bottom:8px">Jami: ' + num(d.total) + '</div>'
                + '<div class="tbl-wrap"><table class="tbl"><thead><tr>'
                + '<th>Vaqt</th><th>Amal</th><th>Tafsilot</th><th>IP</th>'
                + '</tr></thead><tbody>'
                + (rows || '<tr><td colspan="4" class="empty">Hozircha bo‘sh</td></tr>')
                + '</tbody></table></div></div>');
        });
    }

    /* =============================== THEME =============================== */
    function applyTheme(t) {
        document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
        try { localStorage.setItem('wc_adm_theme', t); } catch (e) {}
        var b = $('#themeBtn');
        if (b) b.textContent = t === 'light' ? '🌙 Tun' : '☀️ Kun';
    }

    /* =============================== BOOT =============================== */
    function boot() {
        var t = 'dark';
        try { t = localStorage.getItem('wc_adm_theme') || 'dark'; } catch (e) {}
        applyTheme(t);

        $('#themeBtn').onclick = function () {
            var cur = document.documentElement.getAttribute('data-theme');
            applyTheme(cur === 'light' ? 'dark' : 'light');
            route();   // joriy bo'limni qayta chizamiz (grafik ranglari yangilanadi)
        };
        $('#menuBtn').onclick = function () {
            document.body.classList.toggle('nav-open');
        };
        $$('.nav-item').forEach(function (b) {
            b.onclick = function () {
                location.hash = '#/' + b.getAttribute('data-view');
            };
        });

        window.addEventListener('hashchange', route);
        route();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
