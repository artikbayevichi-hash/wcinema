/* ============================================================================
   site-banner.js — admin e'lonini SAHIFA TEPASIDA, butun kenglikda ko'rsatadi
   ----------------------------------------------------------------------------
   • Matn `storage/settings.json` → `notice` (admin panel → Sozlamalar yoki
     "Bildirishnoma → Hamma" dagi "Tepada banner" katagi).
   • Banner `top:0; left:0; right:0` — sahifaning butun tepasini egallaydi.
   • Balandligi `--wc-ann-h` ga yoziladi: mobar, yon panel va sticky sarlavhalar
     shuncha pastga siljiydi, kontent banner ostida qolmaydi.
   • "Yopish" bosilsa shu sessiyada boshqa ko'rinmaydi.
   • E'lon bo'lmasa — hech narsa qilmaydi (0 qo'shimcha DOM, 0 so'rov).
   ========================================================================== */
(function () {
    'use strict';

    var BASE = (window.APP && window.APP.base) || '';
    var KEY = 'wc_notice_closed';
    var box = null;
    var observer = null;

    function setHeight(px) {
        try {
            document.documentElement.style.setProperty('--wc-ann-h', (Math.round(px) || 0) + 'px');
        } catch (e) {}
    }
    function measure() {
        if (box) setHeight(box.offsetHeight);
    }

    function close(key) {
        try { sessionStorage.setItem(KEY, key); } catch (e) {}
        setHeight(0);
        if (observer && observer.disconnect) observer.disconnect();
        if (box && box.parentNode) box.parentNode.removeChild(box);
        box = null;
    }

    function show(d) {
        if (!d.notice) return;
        var key = String(d.notice);
        try {
            if (sessionStorage.getItem(KEY) === key) return;
        } catch (e) {}
        if (document.getElementById('wcNotice')) return;

        box = document.createElement('div');
        box.id = 'wcNotice';
        box.className = 'wc-top-banner';
        box.setAttribute('role', 'status');
        box.setAttribute('aria-label', 'E’lon');
        // Stillar inline: banner barcha sahifalarda ishlashi kerak (ba'zi
        // sahifalarda instagram.css ulanmagan, masalan tg-login.php).
        box.style.cssText = 'position:fixed;top:0;left:0;right:0;width:100%;box-sizing:border-box;'
            + 'z-index:80;display:flex;align-items:center;gap:10px;flex-wrap:wrap;'
            + 'padding:9px max(16px, env(safe-area-inset-right, 0px)) '
            + '9px max(16px, env(safe-area-inset-left, 0px));'
            + 'background:linear-gradient(90deg,#5b3fd6 0%,#8b46e8 55%,#b347c9 100%);'
            + 'color:#fff;box-shadow:0 6px 22px rgba(0,0,0,.4);'
            + 'font:13.5px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';

        var body = '<span aria-hidden="true" style="font-size:17px;line-height:1">📣</span>'
            + '<strong style="font-weight:800;white-space:nowrap">E’lon</strong>'
            + '<span style="flex:1 1 240px;min-width:0;color:#f4efff">'
            + escapeHtml(d.notice) + '</span>';

        if (d.notice_link) {
            body += '<a href="' + escapeAttr(d.notice_link) + '" '
                + 'style="color:#fff;font-weight:800;text-decoration:underline;white-space:nowrap">Batafsil →</a>';
        }
        body += '<button type="button" aria-label="Yopish" '
            + 'style="background:rgba(255,255,255,.16);border:0;border-radius:8px;color:#fff;'
            + 'font-size:17px;line-height:1;width:26px;height:26px;cursor:pointer;flex:0 0 auto">×</button>';

        box.innerHTML = body;
        box.querySelector('button').addEventListener('click', function () { close(key); });
        document.body.appendChild(box);

        measure();
        if (window.ResizeObserver) {
            observer = new ResizeObserver(measure);
            observer.observe(box);
        } else {
            window.addEventListener('resize', measure);
        }
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function escapeAttr(s) {
        return escapeHtml(s).replace(/^\s*javascript:/i, '');
    }

    function load() {
        // Sozlamalar sahifa HTML'iga inline qilib beriladi (perf-head.php) —
        // alohida `api/site-config.php` so'rovi (bitta RTT) endi YO'Q.
        var inline = window.__WCSITECFG;
        if (inline) {
            if (inline.success) show(inline);
            return; // inline bor — tarmoqqa murojaat yo'q
        }
        // Zaxira: perf-head.php ulanmagan sahifalar uchun eski yo'l.
        fetch((BASE ? BASE.replace(/\/$/, '') : '') + '/api/site-config.php', {
            credentials: 'same-origin'
        }).then(function (r) { return r.json(); })
          .then(function (d) { if (d && d.success) show(d); })
          .catch(function () {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(load, 1200); });
    } else {
        setTimeout(load, 1200);
    }
})();
