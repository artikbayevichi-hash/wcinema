/* ============================================================================
   tg-notify-prompt.js - "botni ishga tushiring" eslatmasi
   ----------------------------------------------------------------------------
   Nima uchun: Telegram orqali bildirishnoma yuborish uchun foydalanuvchi
   botga bir marta /start bosgan bo'lishi shart (Telegram qoidasi). Shu
   banner buni bir marta, nozik tarzda eslatadi.

   • Faqat chat ulanmagan bo'lsa ko'rinadi.
   • "Yopish" bosilsa 7 kun ko'rinmaydi.
   • Tizimga kirmagan foydalanuvchida umuman chiqmaydi (401 — jim).
   ========================================================================== */
(function () {
    'use strict';

    var DISMISS_KEY = 'wc_notify_prompt_until';
    try {
        var until = Number(localStorage.getItem(DISMISS_KEY) || 0);
        if (until > Date.now()) return;
    } catch (e) {}

    var base = (window.APP && window.APP.base) || '';

    function show(link) {
        if (document.getElementById('wcNotifyPrompt')) return;

        var b = document.createElement('div');
        b.id = 'wcNotifyPrompt';
        b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;'
            + 'max-width:420px;margin:0 auto;background:#17141f;color:#eae6f2;'
            + 'border:1px solid #2c2739;border-radius:14px;padding:12px 14px;'
            + 'font:13.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
            + 'box-shadow:0 10px 30px rgba(0,0,0,.45);display:flex;gap:10px;align-items:center';

        b.innerHTML =
            '<div style="flex:1">'
            + '<div style="font-weight:700;margin-bottom:2px">🔔 Bildirishnomalar</div>'
            + '<div style="color:#9b93ad;font-size:12.5px">Yangi film va yangiliklar haqida xabar olish uchun botni ishga tushiring.</div>'
            + '</div>'
            + '<a href="' + link + '" target="_blank" rel="noopener" '
            + 'style="white-space:nowrap;background:linear-gradient(135deg,#6a5cff,#9b4dff);color:#fff;'
            + 'text-decoration:none;font-weight:700;padding:9px 12px;border-radius:10px;font-size:12.5px">Ulash</a>'
            + '<button type="button" aria-label="Yopish" '
            + 'style="background:none;border:none;color:#6f6880;font-size:18px;cursor:pointer;line-height:1">×</button>';

        b.querySelector('button').onclick = function () {
            try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 86400 * 1000)); } catch (e) {}
            b.remove();
        };

        document.body.appendChild(b);
    }

    function check() {
        fetch(base + '/api/tg-connect.php', { credentials: 'same-origin' })
            .then(function (r) {
                if (!r.ok) return null;
                return r.json();
            })
            .then(function (d) {
                if (!d || !d.success) return;
                if (!d.connected && d.link) show(d.link);
            })
            .catch(function () {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(check, 2500); });
    } else {
        setTimeout(check, 2500);
    }
})();
