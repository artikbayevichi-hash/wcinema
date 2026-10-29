<?php
// ============================================================================
// diag.php — video ochilish TEZLIGINI o'lchash (faqat localhost)
// ============================================================================
// Nima uchun: "sekin" degan shikoyatni taxmin bilan tuzatib bo'lmaydi.
// Bu sahifa haqiqiy brauzerda butun zanjirni o'lchaydi:
//   sahifa → SW → GramJS bundle → WSS connect → findDoc → birinchi bayt →
//   player tayyor.
//
// Natija `storage/diag.jsonl` ga yoziladi (web'dan yopiq papka) — uni
// serverdan o'qish mumkin, foydalanuvchi hech narsa nusxalashi shart emas.
//
// OCHISH: http://localhost/tele_uzdub/diag.php  (15 soniya kuting)
// ============================================================================
require_once __DIR__ . '/includes/bootstrap.php';

$host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
if (!preg_match('/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/', $host)) {
    http_response_code(403);
    exit('Faqat localhost uchun');
}

$base = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/'))), '/');

// Birinchi t.me havolali qismni olamiz (o'lchov uchun namuna).
$row = Database::getInstance()->fetchOne(
    "SELECT id, video_url, video_url_720p, video_url_1080p
       FROM episodes
      WHERE video_url LIKE '%t.me/%'
      ORDER BY id LIMIT 1"
);
$url = $row ? ($row['video_url_1080p'] ?: ($row['video_url_720p'] ?: $row['video_url'])) : '';
$chan = '';
$post = 0;
if ($url && preg_match('#t\.me/(?:s/)?([A-Za-z0-9_]+)/(\d+)#', $url, $m)) {
    $chan = '@' . $m[1];
    $post = (int) $m[2];
}

$jsV = @filemtime(__DIR__ . '/assets/js/tg-stream.js') ?: 1;
?>
<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Video tezlik diagnostikasi</title>
<style>
  body{font:13px/1.5 ui-monospace,Consolas,monospace;background:#0f1115;color:#e8e8e8;margin:0;padding:16px}
  h1{font-size:16px;margin:0 0 6px}
  #st{color:#8fd6a0}
  .box{width:340px;height:190px;background:#1a1d24;border:1px solid #2a2f3a;margin:10px 0;display:inline-block;vertical-align:top}
  .box + .box{margin-left:10px}
  pre{white-space:pre-wrap;background:#000;border:1px solid #2a2f3a;padding:12px;display:none;margin-top:12px}
</style>
</head>
<body>
<h1>Video ochilish diagnostikasi</h1>
<p id="st">Ishlayapti… 15 soniya kuting, sahifani yopmang.</p>
<p>Namuna: <b><?php echo esc($chan . '/' . $post); ?></b> (qism #<?php echo (int) ($row['id'] ?? 0); ?>)</p>
<div class="box" id="b1"></div>
<div class="box" id="b2"></div>
<pre id="out"></pre>

<script>
window.APP = {
  base: <?php echo json_encode($base); ?>,
  tg: {
    apiId: <?php echo (int) TG_API_ID; ?>,
    apiHash: <?php echo json_encode((string) TG_API_HASH); ?>
  }
};
</script>
<script src="<?php echo esc($base); ?>/assets/js/tg-stream.js?v=<?php echo $jsV; ?>"></script>
<script>
(function () {
  var CH = <?php echo json_encode($chan); ?>;
  var P  = <?php echo (int) $post; ?>;
  var U  = <?php echo json_encode($url); ?>;

  var res = { started: new Date().toISOString(), channel: CH, post: P, ua: navigator.userAgent };
  var t0 = performance.now();
  function ms() { return Math.round(performance.now() - t0); }

  try { localStorage.setItem('wc_tg_debug', '1'); } catch (e) {}

  var nav = performance.getEntriesByType('navigation')[0];
  if (nav) { res.domInteractive = Math.round(nav.domInteractive); res.domComplete = Math.round(nav.domComplete); }

  var sent = false;
  function send() {
    if (sent) return;
    sent = true;
    res.marks = (window.__wcTgLog || []).slice();
    res.perf  = window.__wcPerf || null;
    res.t_end = ms();
    try {
      fetch('<?php echo esc($base); ?>/api/diag-log.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(res)
      });
    } catch (e) {}
    var o = document.getElementById('out');
    o.style.display = 'block';
    o.textContent = JSON.stringify(res, null, 1);
    document.getElementById('st').textContent = 'TAYYOR — natija yuborildi ✅';
  }

  if (!CH || !P) {
    res.error = 't.me havolali qism topilmadi';
    send();
    return;
  }

  // 1) Metama'lumotni oldindan yuklash (watch.php ham shunday qiladi)
  var tPre = performance.now();
  try {
    Promise.resolve(TgStream.prefetch({ channel: CH, post: P })).then(function () {
      res.prefetch_ms = Math.round(performance.now() - tPre);
    }, function () { res.prefetch_ms = -1; });
  } catch (e) { res.prefetch_ms = -2; }

  // 2) Birinchi ochilish
  TgStream.mount(document.getElementById('b1'), {
    channel: CH, post: P, url: U, cfg: {}, epLabel: '',
    onReady: function () { res.ready1 = ms(); }
  });

  // 3) Takroriy ochilish (kesh bilan — "0 sekund" holati)
  setTimeout(function () {
    var t1 = performance.now();
    TgStream.mount(document.getElementById('b2'), {
      channel: CH, post: P, url: U, cfg: {}, epLabel: '',
      onReady: function () { res.ready2 = Math.round(performance.now() - t1); }
    });
  }, 8000);

  setTimeout(send, 16000);
})();
</script>
</body>
</html>
