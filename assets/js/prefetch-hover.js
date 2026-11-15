/* ============================================================================
   prefetch-hover.js — karta ustiga "hover" bo'lganda videoni OLDINDAN tayyorlash
   ----------------------------------------------------------------------------
   Nima uchun: foydalanuvchi kartani ko'rib, 200–600 ms dan keyin bosadi.
   Shu oraliqda kanal/xabar topilib (`findDoc`) va fayl boshi keltirilib
   qo'yilsa, bosish paytida video DARHOL ochiladi.

   Xatti-harakat:
     • hover 120 ms dan uzoq davom etsa — boshlanadi (tasodifiy o'tishda yo'q);
     • sichqoncha chiqib ketsa yoki boshqa karta tanlansa — bekor qilinadi;
     • mobil qurilmada `touchstart` da ishlaydi (click dan oldin);
     • bir manba uchun bir marta;
     • Telegram sessiyasi bo'lmasa — jim o'tadi.
   ========================================================================== */
(function () {
    'use strict';

    if (!window.TgStream || typeof window.TgStream.prefetch !== 'function') return;

    var BASE = (window.APP && window.APP.base) || '';
    var seen = {};              // "c:e" -> true
    var timer = null;
    var currentKey = '';

    function ctxFromLink(a) {
        var href = a.getAttribute('href') || '';
        if (href.indexOf('watch.php') === -1) return null;
        var u;
        try { u = new URL(a.href, location.href); } catch (e) { return null; }
        var c = u.searchParams.get('c');
        var e = u.searchParams.get('e') || u.searchParams.get('ep');
        if (!c && !e) return null;
        return { c: c || '', e: e || '', key: (c || '') + ':' + (e || '') };
    }

    function load(key, c, e) {
        if (seen[key]) return;
        seen[key] = true;
        var qs = '?c=' + encodeURIComponent(c);
        if (e) qs += '&e=' + encodeURIComponent(e);

        fetch(BASE + '/api/prefetch-context.php' + qs, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d || !d.success || !d.telegram || !d.channel || !d.post) return;
                var opts = { channel: d.channel, post: d.post, url: d.url };
                try { window.TgStream.prefetch(opts); } catch (e1) {}
                try {
                    if (typeof window.TgStream.warmMedia === 'function') {
                        window.TgStream.warmMedia(opts);
                    }
                } catch (e2) {}
            })
            .catch(function () {});
    }

    function schedule(a) {
        var ctx = ctxFromLink(a);
        if (!ctx) return;
        clearTimeout(timer);
        currentKey = ctx.key;
        // 180 ms: tasodifiy o'tishda so'rov ketmaydi, lekin jiddiy niyat
        // (kursor shu kartada turibdi) bo'lsa tayyorgarlik boshlanadi.
        timer = setTimeout(function () {
            if (currentKey === ctx.key) load(ctx.key, ctx.c, ctx.e);
        }, 180);
    }

    function cancel() {
        clearTimeout(timer);
        currentKey = '';
    }

    // Desktop: sichqoncha olib kelish
    document.addEventListener('pointerover', function (ev) {
        var a = ev.target && ev.target.closest ? ev.target.closest('a[href*="watch.php"]') : null;
        if (!a) return;
        // SW uyquda bo'lsa uyg'otamiz — birinchi so'rov kutmasin.
        try { if (window.TgStream && window.TgStream.wakeSW) window.TgStream.wakeSW(); } catch (e) {}
        schedule(a);
    }, { passive: true });

    document.addEventListener('pointerout', function (ev) {
        var a = ev.target && ev.target.closest ? ev.target.closest('a[href*="watch.php"]') : null;
        if (a) cancel();
    }, { passive: true });

    // Bosish BOSHLANISHI (barmoq tegi / sichqoncha bosildi) — `click` dan
    // oldin. Telefonda hover yo'q, shuning uchun bu yagona imkoniyat:
    // 100–300 ms yutiladi.
    function pressStart(ev) {
        var a = ev.target && ev.target.closest ? ev.target.closest('a[href*="watch.php"]') : null;
        if (!a) return;
        var ctx = ctxFromLink(a);
        if (!ctx) return;
        try { if (window.TgStream && window.TgStream.wakeSW) window.TgStream.wakeSW(); } catch (e) {}
        load(ctx.key, ctx.c, ctx.e);
    }
    document.addEventListener('pointerdown', pressStart, { passive: true });
    document.addEventListener('touchstart', pressStart, { passive: true });

    // Dastlabki avtomatik "isitish" OLIB TASHLANDI: har bir tashrifchida
    // 4 ta videoning 4 MB prefiksi yuklanardi (minglab foydalanuvchida
    // Telegram'ga katta yuk). Endi faqat kursor/barmoq bilan jiddiy
    // qiziqish bildirilganda yuklanadi. "Davom ettirish" videosi
    // `tg-prefetch.js` tomonidan alohida tayyorlanadi.

})();
