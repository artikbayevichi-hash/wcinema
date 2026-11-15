/* ============================================================================
 * wc-session.js — server sessiyasini (HttpOnly `wc_cs` cookie) ta'minlash
 * ----------------------------------------------------------------------------
 * NIMA UCHUN:
 *   Kirish `assets/js/tg-stream.js` ichida, brauzerda bo'ladi (auth_key
 *   localStorage'da). Server esa buni ko'rmaydi. `api/client-session.php`
 *   imzolangan cookie beradi — sahifalar (LoginGate) aynan shu cookie'ni
 *   tekshiradi.
 *
 *   Cookie'ni faqat shu yupqa qatlam so'raydi: `wc_tg_me_v1` (TgStream
 *   saqlagan profil) ni `tg_me` sifatida yuboramiz. Og'ir klient to'plami
 *   (5.4 MB `tg-client.bundle.js`) bu yerda YUKLANMAYDI.
 *
 * ISHLATISH:
 *   WcSession.issue().then(function (ok) { if (ok) location.replace(next); });
 * ========================================================================== */
(function (global) {
    'use strict';

    var KEY = 'wc_tg_me_v1';        // TgStream saqlaydigan profil
    var pending = null;

    function base() {
        if (global.APP && global.APP.base) return String(global.APP.base);
        if (global.WC_BASE) return String(global.WC_BASE);
        return '';
    }

    function raw() {
        try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
    }

    /** true — cookie o'rnatilgan (yoki allaqachon shu foydalanuvchiniki). */
    function issue() {
        if (pending) return pending;

        var body = 'action=issue';
        var me = raw();
        if (me) body += '&tg_me=' + encodeURIComponent(me);

        pending = fetch(base() + '/api/client-session.php', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: body
        }).then(function (r) {
            return r.ok ? r.json().catch(function () { return null; }) : null;
        }).then(function (j) {
            pending = null;
            return !!(j && j.success && j.user_id > 0);
        }).catch(function () {
            pending = null;
            return false;
        });

        return pending;
    }

    global.WcSession = { issue: issue };
})(window);
