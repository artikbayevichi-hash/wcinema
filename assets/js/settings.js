/* ==========================================================================
   settings.js — Sozlamalar sahifasi
   --------------------------------------------------------------------------
   Bo'limlar:
     1) Account Privacy  — profil ochiq/maxfiy, faollik ko'rinishi
     2) Block Users       — qidirish, bloklash, blokdan chiqarish
     3) Profile Edit      — ism, familiya, username, bio, avatar

   Barchasi `api/settings.php` orqali ishlaydi (POST uchun `tg_me` yuboriladi).
   ========================================================================== */
(function () {
    'use strict';

    var API = 'api/settings.php';

    var $  = function (s) { return document.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

    var els = {
        privBadge:  $('#stPrivBadge'),
        swPrivate:  $('#stPrivate'),
        swActivity: $('#stActivity'),
        fName:      $('#stName'),
        fLast:      $('#stLast'),
        fUser:      $('#stUser'),
        fBio:       $('#stBio'),
        fAva:       $('#stAvatar'),
        bioCount:   $('#stBioCount'),
        form:       $('#stForm'),
        blockList:  $('#stBlockList'),
        blockCount: $('#stBlockCount'),
        search:     $('#stSearch'),
        searchRes:  $('#stSearchRes'),
        msg:        $('#stMsg'),
        toast:      $('#stToast'),
    };

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function meRaw() {
        try { return localStorage.getItem('wc_tg_me_v1') || ''; } catch (e) { return ''; }
    }

    function toast(msg, ok) {
        if (!els.toast) return;
        els.toast.textContent = msg;
        els.toast.classList.toggle('err', !ok);
        els.toast.hidden = false;
        clearTimeout(toast._t);
        toast._t = setTimeout(function () { els.toast.hidden = true; }, 2600);
    }

    function say(msg, kind) {
        if (!els.msg) return;
        els.msg.hidden = !msg;
        els.msg.textContent = msg || '';
        els.msg.className = 'st-msg ' + (kind || '');
    }

    /** so'rovga `tg_me` ni qo'shadi */
    function withMe(params) {
        var raw = meRaw();
        if (raw) params.set('tg_me', raw);
        return params;
    }

    function api(action, params) {
        var qs = withMe(new URLSearchParams(Object.assign({ action: action }, params || {})));
        return fetch(API + '?' + qs.toString(), {
            headers: { 'Accept': 'application/json' }
        }).then(function (r) { return r.json().catch(function () { return null; }); });
    }

    function post(action, data) {
        var body = withMe(new URLSearchParams(Object.assign({ action: action }, data || {})));
        return fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        }).then(function (r) {
            return r.json().catch(function () { return null; })
                .then(function (d) { return { status: r.status, data: d }; });
        });
    }

    // =====================================================================
    //  1) MAXFIYLIK
    // =====================================================================
    function fillPrivacy(flags) {
        if (els.swPrivate)  els.swPrivate.checked  = !!flags.is_private;
        // Faollik ko'rinishi odatiy yo'lda yoqiq (yoqsa True) bo'lgani uchun
        // `false` faqat aniq `0` bo'lganda to'g'ri keladi.
        if (els.swActivity) els.swActivity.checked = flags.show_activity !== false
            && flags.show_activity !== 0;
        if (els.privBadge) els.privBadge.hidden = !flags.is_private;
        var hint = $('#stPrivateHint');
        if (hint) {
            hint.textContent = flags.is_private
                ? 'Faqat sizni kuzatuvchilar reels va profilni ko‘ra oladi.'
                : 'Hamma profilni, reels va xabarlarni ko‘ra oladi.';
        }
    }

    function savePrivacy() {
        if (!els.swPrivate) return;
        var swP = els.swPrivate, swA = els.swActivity;
        swP.disabled = true;
        if (swA) swA.disabled = true;
        say('Saqlanmoqda…');
        post('save', {
            is_private:    swP.checked ? '1' : '0',
            show_activity: (swA && swA.checked) ? '1' : '0'
        }).then(function (res) {
            swP.disabled = false;
            if (swA) swA.disabled = false;
            var d = res.data;
            if (d && d.success) {
                fillPrivacy(d.settings || {});
                // Nima o'zgarganini aniq aytamiz — server `changed` ro'yxatini
                // qaytaradi (faqat haqiqatan farq qilgan maydonlar).
                var ch = Array.isArray(d.changed) ? d.changed : [];
                var txt;
                if (ch.indexOf('is_private') >= 0) {
                    txt = d.settings && d.settings.is_private
                        ? 'Profil maxfiyga o‘tkazildi'
                        : 'Profil ochiq qilindi';
                } else if (ch.indexOf('show_activity') >= 0) {
                    txt = d.settings && d.settings.show_activity === false
                        ? 'Faollik yashirildi'
                        : 'Faollik ko‘rsatilmoqda';
                } else {
                    txt = 'O‘zgarish yo‘q';
                }
                say(txt, 'ok');
                toast(txt);
            } else {
                say((d && d.message) || 'Saqlanmadi', 'err');
            }
        }).catch(function () {
            swP.disabled = false;
            if (swA) swA.disabled = false;
            say('Tarmoq xatosi', 'err');
        });
    }

    if (els.swPrivate) els.swPrivate.addEventListener('change', savePrivacy);
    if (els.swActivity) els.swActivity.addEventListener('change', savePrivacy);

    // =====================================================================
    //  2) PROFIL TAHRIRLASH
    // =====================================================================
    function fillProfile(p) {
        if (!p) return;
        if (els.fName) els.fName.value = p.first_name || '';
        if (els.fLast) els.fLast.value = p.last_name || '';
        if (els.fUser) els.fUser.value = p.username || '';
        if (els.fBio)  els.fBio.value  = p.bio || '';
        if (els.fAva)  els.fAva.value  = p.avatar || '';
        updateBioCount();
    }

    function updateBioCount() {
        if (els.bioCount && els.fBio) els.bioCount.textContent = els.fBio.value.length + ' / 500';
    }
    if (els.fBio) els.fBio.addEventListener('input', updateBioCount);

    if (els.form) {
        els.form.addEventListener('submit', function (e) {
            e.preventDefault();
            var btn = $('#stSaveBtn');
            // Faqat O'ZGARGAN maydonlarni yuboramiz — bo'sh maydon
            // (masalan avatar) serverda avvalgisini o'chirmasligi kerak.
            var payload = {};
            var all = {
                first_name: els.fName ? els.fName.value.trim() : '',
                last_name:  els.fLast ? els.fLast.value.trim() : '',
                username:   els.fUser ? els.fUser.value.trim() : '',
                bio:        els.fBio  ? els.fBio.value.trim()  : '',
                avatar:     els.fAva  ? els.fAva.value.trim()  : '',
            };
            var original = els.form.dataset.orig || '{}';
            var orig = {};
            try { orig = JSON.parse(original); } catch (err) {}
            Object.keys(all).forEach(function (k) {
                if (String(all[k]) !== String(orig[k] == null ? '' : orig[k])) payload[k] = all[k];
            });
            if (!Object.keys(payload).length) { say('O‘zgarish yo‘q', ''); return; }

            if (btn) { btn.disabled = true; btn.textContent = 'Saqlanmoqda…'; }
            say('');
            post('profile', payload).then(function (res) {
                if (btn) { btn.disabled = false; btn.textContent = 'Saqlash'; }
                var d = res.data;
                if (d && d.success) {
                    fillProfile(d.profile);
                    els.form.dataset.orig = JSON.stringify({
                        first_name: d.profile.first_name || '',
                        last_name:  d.profile.last_name || '',
                        username:   d.profile.username || '',
                        bio:        d.profile.bio || '',
                        avatar:     d.profile.avatar || '',
                    });
                    say('Profil yangilandi', 'ok');
                    toast('Saqlandi');
                } else {
                    say((d && d.message) || 'Saqlanmadi', 'err');
                }
            }).catch(function () {
                if (btn) { btn.disabled = false; btn.textContent = 'Saqlash'; }
                say('Tarmoq xatosi', 'err');
            });
        });
    }

    // =====================================================================
    //  3) BLOKLANGANLAR
    // =====================================================================
    function avaHTML(u) {
        var init = esc(((u.full_name || u.username || '?').charAt(0) || '?').toUpperCase());
        if (u.avatar) {
            return '<span class="st-b-ava"><img src="' + esc(u.avatar) + '" alt=""'
                 + ' onerror="this.parentNode.textContent=\'' + init + '\'"></span>';
        }
        return '<span class="st-b-ava">' + init + '</span>';
    }

    function renderBlocks(list) {
        if (els.blockCount) els.blockCount.textContent = list.length ? String(list.length) : '';
        if (!els.blockList) return;
        if (!list.length) {
            els.blockList.innerHTML =
                '<div class="st-empty">Hech kim bloklanmagan.<br>'
                + '<span style="font-size:11.5px">Bloklangan foydalanuvchi sizning postlaringizni '
                + 'ko‘ra olmaydi va sizga xabar yubora olmaydi.</span></div>';
            return;
        }
        els.blockList.innerHTML = list.map(function (u) {
            return '<div class="st-blocked-item" data-id="' + u.id + '">'
                + avaHTML(u)
                + '<span class="st-b-body">'
                +   '<span class="st-b-name">' + esc(u.full_name || 'Foydalanuvchi') + '</span>'
                +   '<span class="st-b-sub">@' + esc(u.username || '—')
                +     (u.mutual ? ' · <b style="color:var(--accent-2)">siz ham bloklagan</b>' : '')
                +   '</span>'
                + '</span>'
                + '<button type="button" class="st-unblock">Blokdan chiqarish</button>'
                + '</div>';
        }).join('');

        els.blockList.querySelectorAll('.st-blocked-item').forEach(function (item) {
            var id = Number(item.dataset.id);
            var btn = item.querySelector('.st-unblock');
            btn.addEventListener('click', function () {
                btn.disabled = true;
                btn.textContent = 'Ochirilmoqda…';
                post('unblock', { user_id: String(id) }).then(function (res) {
                    if (res.data && res.data.success) {
                        item.remove();
                        loadBlocks();
                        toast('Blokdan chiqarildi');
                    } else {
                        btn.disabled = false;
                        btn.textContent = 'Blokdan chiqarish';
                        toast((res.data && res.data.message) || 'Xatolik', false);
                    }
                }).catch(function () {
                    btn.disabled = false;
                    btn.textContent = 'Blokdan chiqarish';
                    toast('Tarmoq xatosi', false);
                });
            });
        });
    }

    function loadBlocks() {
        return api('blocks').then(function (d) {
            renderBlocks((d && d.blocks) || []);
        });
    }

    // ------------------------------------------------------ qidiruv + bloklash
    var searchTimer = null;
    if (els.search) {
        els.search.addEventListener('input', function () {
            clearTimeout(searchTimer);
            var q = els.search.value.trim();
            if (q.length < 1) { if (els.searchRes) els.searchRes.hidden = true; return; }
            searchTimer = setTimeout(function () { doSearch(q); }, 260);
        });
    }

    function doSearch(q) {
        if (!els.searchRes) return;
        els.searchRes.hidden = false;
        els.searchRes.innerHTML = '<div class="st-res-empty">Qidirilmoqda…</div>';
        api('search', { q: q }).then(function (d) {
            var rows = (d && d.results) || [];
            if (!rows.length) {
                els.searchRes.innerHTML = '<div class="st-res-empty">Topilmadi</div>';
                return;
            }
            els.searchRes.innerHTML = rows.map(function (u) {
                return '<button type="button" class="st-res-item" data-id="' + u.id + '" data-blocked="' + (u.blocked ? '1' : '0') + '">'
                    + avaHTML(u)
                    + '<span><span class="n">' + esc(u.full_name || 'Foydalanuvchi') + '</span>'
                    + '<span class="s">@' + esc(u.username || '—') + '</span></span></button>';
            }).join('');

            els.searchRes.querySelectorAll('.st-res-item').forEach(function (b) {
                b.addEventListener('click', function () {
                    var id = Number(b.dataset.id);
                    if (b.dataset.blocked === '1') {
                        post('unblock', { user_id: String(id) }).then(function () {
                            toast('Blokdan chiqarildi');
                            els.search.value = '';
                            els.searchRes.hidden = true;
                            loadBlocks();
                        });
                        return;
                    }
                    b.disabled = true;
                    post('block', { user_id: String(id) }).then(function (res) {
                        b.disabled = false;
                        if (res.data && res.data.success) {
                            b.dataset.blocked = '1';
                            toast('Foydalanuvchi bloklandi');
                            els.search.value = '';
                            els.searchRes.hidden = true;
                            loadBlocks();
                        } else {
                            toast((res.data && res.data.message) || 'Xatolik', false);
                        }
                    }).catch(function () {
                        b.disabled = false;
                        toast('Tarmoq xatosi', false);
                    });
                });
            });
        }).catch(function () {
            els.searchRes.innerHTML = '<div class="st-res-empty">Qidiruvda xatolik</div>';
        });
    }

    document.addEventListener('click', function (e) {
        if (els.searchRes && !e.target.closest('#stSearch') && !e.target.closest('.st-search')) {
            els.searchRes.hidden = true;
        }
    });

    // =====================================================================
    //  4) BOSHLANG'ICH YUKLASH
    // =====================================================================
    api('get').then(function (d) {
        if (!d || !d.success) {
            say((d && d.message) || 'Sozlamalarni yuklab bo‘lmadi', 'err');
            return;
        }
        fillPrivacy(d.settings || {});
        fillProfile(d.profile || {});
        if (els.form) {
            els.form.dataset.orig = JSON.stringify({
                first_name: (d.profile && d.profile.first_name) || '',
                last_name:  (d.profile && d.profile.last_name) || '',
                username:   (d.profile && d.profile.username) || '',
                bio:        (d.profile && d.profile.bio) || '',
                avatar:     (d.profile && d.profile.avatar) || '',
            });
        }
        loadBlocks();
    }).catch(function () {
        say('Tarmoq xatosi', 'err');
    });
})();