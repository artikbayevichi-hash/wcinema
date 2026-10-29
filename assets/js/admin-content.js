/* ============================================================================
   admin-content.js — Kontent va qismlar moduli (v2)
   ----------------------------------------------------------------------------
   admin-panel.js ichidan chaqiriladi: window.ADM_MODULES.content(core)
   Qaytaradi: { content: <ro'yxat>, edit: <tahrirlash> }
   Modul yuklanmasa, panel eski ro'yxat/tahrirlash ko'rinishiga qaytadi.
   ========================================================================== */
window.ADM_MODULES = window.ADM_MODULES || {};
window.ADM_MODULES.content = function (C) {
    'use strict';

    var $ = C.$, $$ = C.$$, esc = C.esc, num = C.num;
    var post = C.post, api = C.api, toast = C.toast;
    var API = '/api/content-admin.php';

    var STATUS = { published: 'Ochiq', draft: 'Qoralama', archived: 'Arxiv' };
    var GENRES = ['Jangari', 'Sarguzasht', 'Komediya', 'Drama', 'Fantastika', 'Fentezi', 'Romantika',
        'Qo‘rqinchli', 'Triller', 'Detektiv', 'Maktab', 'Sport', 'Mekha', 'Isekai', 'Shounen',
        'Seinen', 'Kundalik hayot', 'Tarixiy', 'Multfilm', 'Oilaviy'];
    var L = { q: '', cat: '', status: '', type: '', sort: 'new', page: 1, per: 20, sel: {} };

    function img(u) {
        u = String(u || '');
        if (/^https?:\/\/(t\.me|telegram\.me)\//i.test(u)) return '';
        if (/^https?:\/\//i.test(u)) return u;
        if (/^uploads\//.test(u)) return C.BASE + '/' + u;
        return '';
    }
    function qs(o) {
        return Object.keys(o).filter(function (k) { return o[k] !== '' && o[k] != null; })
            .map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&');
    }
    function opts(list, cur, valKey, txtKey) {
        return list.map(function (x) {
            var v = valKey ? x[valKey] : x, t = txtKey ? x[txtKey] : x;
            return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(t) + '</option>';
        }).join('');
    }
    function debounce(fn, ms) {
        var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); };
    }
    function done(r, okMsg, after) {
        if (r && r.success) { toast(okMsg || r.message || 'Tayyor'); if (after) after(r); }
        else toast((r && r.message) || 'Xatolik', 'err');
    }

    /* ============================== RO'YXAT ============================== */
    var CATS = [];

    function viewContent() {
        C.setTitle('Kontent', 'Film, serial, anime');
        C.render(
            '<div class="cx-chips" id="cxChips"></div>'
            + '<div class="toolbar cx-tools">'
            + '<input type="search" id="cq" placeholder="Nomi yoki ID bo‘yicha qidirish…" value="' + esc(L.q) + '">'
            + '<select id="ccat" class="btn ghost"></select>'
            + '<select id="ctype" class="btn ghost">'
            + '<option value="">Barcha turlar</option><option value="0">Kino / multfilm</option><option value="1">Serial / anime</option></select>'
            + '<select id="csort" class="btn ghost"></select>'
            + '<a class="btn" href="#/edit/new">+ Yangi</a></div>'
            + '<div class="cx-bulk" id="cxBulk" hidden></div>'
            + '<div id="clist"><div class="empty">Yuklanmoqda…</div></div>'
        );
        $('#csort').innerHTML = [['new', 'Yangilari'], ['old', 'Eskilari'], ['views', 'Ko‘p ko‘rilgan'], ['rating', 'Yuqori baho'], ['title', 'Nomi A–Z']]
            .map(function (p) { return '<option value="' + p[0] + '"' + (L.sort === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('');
        $('#ctype').value = L.type;

        $('#cq').addEventListener('input', debounce(function () { L.q = this.value; L.page = 1; load(); }, 250));
        $('#ccat').onchange = function () { L.cat = this.value; L.page = 1; load(); };
        $('#ctype').onchange = function () { L.type = this.value; L.page = 1; load(); };
        $('#csort').onchange = function () { L.sort = this.value; L.page = 1; load(); };
        load();
    }

    function load() {
        api(API + '?list=1&' + qs({ page: L.page, per: L.per, q: L.q.trim(), category_id: L.cat, status: L.status, is_series: L.type, sort: L.sort }))
            .then(function (d) {
                if (!d || !d.success) { $('#clist').innerHTML = '<div class="empty">Xatolik: ' + esc(d && d.message) + '</div>'; return; }
                CATS = d.categories || [];
                C.S.cats = CATS;
                var cc = $('#ccat');
                if (cc) cc.innerHTML = '<option value="">Barcha kategoriyalar</option>' + opts(CATS, L.cat, 'id', 'name');
                drawChips(d.counts || {});
                drawList(d);
            });
    }

    function drawChips(c) {
        var all = (c.published || 0) + (c.draft || 0) + (c.archived || 0);
        var items = [['', 'Hammasi', all], ['published', 'Ochiq', c.published || 0], ['draft', 'Qoralama', c.draft || 0], ['archived', 'Arxiv', c.archived || 0]];
        $('#cxChips').innerHTML = items.map(function (x) {
            return '<button type="button" class="cx-chip' + (L.status === x[0] ? ' on' : '') + '" data-st="' + x[0] + '">' + x[1] + ' <b>' + num(x[2]) + '</b></button>';
        }).join('');
        $$('#cxChips [data-st]').forEach(function (b) {
            b.onclick = function () { L.status = b.getAttribute('data-st'); L.page = 1; load(); };
        });
    }

    function drawBulk() {
        var ids = Object.keys(L.sel), bar = $('#cxBulk');
        if (!bar) return;
        bar.hidden = !ids.length;
        if (!ids.length) { bar.innerHTML = ''; return; }
        bar.innerHTML = '<b>' + ids.length + ' ta tanlandi</b>'
            + '<button class="btn sm ok" data-bs="published">Ochish</button>'
            + '<button class="btn sm ghost" data-bs="draft">Qoralama</button>'
            + '<button class="btn sm ghost" data-bs="archived">Arxivga</button>'
            + '<button class="btn sm bad" data-bdel="1">O‘chirish</button>'
            + '<button class="btn sm ghost" data-bclr="1">Bekor qilish</button>';
        $$('#cxBulk [data-bs]').forEach(function (b) {
            b.onclick = function () {
                post(API, { action: 'bulk_status', ids: ids.join(','), status: b.getAttribute('data-bs') })
                    .then(function (r) { L.sel = {}; done(r, null, load); });
            };
        });
        $('#cxBulk [data-bdel]').onclick = function () {
            if (!confirm(ids.length + ' ta kontent va ularning barcha qismlari o‘chiriladi. Qaytarib bo‘lmaydi. Davom etasizmi?')) return;
            post(API, { action: 'bulk_delete', ids: ids.join(',') }).then(function (r) { L.sel = {}; done(r, null, load); });
        };
        $('#cxBulk [data-bclr]').onclick = function () { L.sel = {}; load(); };
    }

    function drawList(d) {
        var rows = d.items || [], h = '';
        if (!rows.length) {
            $('#clist').innerHTML = '<div class="empty">Hech narsa topilmadi</div>';
            drawBulk();
            return;
        }
        h += '<div class="muted" style="margin-bottom:8px">' + num(d.total) + ' ta yozuv</div>'
            + '<div class="tbl-wrap"><table class="tbl"><thead><tr>'
            + '<th style="width:30px"><input type="checkbox" id="cxAll"></th><th>Nomi</th><th>Kategoriya</th><th>Qismlar</th><th>Ko‘rish</th><th>Holat</th><th></th></tr></thead><tbody>';
        rows.forEach(function (it) {
            var p = img(it.poster);
            h += '<tr>'
                + '<td><input type="checkbox" data-sel="' + it.id + '"' + (L.sel[it.id] ? ' checked' : '') + '></td>'
                + '<td><div class="cx-title">'
                + (p ? '<img src="' + esc(p) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '<span class="cx-noimg">' + (Number(it.is_series) ? '📺' : '🎬') + '</span>')
                + '<div><a href="#/edit/' + it.id + '">' + esc(it.title) + '</a>'
                + '<div class="muted sm">#' + it.id + ' · ' + (Number(it.is_series) ? 'Serial/anime' : 'Kino') + (it.release_year ? ' · ' + it.release_year : '')
                + (Number(it.rating) ? ' · ★ ' + Number(it.rating).toFixed(1) : '') + '</div></div></div></td>'
                + '<td class="muted">' + esc(it.category_name || '—') + '</td>'
                + '<td>' + num(it.episodes_count) + '</td>'
                + '<td class="muted">' + num(it.views) + '</td>'
                + '<td><select class="cx-st st-' + esc(it.status) + '" data-qst="' + it.id + '">'
                + ['published', 'draft', 'archived'].map(function (s) { return '<option value="' + s + '"' + (it.status === s ? ' selected' : '') + '>' + STATUS[s] + '</option>'; }).join('')
                + '</select></td>'
                + '<td class="actions"><a class="btn ghost sm" href="#/edit/' + it.id + '">Tahrir</a> '
                + '<button class="btn ghost sm" data-dup="' + it.id + '" title="Nusxa">⧉</button> '
                + '<button class="btn bad sm" data-del="' + it.id + '">✕</button></td></tr>';
        });
        h += '</tbody></table></div>';
        if (d.pages > 1) {
            h += '<div class="pager"><button class="btn ghost sm" data-pg="' + (d.page - 1) + '"' + (d.page <= 1 ? ' disabled' : '') + '>←</button>'
                + '<span class="muted">' + d.page + ' / ' + d.pages + '</span>'
                + '<button class="btn ghost sm" data-pg="' + (d.page + 1) + '"' + (d.page >= d.pages ? ' disabled' : '') + '>→</button></div>';
        }
        $('#clist').innerHTML = h;
        drawBulk();

        $('#cxAll').checked = rows.every(function (r) { return L.sel[r.id]; });
        $('#cxAll').onchange = function () {
            var on = this.checked;
            rows.forEach(function (r) { if (on) L.sel[r.id] = 1; else delete L.sel[r.id]; });
            $$('#clist [data-sel]').forEach(function (c) { c.checked = on; });
            drawBulk();
        };
        $$('#clist [data-sel]').forEach(function (c) {
            c.onchange = function () {
                var id = c.getAttribute('data-sel');
                if (c.checked) L.sel[id] = 1; else delete L.sel[id];
                drawBulk();
            };
        });
        $$('#clist [data-pg]').forEach(function (b) {
            b.onclick = function () { L.page = Number(b.getAttribute('data-pg')) || 1; load(); };
        });
        $$('#clist [data-qst]').forEach(function (s) {
            s.onchange = function () {
                post(API, { action: 'bulk_status', ids: s.getAttribute('data-qst'), status: s.value })
                    .then(function (r) { done(r, 'Holat o‘zgardi', load); });
            };
        });
        $$('#clist [data-dup]').forEach(function (b) {
            b.onclick = function () {
                var withEps = confirm('Qismlari bilan birga nusxalansinmi?\n\nOK — qismlari bilan, Bekor — faqat ma’lumotlar.');
                post(API, { action: 'duplicate_content', id: b.getAttribute('data-dup'), with_episodes: withEps ? '1' : '0' })
                    .then(function (r) { done(r, 'Nusxa yaratildi (qoralama)', function (x) { location.hash = '#/edit/' + x.id; }); });
            };
        });
        $$('#clist [data-del]').forEach(function (b) {
            b.onclick = function () {
                if (!confirm('Kontent va uning barcha qismlari o‘chiriladi. Davom etasizmi?')) return;
                post(API, { action: 'delete_content', id: b.getAttribute('data-del') }).then(function (r) { done(r, 'O‘chirildi', load); });
            };
        });
    }

    /* ============================ TAHRIRLASH ============================= */
    var E = { id: 0, item: {}, eps: [], season: 1, tab: 'main', sel: {}, health: {} };
    var T = { posts: [], before: 0, chan: '' };

    function viewEdit(arg, keep) {
        var isNew = !arg || arg === 'new';
        E.id = isNew ? 0 : Number(arg) || 0;
        E.sel = {};
        if (!keep) { E.tab = 'main'; E.health = {}; T = { posts: [], before: 0, chan: '' }; }
        C.setTitle(isNew ? 'Yangi kontent' : 'Kontent #' + E.id, 'Tahrirlash');
        C.render('<div class="empty">Yuklanmoqda…</div>');
        var p = isNew ? Promise.resolve({ success: true, item: {}, episodes: [], categories: CATS.length ? CATS : C.S.cats })
            : api(API + '?id=' + E.id);
        p.then(function (d) {
            if (!d || !d.success) { C.render('<div class="empty">Topilmadi</div>'); return; }
            E.item = d.item || {};
            E.eps = d.episodes || [];
            CATS = d.categories || CATS;
            var seasons = seasonList();
            if (seasons.indexOf(E.season) < 0) E.season = seasons[0] || 1;
            draw();
        });
    }

    function seasonList() {
        var s = {};
        E.eps.forEach(function (e) { s[Number(e.season) || 1] = 1; });
        var a = Object.keys(s).map(Number).sort(function (x, y) { return x - y; });
        return a.length ? a : [1];
    }

    function draw() {
        var isNew = !E.id;
        var h = '<div class="cx-tabs">'
            + '<button class="cx-tab' + (E.tab === 'main' ? ' on' : '') + '" data-tab="main">Asosiy</button>'
            + (isNew ? '' : '<button class="cx-tab' + (E.tab === 'eps' ? ' on' : '') + '" data-tab="eps">Qismlar <b>' + E.eps.length + '</b></button>')
            + '<span class="sp"></span><a class="btn ghost sm" href="#/content">← Ro‘yxat</a></div>'
            + (E.tab === 'main' ? mainHtml(isNew) : epsHtml());
        C.render(h);
        $$('.cx-tab').forEach(function (b) { b.onclick = function () { E.tab = b.getAttribute('data-tab'); draw(); }; });
        if (E.tab === 'main') bindMain(isNew); else bindEps();
    }

    /* ---------- asosiy forma ---------- */
    function fld(label, name, val, extra) {
        return '<div class="field"><label>' + label + '</label><input name="' + name + '" value="' + esc(val) + '" ' + (extra || '') + '></div>';
    }
    function mainHtml(isNew) {
        var it = E.item, p = img(it.poster);
        return '<div class="panel cx-fill"><h2>Avtomatik to‘ldirish</h2>'
            + '<div class="toolbar"><select id="fsrc" class="btn ghost"><option value="jikan">Anime — MyAnimeList (Jikan)</option>'
            + '<option value="tmdb-movie">Film — TMDB</option><option value="tmdb-tv">Serial — TMDB</option></select>'
            + '<input type="search" id="fq" placeholder="Nomini yozing va Enter bosing…" value="' + esc(it.title || '') + '">'
            + '<button class="btn" id="fgo" type="button">Qidirish</button></div>'
            + '<div id="fres" class="cx-res"></div></div>'
            + '<div class="panel"><h2>' + (isNew ? 'Yangi kontent' : esc(it.title)) + '</h2><form id="cform">'
            + '<div class="cx-grid"><div class="cx-main">'
            + '<div class="row2">' + fld('Sarlavha *', 'title', it.title, 'required maxlength="255"')
            + fld('Asl nomi', 'original_title', it.original_title, 'maxlength="255"') + '</div>'
            + '<div class="row3"><div class="field"><label>Kategoriya *</label><select name="category_id">' + opts(CATS, it.category_id, 'id', 'name') + '</select></div>'
            + '<div class="field"><label>Turi</label><select name="is_series">'
            + '<option value="0"' + (Number(it.is_series) === 0 ? ' selected' : '') + '>Kino / multfilm</option>'
            + '<option value="1"' + (Number(it.is_series) === 1 ? ' selected' : '') + '>Serial / anime</option></select></div>'
            + '<div class="field"><label>Holat</label><select name="status">'
            + ['published', 'draft', 'archived'].map(function (s) { return '<option value="' + s + '"' + ((it.status || 'published') === s ? ' selected' : '') + '>' + STATUS[s] + '</option>'; }).join('')
            + '</select></div></div>'
            + '<div class="row3">' + fld('Yil', 'release_year', it.release_year || '', 'type="number" min="1895" max="2100"')
            + fld('Baho (0–10)', 'rating', it.rating || '', 'type="number" step="0.1" min="0" max="10"')
            + fld('Davomiylik (daq)', 'duration', it.duration || '', 'type="number" min="0"') + '</div>'
            + '<div class="row3">' + fld('Jami qismlar', 'total_episodes', it.total_episodes || '', 'type="number" min="0"')
            + fld('Studiya', 'studio', it.studio, 'maxlength="255"') + fld('Rejissyor', 'director', it.director, 'maxlength="255"') + '</div>'
            + '<div class="row2">' + fld('Davlat', 'country', it.country, 'maxlength="100"') + fld('Til / dublyaj', 'language', it.language, 'maxlength="50"') + '</div>'
            + '<div class="field"><label>Janrlar</label><input name="genres" id="gin" value="' + esc(it.genres || '') + '" maxlength="500" placeholder="Vergul bilan: Jangari, Komediya">'
            + '<div class="cx-genres" id="gchips">' + GENRES.map(function (g) { return '<button type="button" class="cx-g" data-g="' + g + '">' + g + '</button>'; }).join('') + '</div></div>'
            + fld('Aktyorlar / ovoz aktyorlari', 'actors', it.actors, 'maxlength="2000"')
            + '<div class="field"><label>Tavsif</label><textarea name="description" maxlength="5000" rows="5">' + esc(it.description) + '</textarea></div>'
            + '</div><div class="cx-side">'
            + '<div class="field"><label>Poster</label><div class="cx-drop" id="drop">'
            + (p ? '<img id="pprev" src="' + esc(p) + '" alt="">' : '<img id="pprev" alt="" hidden>')
            + '<span id="dtxt"' + (p ? ' hidden' : '') + '>Rasmni shu yerga tashlang<br>yoki bosing (JPG/PNG/WEBP, 5 MB)</span>'
            + '<input type="file" id="pfile" accept="image/jpeg,image/png,image/webp" hidden></div>'
            + '<input name="poster" id="pin" value="' + esc(it.poster) + '" maxlength="500" placeholder="https://… yoki t.me/…" style="margin-top:8px"></div>'
            + fld('Banner havolasi', 'banner_url', it.banner_url, 'maxlength="500" placeholder="https://…"')
            + fld('Treyler (YouTube)', 'trailer_url', it.trailer_url, 'maxlength="500" placeholder="https://youtube.com/…"')
            + fld('Slug (bo‘sh = avtomatik)', 'slug', it.slug, 'maxlength="255"')
            + (isNew ? fld('Telegram havola (1-qism)', 'first_episode_url', '', 'placeholder="https://t.me/kanal/123"') : '')
            + '</div></div>'
            + '<div class="cx-actions"><button class="btn" type="submit">Saqlash</button> <a class="btn ghost" href="#/content">Bekor qilish</a></div>'
            + '</form></div>';
    }

    function setField(name, v) {
        var el = $('#cform [name="' + name + '"]');
        if (el && v !== undefined && v !== null && v !== '') el.value = v;
    }
    function applyFill(o) {
        ['title', 'original_title', 'description', 'release_year', 'rating', 'total_episodes', 'studio', 'country', 'language', 'genres', 'trailer_url', 'banner_url', 'duration', 'poster', 'is_series']
            .forEach(function (k) { setField(k, o[k]); });
        syncGenres();
        showPoster($('#pin').value);
        toast('To‘ldirildi — tekshirib, saqlang');
    }

    function bindMain(isNew) {
        /* avtomatik to‘ldirish */
        var go = function () {
            var q = $('#fq').value.trim(), src = $('#fsrc').value, box = $('#fres');
            if (!q) return;
            box.innerHTML = '<div class="muted">Qidirilmoqda…</div>';
            var finish = function (list) {
                if (!list.length) { box.innerHTML = '<div class="muted">Hech narsa topilmadi</div>'; return; }
                box.innerHTML = list.map(function (o, i) {
                    return '<button type="button" class="cx-r" data-i="' + i + '">'
                        + (o.poster ? '<img src="' + esc(o.poster) + '" alt="">' : '<span class="cx-noimg">🎬</span>')
                        + '<span><b>' + esc(o.title) + '</b><i>' + esc(o.original_title || '') + (o.release_year ? ' · ' + o.release_year : '') + (o.rating ? ' · ★ ' + o.rating : '') + '</i></span></button>';
                }).join('');
                $$('#fres [data-i]').forEach(function (b) { b.onclick = function () { applyFill(list[Number(b.getAttribute('data-i'))]); }; });
            };
            if (src === 'jikan') {
                fetch('https://api.jikan.moe/v4/anime?limit=8&q=' + encodeURIComponent(q))
                    .then(function (r) { return r.json(); })
                    .then(function (j) { finish((j.data || []).map(fromJikan)); })
                    .catch(function () { box.innerHTML = '<div class="muted">Jikan javob bermadi. Keyinroq urinib ko‘ring.</div>'; });
            } else {
                post(API, { action: 'tmdb_search', q: q, kind: src === 'tmdb-tv' ? 'tv' : 'movie' }).then(function (r) {
                    if (!r || !r.success) { box.innerHTML = '<div class="muted">' + esc((r && r.message) || 'Xatolik') + '</div>'; return; }
                    finish(r.results || []);
                });
            }
        };
        $('#fgo').onclick = go;
        $('#fq').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });

        /* janrlar */
        $('#gin').addEventListener('input', syncGenres);
        $$('#gchips [data-g]').forEach(function (b) {
            b.onclick = function () {
                var cur = genreArr(), g = b.getAttribute('data-g'), i = cur.indexOf(g);
                if (i < 0) cur.push(g); else cur.splice(i, 1);
                $('#gin').value = cur.join(', ');
                syncGenres();
            };
        });
        syncGenres();

        /* poster yuklash */
        var drop = $('#drop'), file = $('#pfile');
        drop.onclick = function () { file.click(); };
        file.onchange = function () { if (file.files[0]) upload(file.files[0]); };
        ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
        ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
        drop.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) upload(f); });
        $('#pin').addEventListener('change', function () { showPoster(this.value); });

        /* saqlash */
        $('#cform').addEventListener('submit', function (ev) {
            ev.preventDefault();
            var data = {};
            new FormData(ev.target).forEach(function (v, k) { data[k] = v; });
            data.action = isNew ? 'create_content' : 'update_content';
            if (!isNew) data.id = E.id;
            post(API, data).then(function (r) {
                done(r, isNew ? 'Yaratildi' : 'Saqlandi', function (x) {
                    if (isNew) { E.tab = 'main'; location.hash = '#/edit/' + x.id; }
                });
            });
        });
    }

    function fromJikan(a) {
        var dur = parseInt(String(a.duration || '').replace(/\D+.*$/, ''), 10) || '';
        var yr = a.year || (a.aired && a.aired.prop && a.aired.prop.from && a.aired.prop.from.year) || '';
        return {
            title: a.title_english || a.title, original_title: a.title_japanese || a.title,
            description: String(a.synopsis || '').replace(/\s*\[Written by MAL Rewrite\]\s*/i, '').trim(),
            poster: a.images && a.images.jpg && (a.images.jpg.large_image_url || a.images.jpg.image_url) || '',
            release_year: yr, rating: a.score || '', total_episodes: a.episodes || '', duration: dur,
            studio: (a.studios || []).map(function (s) { return s.name; }).join(', '),
            genres: (a.genres || []).map(function (g) { return g.name; }).join(', '),
            trailer_url: a.trailer && a.trailer.url || '', country: 'Yaponiya', language: 'Yapon',
            is_series: a.type === 'Movie' ? 0 : 1
        };
    }
    function genreArr() { return $('#gin').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
    function syncGenres() {
        var cur = genreArr();
        $$('#gchips [data-g]').forEach(function (b) { b.classList.toggle('on', cur.indexOf(b.getAttribute('data-g')) >= 0); });
    }
    function showPoster(u) {
        var p = img(u), im = $('#pprev');
        im.hidden = !p; if (p) im.src = p;
        $('#dtxt').hidden = !!p;
    }
    function upload(f) {
        if (f.size > 5 * 1024 * 1024) { toast('Rasm 5 MB dan oshmasin', 'err'); return; }
        $('#dtxt').hidden = false; $('#dtxt').textContent = 'Yuklanmoqda…';
        post(API, { action: 'upload_image', file: f }).then(function (r) {
            $('#dtxt').innerHTML = 'Rasmni shu yerga tashlang<br>yoki bosing (JPG/PNG/WEBP, 5 MB)';
            if (r && r.success) { $('#pin').value = r.url; showPoster(r.url); toast('Rasm yuklandi'); }
            else { toast((r && r.message) || 'Yuklanmadi', 'err'); showPoster($('#pin').value); }
        });
    }

    /* ---------- qismlar ---------- */
    function epForm(e, cfg) {
        e = e || {};
        var id = cfg.id;
        return '<form class="cx-eform" data-form="' + id + '">'
            + '<div class="row3">'
            + '<div class="field"><label>Fasl</label><input name="season" type="number" min="1" value="' + (e.season || E.season) + '"></div>'
            + '<div class="field"><label>Qism raqami *</label><input name="episode_number" type="number" min="1" required value="' + (e.episode_number || nextNum()) + '"></div>'
            + '<div class="field"><label>Davomiylik (daq)</label><input name="duration" type="number" min="0" value="' + (e.duration || '') + '"></div></div>'
            + '<div class="row2"><div class="field"><label>Sarlavha</label><input name="title" maxlength="255" value="' + esc(e.id ? e.title : '') + '" placeholder="Bo‘sh = “Qism N”"></div>'
            + '<div class="field"><label>Manba turi</label><select name="video_type">' + opts(['direct', 'embed', 'file', 'hls', 'none'], e.video_type || 'direct') + '</select></div></div>'
            + '<div class="field"><label>Video havola *</label><input name="video_url" maxlength="1000" value="' + esc(e.video_url) + '" placeholder="https://t.me/kanal/123 yoki URL"></div>'
            + '<div class="row2"><div class="field"><label>720p havola</label><input name="video_url_720p" maxlength="1000" value="' + esc(e.video_url_720p) + '"></div>'
            + '<div class="field"><label>1080p havola</label><input name="video_url_1080p" maxlength="1000" value="' + esc(e.video_url_1080p) + '"></div></div>'
            + '<div class="row3"><div class="field"><label>Subtitr (.vtt/.srt)</label><input name="subtitle_url" maxlength="500" value="' + esc(e.subtitle_url) + '"></div>'
            + '<div class="field"><label>Ovoz tili</label><input name="audio_lang" maxlength="30" value="' + esc(e.audio_lang) + '" placeholder="O‘zbek / Yapon"></div>'
            + '<div class="field"><label>Thumbnail</label><input name="thumbnail" maxlength="500" value="' + esc(e.thumbnail) + '"></div></div>'
            + '<label class="check"><input type="checkbox" name="is_premium" value="1"' + (Number(e.is_premium) ? ' checked' : '') + '> Premium (pullik) qism</label>'
            + '<div class="cx-actions"><button class="btn ok" type="submit">' + cfg.btn + '</button>'
            + (cfg.cancel ? ' <button class="btn ghost" type="button" data-cancel="' + id + '">Bekor</button>' : '') + '</div></form>';
    }
    function nextNum() {
        var m = 0;
        E.eps.forEach(function (e) { if ((Number(e.season) || 1) === E.season) m = Math.max(m, Number(e.episode_number) || 0); });
        return m + 1;
    }

    function epsHtml() {
        var seasons = seasonList();
        if (seasons.indexOf(E.season) < 0) seasons.push(E.season);
        var list = E.eps.filter(function (e) { return (Number(e.season) || 1) === E.season; })
            .sort(function (a, b) { return a.episode_number - b.episode_number; });
        var selN = Object.keys(E.sel).length;
        var h = '<div class="panel"><div class="cx-seasons">'
            + seasons.map(function (s) { return '<button class="cx-chip' + (s === E.season ? ' on' : '') + '" data-season="' + s + '">' + s + '-fasl</button>'; }).join('')
            + '<button class="cx-chip" id="newSeason">+ Yangi fasl</button><span class="sp"></span>'
            + '<button class="btn ghost sm" id="chkBtn">🩺 Havolalarni tekshirish</button>'
            + '<span class="muted sm">Tartiblash: qatorni sudrang ⠿</span></div><div id="chkBox">' + summaryHtml() + '</div>';
        if (selN) h += '<div class="cx-bulk"><b>' + selN + ' ta tanlandi</b><button class="btn sm bad" id="epBulkDel">O‘chirish</button></div>';
        h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:26px"></th><th style="width:30px"><input type="checkbox" id="epAll"></th><th>№</th><th>Sarlavha</th><th>Manba</th><th>Sifat</th><th>Davomiylik</th><th>Holat</th><th></th></tr></thead><tbody id="epBody">';
        if (!list.length) h += '<tr><td colspan="9" class="empty">Bu faslda qismlar yo‘q</td></tr>';
        list.forEach(function (e) {
            var q = [e.video_url_720p ? '720p' : '', e.video_url_1080p ? '1080p' : ''].filter(Boolean).join(' · ');
            h += '<tr draggable="true" data-eid="' + e.id + '">'
                + '<td class="cx-grip">⠿</td>'
                + '<td><input type="checkbox" data-esel="' + e.id + '"' + (E.sel[e.id] ? ' checked' : '') + '></td>'
                + '<td><b>' + e.episode_number + '</b></td>'
                + '<td>' + esc(e.title) + (Number(e.is_premium) ? ' <span class="badge warn">premium</span>' : '') + '</td>'
                + '<td class="muted cx-src">' + esc(e.video_type) + ' · ' + esc(e.video_url || '—') + '</td>'
                + '<td class="muted">' + (q || '—') + '</td>'
                + '<td class="muted">' + (e.duration ? e.duration + ' daq' : '—') + '</td>'
                + '<td data-h="' + e.id + '">' + healthCell(e.id) + '</td>'
                + '<td class="actions"><button class="btn ghost sm" data-play="' + e.id + '" title="Oldindan ko‘rish">▶</button> '
                + '<button class="btn ghost sm" data-eedit="' + e.id + '">Tahrir</button> '
                + '<button class="btn bad sm" data-edel="' + e.id + '">✕</button></td></tr>'
                + '<tr class="cx-editrow" data-erow="' + e.id + '" hidden><td colspan="9">'
                + epForm(e, { id: e.id, btn: 'Saqlash', cancel: true }) + '</td></tr>';
        });
        h += '</tbody></table></div></div>'
            + '<div class="panel"><div class="cx-seasons"><h2 style="margin:0">Qism qo‘shish</h2><span class="sp"></span>'
            + '<button class="cx-chip on" data-mode="one">Bitta</button><button class="cx-chip" data-mode="bulk">Ommaviy</button><button class="cx-chip" data-mode="tg">✈ Telegramdan import</button></div>'
            + '<div id="addOne">' + epForm(null, { id: 'new', btn: '+ Qism qo‘shish' }) + '</div>'
            + tgHtml()
            + '<form id="addBulk" hidden>'
            + '<div class="row3"><div class="field"><label>Fasl</label><input name="season" type="number" min="1" value="' + E.season + '"></div>'
            + '<div class="field"><label>Boshlanish raqami</label><input name="start" type="number" min="1" value="' + nextNum() + '"></div>'
            + '<div class="field"><label>Davomiylik (daq)</label><input name="duration" type="number" min="0"></div></div>'
            + '<div class="field"><label>Havolalar — har qatorda bitta (ixtiyoriy: <code>havola | sarlavha</code>)</label>'
            + '<textarea name="urls" rows="8" placeholder="https://t.me/kanal/101&#10;https://t.me/kanal/102&#10;https://t.me/kanal/103 | Final"></textarea></div>'
            + '<div class="row2"><div class="field"><label>Manba turi</label><select name="video_type">' + opts(['direct', 'embed', 'file', 'hls'], 'direct') + '</select></div>'
            + '<label class="check" style="align-self:end"><input type="checkbox" name="is_premium" value="1"> Hammasi premium</label></div>'
            + '<div class="muted sm" id="bcount" style="margin-bottom:8px"></div>'
            + '<button class="btn ok" type="submit">Ommaviy qo‘shish</button></form></div>';
        return h;
    }

    function readForm(f) {
        var d = {};
        new FormData(f).forEach(function (v, k) { d[k] = v; });
        if (!d.is_premium) d.is_premium = '0';
        return d;
    }
    function reload() { viewEdit(String(E.id), true); }

    function bindEps() {
        bindExtra();
        $$('[data-season]').forEach(function (b) { b.onclick = function () { E.season = Number(b.getAttribute('data-season')); E.sel = {}; draw(); }; });
        $('#newSeason').onclick = function () { E.season = Math.max.apply(null, seasonList()) + 1; E.sel = {}; draw(); };

        $$('[data-esel]').forEach(function (c) {
            c.onchange = function () { var id = c.getAttribute('data-esel'); if (c.checked) E.sel[id] = 1; else delete E.sel[id]; draw(); };
        });
        var all = $('#epAll');
        if (all) all.onchange = function () {
            var on = this.checked;
            E.eps.forEach(function (e) { if ((Number(e.season) || 1) === E.season) { if (on) E.sel[e.id] = 1; else delete E.sel[e.id]; } });
            draw();
        };
        var bd = $('#epBulkDel');
        if (bd) bd.onclick = function () {
            var ids = Object.keys(E.sel);
            if (!confirm(ids.length + ' ta qism o‘chiriladi. Davom etasizmi?')) return;
            post(API, { action: 'bulk_delete_episodes', ids: ids.join(',') }).then(function (r) { done(r, null, function () { E.sel = {}; reload(true); }); });
        };

        $$('[data-eedit]').forEach(function (b) {
            b.onclick = function () { var r = $('[data-erow="' + b.getAttribute('data-eedit') + '"]'); r.hidden = !r.hidden; };
        });
        $$('[data-cancel]').forEach(function (b) {
            b.onclick = function () { $('[data-erow="' + b.getAttribute('data-cancel') + '"]').hidden = true; };
        });
        $$('[data-edel]').forEach(function (b) {
            b.onclick = function () {
                if (!confirm('Qism o‘chirilsinmi?')) return;
                post(API, { action: 'delete_episode', id: b.getAttribute('data-edel') }).then(function (r) { done(r, 'O‘chirildi', function () { reload(true); }); });
            };
        });

        $$('form.cx-eform').forEach(function (f) {
            f.addEventListener('submit', function (ev) {
                ev.preventDefault();
                var d = readForm(f), id = f.getAttribute('data-form');
                if (id === 'new') { d.action = 'add_episode'; d.content_id = E.id; }
                else { d.action = 'update_episode'; d.id = id; }
                post(API, d).then(function (r) {
                    done(r, id === 'new' ? 'Qism qo‘shildi' : 'Saqlandi', function () { E.season = Number(d.season) || E.season; reload(true); });
                    if (r && r.success && r.tg && r.tg.has_video === false) toast('Diqqat: Telegram postda video topilmadi', 'err');
                });
            });
        });

        /* qo‘shish rejimi */
        $$('[data-mode]').forEach(function (b) {
            b.onclick = function () {
                                $$('[data-mode]').forEach(function (x) { x.classList.toggle('on', x === b); });
                var m = b.getAttribute('data-mode');
                $('#addOne').hidden = m !== 'one'; $('#addBulk').hidden = m !== 'bulk'; $('#addTg').hidden = m !== 'tg';
            };
        });
        var ta = $('#addBulk [name="urls"]');
        ta.addEventListener('input', function () {
            var n = ta.value.split(/\n/).filter(function (x) { return x.trim(); }).length;
            $('#bcount').textContent = n ? n + ' ta qism qo‘shiladi' : '';
        });
        $('#addBulk').addEventListener('submit', function (ev) {
            ev.preventDefault();
            var d = readForm(ev.target); d.action = 'bulk_episodes'; d.content_id = E.id;
            post(API, d).then(function (r) { done(r, null, function () { E.season = Number(d.season) || E.season; reload(true); }); });
        });

        /* sudrab tartiblash */
        var body = $('#epBody'), dragEl = null;
        if (!body) return;
        $$('tr[data-eid]', body).forEach(function (tr) {
            tr.addEventListener('dragstart', function (e) { dragEl = tr; tr.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', tr.getAttribute('data-eid')); } catch (x) {} });
            tr.addEventListener('dragend', function () {
                tr.classList.remove('drag'); dragEl = null;
                var order = $$('tr[data-eid]', body).map(function (r) { return r.getAttribute('data-eid'); });
                post(API, { action: 'reorder_episodes', content_id: E.id, season: E.season, order: order.join(',') })
                    .then(function (r) { done(r, 'Tartib saqlandi', function () { reload(true); }); });
            });
            tr.addEventListener('dragover', function (e) {
                e.preventDefault();
                if (!dragEl || dragEl === tr) return;
                var box = tr.getBoundingClientRect(), after = (e.clientY - box.top) > box.height / 2;
                var edit = $('[data-erow="' + tr.getAttribute('data-eid') + '"]');
                var dragEdit = $('[data-erow="' + dragEl.getAttribute('data-eid') + '"]');
                var ref = after ? (edit ? edit.nextSibling : tr.nextSibling) : tr;
                body.insertBefore(dragEl, ref);
                if (dragEdit) body.insertBefore(dragEdit, dragEl.nextSibling);
            });
        });
    }


    /* ---------- havolalar sog'ligi ---------- */
    var HL = { ok: 'Ishlayapti', warn: 'Shubhali', bad: 'Buzilgan' };
    function healthCell(id) {
        var h = E.health[id];
        if (!h) return '<span class="muted">—</span>';
        return '<span class="cx-dot ' + h.state + '"></span><span class="muted sm" title="' + esc(h.note) + '">' + esc(h.note) + '</span>';
    }
    function summaryHtml() {
        var ids = Object.keys(E.health);
        if (!ids.length) return '';
        var c = { ok: 0, warn: 0, bad: 0 };
        ids.forEach(function (i) { c[E.health[i].state]++; });
        return '<div class="cx-sum"><span><span class="cx-dot ok"></span>' + c.ok + ' ishlayapti</span>'
            + '<span><span class="cx-dot warn"></span>' + c.warn + ' shubhali</span>'
            + '<span><span class="cx-dot bad"></span>' + c.bad + ' buzilgan</span>'
            + (c.bad ? '<button class="btn bad sm" id="selBad">Buzilganlarni tanlash</button>' : '') + '</div>';
    }
    function runCheck() {
        var btn = $('#chkBtn'), box = $('#chkBox'), off = 0;
        btn.disabled = true; E.health = {};
        $$('[data-h]').forEach(function (td) { td.innerHTML = '<span class="muted">…</span>'; });
        box.innerHTML = '<div class="cx-prog"><i id="chkBar"></i></div><div class="muted sm" id="chkTxt">Tekshirilmoqda…</div>';
        (function step() {
            post(API, { action: 'check_links', content_id: E.id, offset: off }).then(function (r) {
                if (!r || !r.success) { toast((r && r.message) || 'Tekshirib bo‘lmadi', 'err'); btn.disabled = false; return; }
                (r.results || []).forEach(function (x) {
                    E.health[x.id] = x;
                    var td = $('[data-h="' + x.id + '"]'); if (td) td.innerHTML = healthCell(x.id);
                });
                off = r.next;
                var bar = $('#chkBar'); if (bar) bar.style.width = Math.min(100, Math.round(off / Math.max(1, r.total) * 100)) + '%';
                var tx = $('#chkTxt'); if (tx) tx.textContent = Math.min(off, r.total) + ' / ' + r.total + ' tekshirildi';
                if (r.done || !(r.results || []).length) { toast('Tekshiruv tugadi'); draw(); } else step();
            });
        })();
    }

    /* ---------- oldindan ko'rish ---------- */
    function openPreview(id) {
        var list = E.eps.filter(function (e) { return (Number(e.season) || 1) === E.season; })
            .sort(function (a, b) { return a.episode_number - b.episode_number; });
        var idx = list.findIndex(function (e) { return String(e.id) === String(id); });
        if (idx < 0) return;
        var q = 'auto', hls = null;
        var ov = document.createElement('div');
        ov.className = 'cx-modal';
        document.body.appendChild(ov);

        function close() {
            if (hls) { try { hls.destroy(); } catch (x) {} }
            document.removeEventListener('keydown', onKey); ov.remove();
        }
        function onKey(e) {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowRight' && idx < list.length - 1) { idx++; q = 'auto'; show(); }
            else if (e.key === 'ArrowLeft' && idx > 0) { idx--; q = 'auto'; show(); }
        }
        function pick(e) { return (q === '1080' && e.video_url_1080p) || (q === '720' && e.video_url_720p) || e.video_url || ''; }
        function stage(e) {
            var url = pick(e), st = $('#pvStage', ov);
            if (hls) { try { hls.destroy(); } catch (x) {} hls = null; }
            var m = /^https?:\/\/(?:www\.)?t\.me\/(?:s\/)?([A-Za-z0-9_]+)\/(\d+)/i.exec(url);
            if (e.video_type === 'none' || !url) { st.innerHTML = '<div class="cx-msg">Bu qismda video manbasi yo‘q</div>'; return; }
            if (m) {
                st.innerHTML = '<iframe src="https://t.me/' + m[1] + '/' + m[2] + '?embed=1&mode=tme" allowfullscreen loading="lazy"></iframe>';
                return;
            }
            if (e.video_type === 'embed') {
                if (!/^https:\/\//i.test(url)) { st.innerHTML = '<div class="cx-msg">Faqat https embed qo‘llab-quvvatlanadi</div>'; return; }
                st.innerHTML = '<iframe src="' + esc(url) + '" allow="autoplay; fullscreen" allowfullscreen referrerpolicy="no-referrer"></iframe>';
                return;
            }
            var src = /^uploads\//.test(url) ? C.BASE + '/' + url : url;
            st.innerHTML = '<video controls autoplay playsinline></video>';
            var v = $('video', st);
            v.onerror = function () { st.insertAdjacentHTML('beforeend', '<div class="cx-msg" style="background:rgba(0,0,0,.8)">Video ochilmadi. Havola buzilgan yoki brauzer formatni qo‘llamaydi.</div>'); };
            if (e.video_type === 'hls' || /\.m3u8(\?|$)/i.test(src)) {
                if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = src; return; }
                var go = function () { if (window.Hls && Hls.isSupported()) { hls = new Hls(); hls.loadSource(src); hls.attachMedia(v); } else v.onerror(); };
                if (window.Hls) go();
                else { var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js'; sc.onload = go; sc.onerror = v.onerror; document.head.appendChild(sc); }
            } else v.src = src;
        }
        function show() {
            var e = list[idx];
            var qs = [['auto', 'Asosiy']].concat(e.video_url_720p ? [['720', '720p']] : [], e.video_url_1080p ? [['1080', '1080p']] : []);
            ov.innerHTML = '<div class="cx-pv"><div class="cx-pv-h"><b>' + e.episode_number + '-qism' + (e.title ? ' · ' + esc(e.title) : '') + '</b>'
                + (qs.length > 1 ? qs.map(function (x) { return '<button class="cx-chip' + (x[0] === q ? ' on' : '') + '" data-q="' + x[0] + '">' + x[1] + '</button>'; }).join('') : '')
                + '<button class="btn ghost sm" id="pvX">✕ Yopish</button></div>'
                + '<div class="cx-stage" id="pvStage"></div>'
                + '<div class="cx-pv-f"><button class="btn ghost sm" id="pvP"' + (idx <= 0 ? ' disabled' : '') + '>← Oldingi</button>'
                + '<button class="btn ghost sm" id="pvN"' + (idx >= list.length - 1 ? ' disabled' : '') + '>Keyingi →</button><span class="sp"></span>'
                + '<span class="muted sm">← → tugmalari bilan almashtiring · Esc — yopish</span>'
                + (/^https?:\/\//i.test(e.video_url || '') ? '<a class="btn ghost sm" target="_blank" rel="noopener noreferrer" href="' + esc(e.video_url) + '">Havolani ochish ↗</a>' : '')
                + '</div></div>';
            $('#pvX', ov).onclick = close;
            $('#pvP', ov).onclick = function () { idx--; q = 'auto'; show(); };
            $('#pvN', ov).onclick = function () { idx++; q = 'auto'; show(); };
            $$('[data-q]', ov).forEach(function (b) { b.onclick = function () { q = b.getAttribute('data-q'); show(); }; });
            stage(e);
        }
        ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
        document.addEventListener('keydown', onKey);
        show();
    }

    /* ---------- Telegram kanaldan import ---------- */
    function tgHtml() {
        return '<div id="addTg" hidden>'
            + '<div class="cx-hint">Ommaviy Telegram kanal postlarini o‘qiydi (<code>t.me/s/kanal</code>). Videoli postlar avtomatik belgilanadi, qismlar ketma-ket raqamlanadi.</div>'
            + '<div class="toolbar"><input type="search" id="tgCh" placeholder="@kanal yoki https://t.me/kanal" value="' + esc(T.chan) + '">'
            + '<button class="btn" id="tgScan" type="button">Skanerlash</button></div>'
            + '<div id="tgOut"></div></div>';
    }
    function usedUrls() { var u = {}; E.eps.forEach(function (e) { if (e.video_url) u[e.video_url] = 1; }); return u; }
    function tgDraw() {
        var out = $('#tgOut'); if (!out) return;
        if (!T.posts.length) { out.innerHTML = ''; return; }
        var used = usedUrls(), onlyVid = $('#tgOnly') ? $('#tgOnly').checked : true;
        var rows = T.posts.filter(function (p) { return !onlyVid || p.has_video; });
        var h = '<div class="row3" style="margin-top:10px"><div class="field"><label>Fasl</label><input id="tgSeason" type="number" min="1" value="' + E.season + '"></div>'
            + '<div class="field"><label>Boshlanish raqami</label><input id="tgStart" type="number" min="1" value="' + nextNum() + '"></div>'
            + '<label class="check" style="align-self:end"><input type="checkbox" id="tgOnly"' + (onlyVid ? ' checked' : '') + '> Faqat videoli postlar</label></div>'
            + '<div class="cx-tg"><table class="tbl"><thead><tr><th style="width:30px"><input type="checkbox" id="tgAll"></th><th>Post</th><th>Sarlavha</th><th>Davomiylik</th><th>Sana</th></tr></thead><tbody>';
        rows.forEach(function (p) {
            var dup = !!used[p.url];
            h += '<tr class="' + (p.has_video ? '' : 'novid') + '"><td><input type="checkbox" data-tp="' + p.id + '"' + (p.has_video && !dup ? ' checked' : '') + (dup ? ' disabled' : '') + '></td>'
                + '<td>#' + p.id + (dup ? ' <span class="badge">qo‘shilgan</span>' : '') + (p.has_video ? '' : ' <span class="muted sm">video yo‘q</span>') + '</td>'
                + '<td>' + esc(p.title || '—') + '</td><td class="muted">' + esc(p.duration || '—') + '</td><td class="muted">' + esc(p.date || '') + '</td></tr>';
        });
        h += '</tbody></table></div><div class="cx-actions"><button class="btn ok" id="tgImp" type="button">Tanlanganlarni import qilish</button>'
            + '<button class="btn ghost" id="tgMore" type="button">Eskiroq postlarni yuklash</button><span class="muted sm" id="tgCnt"></span></div>';
        out.innerHTML = h;
        var count = function () { var n = $$('#tgOut [data-tp]:checked').length; $('#tgCnt').textContent = n + ' ta tanlandi'; };
        count();
        $('#tgOnly').onchange = tgDraw;
        $('#tgAll').onchange = function () { var on = this.checked; $$('#tgOut [data-tp]:not(:disabled)').forEach(function (c) { c.checked = on; }); count(); };
        $$('#tgOut [data-tp]').forEach(function (c) { c.onchange = count; });
        $('#tgMore').onclick = function () { tgScan(true); };
        $('#tgImp').onclick = function () {
            var sel = $$('#tgOut [data-tp]:checked').map(function (c) { return Number(c.getAttribute('data-tp')); }).sort(function (a, b) { return a - b; });
            if (!sel.length) { toast('Hech narsa tanlanmagan', 'err'); return; }
            var byId = {}; T.posts.forEach(function (p) { byId[p.id] = p; });
            var lines = sel.map(function (id) {
                var t = (byId[id].title || '').replace(/[|\r\n]+/g, ' ').trim();
                return byId[id].url + (t && t.length <= 80 ? ' | ' + t : '');
            });
            this.disabled = true;
            post(API, { action: 'bulk_episodes', content_id: E.id, season: $('#tgSeason').value, start: $('#tgStart').value, video_type: 'direct', urls: lines.join('\n') })
                .then(function (r) { done(r, null, function () { E.season = Number($('#tgSeason').value) || E.season; reload(); }); $('#tgImp') && ($('#tgImp').disabled = false); });
        };
    }
    function tgScan(more) {
        var ch = $('#tgCh').value.trim(), out = $('#tgOut');
        if (!ch) return;
        if (!more) { T = { posts: [], before: 0, chan: ch }; out.innerHTML = '<div class="muted">Kanal o‘qilmoqda…</div>'; }
        post(API, { action: 'tg_scan', channel: ch, pages: 3, before: more ? T.before : 0 }).then(function (r) {
            if (!r || !r.success) { out.innerHTML = '<div class="muted">' + esc((r && r.message) || 'Xatolik') + '</div>'; return; }
            var have = {}; T.posts.forEach(function (p) { have[p.id] = 1; });
            (r.posts || []).forEach(function (p) { if (!have[p.id]) T.posts.push(p); });
            T.posts.sort(function (a, b) { return a.id - b.id; });
            T.before = r.before; T.chan = ch;
            if (!T.posts.length) out.innerHTML = '<div class="muted">Postlar topilmadi</div>'; else tgDraw();
        });
    }
    function bindExtra() {
        var cb = $('#chkBtn'); if (cb) cb.onclick = runCheck;
        var sb = $('#selBad');
        if (sb) sb.onclick = function () {
            E.sel = {};
            Object.keys(E.health).forEach(function (i) { if (E.health[i].state === 'bad') E.sel[i] = 1; });
            draw();
        };
        $$('[data-play]').forEach(function (b) { b.onclick = function () { openPreview(b.getAttribute('data-play')); }; });
        var ts = $('#tgScan'); if (ts) ts.onclick = function () { tgScan(false); };
        var tc = $('#tgCh'); if (tc) tc.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); tgScan(false); } });
        if (T.posts.length) tgDraw();
    }

    /* klaviatura: "/" — qidiruv, "n" — yangi kontent (ro'yxat sahifasida) */
    document.addEventListener('keydown', function (e) {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '') || e.ctrlKey || e.metaKey) return;
        var q = $('#cq');
        if (e.key === '/' && q) { e.preventDefault(); q.focus(); }
        else if (e.key === 'n' && q) { location.hash = '#/edit/new'; }
    });

    return { content: viewContent, edit: viewEdit };
};
