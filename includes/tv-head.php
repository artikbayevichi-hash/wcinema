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
// Ishlatish: <head> ichida —
//     <?php require __DIR__ . '/includes/tv-head.php'; ?>
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
</script>
