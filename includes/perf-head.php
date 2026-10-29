<?php
// ============================================================================
// perf-head.php — tarmoq ulanishini OLDINDAN ochish (video tezroq ochiladi)
// ---------------------------------------------------------------------------
// Nima uchun kerak:
//   Video Telegram CDN'dan (telesco.pe / cdn-telegram.org) va MTProto orqali
//   (venus.web.telegram.org) keladi. Brauzer bu domenlarni FAQAT player
//   ishga tushganda topadi — ya'ni DNS + TCP + TLS qadamlari videoning
//   birinchi kadriga qadar kutadi (odatda 100–600 ms, sekin tarmoqda
//   ko'proq).
//
//   `preconnect` shu qadamlarni HTML parse bo'layotganda, CSS/JS yuklanishi
//   bilan PARALLEL boshlaydi. Natija: player ishga tushganda ulanish
//   allaqachon tayyor — "birinchi kadr" deyarli darhol chiqadi.
//
//   `dns-prefetch` — preconnect'ni qo'llab-quvvatlamaydigan brauzerlar uchun
//   zaxira (faqat DNS).
//
// Ishlatish: <head> ichida, boshqa resurslardan OLDIN —
//   require __DIR__ . '/includes/perf-head.php';
//
// Ixtiyoriy: `$PERF_POSTER` (sahifa posteri) berilsa, u `preload` qilinadi —
// thumbnail video yuklanishidan oldin ko'rinadi (qora ekran bo'lmaydi).
// ============================================================================

// Ixtiyoriy poster (mutlaq yoki nisbiy yo'l). `data:`/`tg://` kabi
// manzillarni oldindan yuklab bo'lmaydi — ular o'tkazib yuboriladi.
$__perfPoster = isset($PERF_POSTER) ? trim((string) $PERF_POSTER) : '';
$__perfPosterOk = false;
if ($__perfPoster !== ''
    && (preg_match('#^(https?:)?//#i', $__perfPoster)
        || preg_match('#^(/|uploads/)#i', $__perfPoster))) {
    $__perfPosterOk = true;
}

// Ixtiyoriy Cloudflare Worker (Telegram CDN proxy) — oqim o'sha yerdan
// ketadigan bo'lsa, unga ham oldindan ulanamiz.
$__cfWorker = trim((string) env_value('CLOUDFLARE_WORKER_URL', ''));
$__cfHost   = $__cfWorker !== '' ? (string) (parse_url($__cfWorker, PHP_URL_HOST) ?: '') : '';
?>
<link rel="preconnect" href="https://venus.web.telegram.org" crossorigin>
<link rel="preconnect" href="https://api.telegram.org" crossorigin>
<link rel="preconnect" href="https://cdn.telesco.pe">
<link rel="preconnect" href="https://telesco.pe">
<link rel="dns-prefetch" href="//venus.web.telegram.org">
<link rel="dns-prefetch" href="//cdn.telesco.pe">
<link rel="dns-prefetch" href="//telesco.pe">
<?php if ($__cfHost !== ''): ?>
<link rel="preconnect" href="https://<?php echo htmlspecialchars($__cfHost, ENT_QUOTES); ?>" crossorigin>
<link rel="dns-prefetch" href="//<?php echo htmlspecialchars($__cfHost, ENT_QUOTES); ?>">
<?php endif; ?>
<?php if ($__perfPosterOk): ?>
<link rel="preload" as="image" href="<?php echo htmlspecialchars($__perfPoster, ENT_QUOTES); ?>" fetchpriority="high">
<?php endif; ?>
<?php
// Admin panel → Sozlamalar dagi e'lon (agar bo'lsa). `defer` — render'ni
// bloklamaydi, e'lon bo'lmasa skript hech narsa qilmaydi.
$__bannerV = @filemtime(__DIR__ . '/../assets/js/site-banner.js') ?: 1;
?>
<script defer src="<?php echo htmlspecialchars($__base, ENT_QUOTES); ?>/assets/js/site-banner.js?v=<?php echo (int) $__bannerV; ?>"></script>
<?php
// Service Worker'ni HTML parse paytida ro'yxatdan o'tkazamiz.
//
// Nima uchun: odatda SW `tg-stream.js` (5.3 MB bundle yuklangach) ichida
// ro'yxatdan o'tadi — birinchi video ochilishida o'rnatish tugashini
// kutish (yoki sahifani qayta yuklash) kerak bo'ladi. Bu yerda ro'yxatdan
// o'tish 735 KB bundle dekodlanishi bilan PARALLEL boshlanadi, natijada
// birinchi ochilishdagi kutish deyarli yo'qoladi.
//
// `tg-stream.js` o'sha skriptni qayta `register()` qiladi — bu xavfsiz:
// brauzer bir xil scope uchun mavjud registratsiyani qaytaradi.
$__base  = rtrim((string) (parse_url(SITE_URL, PHP_URL_PATH) ?: ''), '/');
$__swUrl = $__base . '/tg-cdn-worker.js';
$__swScp = ($__base !== '' ? $__base : '') . '/';

// Bundle versiyasi — `tg-stream.js` dagi `bundleGz()` AYNAN shu qiymatni
// ishlatadi (preload ham, haqiqiy yuklash ham bir xil URL bo'lishi shart).
$__bundleV = @filemtime(__DIR__ . '/../assets/js/tg-client.bundle.js.gz') ?: 1;
?>
<script>window.__WCBUNDLEV = <?php echo (int) $__bundleV; ?>;</script>
<script>
(function () {
  try {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register(<?php echo json_encode($__swUrl); ?>, {
      scope: <?php echo json_encode($__swScp); ?>,
      updateViaCache: 'none'
    }).then(function (reg) {
      try { if (reg && reg.active) reg.active.postMessage({ type: 'claim' }); } catch (e) {}
    }).catch(function () {});
  } catch (e) {}
})();
</script>

