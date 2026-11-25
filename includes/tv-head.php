<?php
// ============================================================================
// tv-head.php — Smart TV rejimini <head> ichida aniqlash (FOUC siz)
// ---------------------------------------------------------------------------
// `assets/js/tv-mode.js` odatda `<body>` oxirida yuklanadi (u spatial
// navigatsiyani ham boshqaradi). Lekin `.tv-mode` klassi sahifa chizilishidan
// OLDIN qo'yilishi kerak — aks holda TV foydalanuvchisi bir daqiqa
// "telefon" ko'rinishini ko'radi (FOUC).
//
// Shu sababli bu kichik, sinxron skript `<head>` ichida ishlaydi va faqat
// klassni qo'yadi. Boshqa hammasi `tv-mode.js` da (u `initial()` ni
// `localStorage` va shu klass bilan bir xil hisoblaydi).
//
// Ishlatish: <head> ichida — `require __DIR__ . '/includes/tv-head.php';`
//
// DIQQAT: bu izohda HECH QACHON PHP ochiq/yopiq tegini yozib bo'lmaydi
// (yuqorida `include` misoli shuning uchun tegsiz yozilgan). PHP parser
// `//` izohini ham tekshiradi va undagi yopuvchi tegni haqiqiy teg deb
// oladi — natijada quyidagi `// ====` qatori (va undan keyingi kod)
// brauzerga MATN holida chiqib ketar edi. Bu xato `watch.php` da
// ko'rinib turardi.
// ============================================================================
?>
<link rel="stylesheet" href="<?php echo htmlspecialchars($tvBase ?? 'assets/css/tv.css'); ?>?v=<?php echo @filemtime(__DIR__ . '/../assets/css/tv.css') ?: 1; ?>">
<script>
(function () {
    var d = document, h = d.documentElement;
    function on(st) {
        // `.tv-mode` — asosiy klass (tv.css shuni kutadi).
        h.classList.toggle('tv-mode', !!st);
        // `tv` — instagram.css dagi eski selektorlar uchun.
        h.classList.toggle('tv', !!st);
    }
    try {
        var q = new URLSearchParams(location.search).get('tv');
        if (q === '1' || q === 'true') { on(1); }
        else if (q === '0' || q === 'false') { on(0); }
        else {
            var saved = null;
            try { saved = localStorage.getItem('wc_tv_mode'); } catch (e) {}
            if (saved === '1') on(1);
            else if (saved === '0') on(0);
            else {
                var ua = navigator.userAgent || '';
                on(/(SmartTV|Smart ?TV|Tizen|Web0?S|WebOS|NetCast|BRAVIA|HbbTV|VIDAA|Viera|Hisense|PlayStation|Xbox|Roku|AppleTV|Apple TV|tvOS|Android TV|GoogleTV|Google TV|AFT[BCEHMNRT]|ADT-[A-Z0-9]+|CrKey|Kindle\/)/i.test(ua));
            }
        }
    } catch (e) {}

})();
(function () {
    // Mobil klaviatura ochilganda pastki tablani yashirish va faol
    // kompozitorni klaviatura ustiga surish. Faqat VisualViewport mavjud
    // bo'lganda ishlaydi; video oqimiga tegmaydi.
    var vv = window.visualViewport;
    if (!vv || !vv.addEventListener) return;
    var h = document.documentElement, field = null, base = 0, timer = 0;

    function isField(el) {
        if (!el || !el.tagName) return false;
        var tag = el.tagName.toUpperCase();
        return el.isContentEditable || tag === 'TEXTAREA'
            || (tag === 'INPUT' && !/^(hidden|radio|checkbox|button|submit|file)$/i.test(el.type || ''));
    }
    function clear() {
        h.classList.remove('kb-open');
        h.style.removeProperty('--kb');
        h.style.removeProperty('--kb-shift');
    }
    function sync() {
        if (!field || !isField(field) || !field.isConnected || document.activeElement !== field) {
            clear(); return;
        }
        // TV ekran klaviaturasi (pult) haqiqiy klaviatura emas.
        if (field.closest && field.closest('#tvSearch')) { clear(); return; }
        var kb = Math.round(base - vv.height - Math.max(0, vv.offsetTop || 0));
        if (!isFinite(kb) || kb < 70) { clear(); return; }
        kb = Math.min(kb, Math.round((window.innerHeight || base) * 0.62));
        h.classList.add('kb-open');
        h.style.setProperty('--kb', kb + 'px');
        h.style.setProperty('--kb-shift', kb + 'px');
    }
    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(sync, 90);
    }
    document.addEventListener('focusin', function (e) {
        if (!isField(e.target)) return;
        field = e.target;
        base = vv.height;
        schedule();
    }, true);
    document.addEventListener('focusout', function (e) {
        if (e.target !== field) return;
        field = null;
        schedule();
    }, true);
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    window.addEventListener('pagehide', clear);
})();
</script>
