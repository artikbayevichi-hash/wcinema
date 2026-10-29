/* ============================================================================
   site-banner.js — admin panel "Sozlamalar" dagi e'lonni ko'rsatadi
   ----------------------------------------------------------------------------
   • Matn `storage/settings.json` → `notice` (api/site-config.php orqali)
   • Havola ixtiyoriy (`notice_link`)
   • "Yopish" bosilsa shu sessiyada boshqa ko'rinmaydi
   • E'lon bo'lmasa — hech narsa qilmaydi (0 qo'shimcha DOM)
   ========================================================================== */
(function () {
    'use strict';

    var BASE = (window.APP && window.APP.base) || '';
    var KEY = 'wc_notice_closed';

    function show(d) {
        if (!d.notice) return;
        try {
            if (sessionStorage.getItem(KEY) === d.notice) return;
        } catch (e) {}
        if (document.getElementById('wcNotice')) return;

        var box = document.createElement('div');
        box.id = 'wcNotice';
        box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99998;'
            + 'max-width:340px;background:#17141f;color:#eae6f2;border:1px solid #2c2739;'
            + 'border-radius:14px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.45);'
            + 'font:13.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
            + 'display:flex;gap:10px;align-items:flex-start';

        var body = '<div style="flex:1">'
            + '<div style="font-weight:700;margin-bottom:3px">📣 E’lon</div>'
            + '<div style="color:#c9c3d8">' + escapeHtml(d.notice) + '</div>';

        if (d.notice_link) {
            body += '<a href="' + escapeAttr(d.notice_link) + '" '
                + 'style="display:inline-block;margin-top:8px;color:#b7aef0;font-weight:700;text-decoration:none">Batafsil →</a>';
        }
        body += '</div>'
            + '<button type="button" aria-label="Yopish" '
            + 'style="background:none;border:none;color:#6f6880;font-size:18px;cursor:pointer;line-height:1">×</button>';

        box.innerHTML = body;
        box.querySelector('button').onclick = function () {
            try { sessionStorage.setItem(KEY, d.notice); } catch (e) {}
            box.remove();
        };
        document.body.appendChild(box);
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function escapeAttr(s) {
        return escapeHtml(s).replace(/^javascript:/i, '');
    }

    function load() {
        fetch(BASE + '/api/site-config.php', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d && d.success) show(d); })
            .catch(function () {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(load, 1200); });
    } else {
        setTimeout(load, 1200);
    }
})();
