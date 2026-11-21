<?php
// ============================================================================
// StreamBootstrap — bitta video uchun BARCHA umumiy ma'lumotlarni yig'adi
// ============================================================================
// Birinchi tomoshabin videoni ochganda:
//   • t.me embed tekshiruvi
//   • anonim CDN video manzili (ommaviy postlar uchun)
//   • poster / 1-s preview
//   • doc id / dc / size / mime  (file_reference YO'Q!)
//   • HLS tayyorligi, izoh mavzusi, R2 holati
// yig'ilib BITTA SQL yozuvga saqlanadi.
//
// Ikkinchi va keyingi tomoshabinlar:
//   • BITTA SQL o'qish → hamma ma'lumotlar HTML ichida tayyor
//   • brauzer qo'shimcha API so'rovi yubormaydi
//   • faqat video baytlari olinadi (SW → Telegram yoki to'g'ri CDN)
// ============================================================================

require_once __DIR__ . '/StreamCache.php';
require_once __DIR__ . '/VideoIndex.php';
require_once __DIR__ . '/PrefixStore.php';
require_once __DIR__ . '/TgMeta.php';
require_once __DIR__ . '/TgPreview.php';
require_once __DIR__ . '/TgTopics.php';
require_once __DIR__ . '/TgResolve.php';

final class StreamBootstrap
{
    const TTL = 21600; // 6 soat
    const V   = 2;     // 2 = + MP4 indeks xaritasi (`index`)

    /**
     * @param array $playback  Catalog::getPlayback() natijasi
     * @param array $ctx       content_id / episode_id / item ixtiyoriy
     * @return array
     */
    public static function load(array $playback, array $ctx = [])
    {
        $key  = self::key($playback, $ctx);
        $meta = self::meta($playback, $ctx);
        $fp   = self::fingerprint($playback, $ctx, $meta);

        $cached = StreamCache::get($key, StreamCache::SCOPE_BOOT);
        $fresh  = is_array($cached)
            && (int) ($cached['v'] ?? 0) >= self::V
            && (string) ($cached['fp'] ?? '') === $fp;
        if ($fresh) {
            $cached['cache'] = 'hit';
            $cached['key']   = $key;
            return $cached;
        }

        // Kontent almashtirilgan (doc_id yoki hajm o'zgargan) yoki eski format:
        // eski yozuv va unga tegishli indeks/prefiks o'chiriladi, yangisi saqlanadi.
        if (is_array($cached)) self::discardStale($cached, $playback, $ctx, $meta);
        StreamCache::forget($key, StreamCache::SCOPE_BOOT);

        $payload = self::build($playback, $ctx, $meta);
        $payload['v']        = self::V;
        $payload['fp']       = $fp;
        $payload['key']      = $key;
        $payload['cache']    = 'miss';
        $payload['built_at'] = time();
        StreamCache::put($key, $payload, StreamCache::SCOPE_BOOT, self::TTL);
        return $payload;
    }

    /** Keshni yangilashga majbur qilish (yangi post/poster uchun). */
    public static function refresh(array $playback, array $ctx = [])
    {
        $key = self::key($playback, $ctx);
        StreamCache::forget($key, StreamCache::SCOPE_BOOT);
        return self::load($playback, $ctx);
    }

    /**
     * Faqat shu videoning `boot` yozuvini o'chirish.
     * `api/video-index.php` birinchi tomoshabin topgan indeksni saqlaganda
     * chaqiriladi — keyingi ochilishda yangi xarita darhol `__WCBOOT` ga kiradi.
     */
    public static function forgetBoot($ch, $post)
    {
        $ch = trim((string) $ch);
        if ($ch === '' || (int) $post <= 0) return false;
        $ok = false;
        // Katalogda `@kanal` ko'rinishida saqlangan bo'lishi mumkin —
        // ikkala variantdagi yozuvni ham o'chiramiz.
        foreach (array_unique([$ch, ltrim($ch, '@')]) as $v) {
            if ($v !== '') {
                $ok = (bool) StreamCache::forget(
                    sha1('tg:' . $v . '/' . (int) $post), StreamCache::SCOPE_BOOT
                ) || $ok;
            }
        }
        return $ok;
    }

    private static function key(array $playback, array $ctx = [])
    {
        if (!empty($playback['channel']) && !empty($playback['post'])) {
            return sha1('tg:' . $playback['channel'] . '/' . (int) $playback['post']);
        }
        $cid = (int) ($ctx['content_id'] ?? 0);
        if ($cid > 0) {
            return sha1('ct:' . $cid . ':' . (int) ($ctx['episode_id'] ?? 0));
        }
        return sha1('url:' . (string) ($playback['url'] ?? ''));
    }

    /** TgMeta bir marta o'qiladi — ham barmoq izi, ham build() uchun. */
    private static function meta(array $playback, array $ctx = [])
    {
        $ch = (string) ($playback['channel'] ?? '');
        $post = (int) ($playback['post'] ?? 0);
        if ($ch === '' || $post <= 0) return null;
        try {
            $m = TgMeta::get($ch, $post);
            return is_array($m) ? $m : null;
        } catch (Throwable $e) {
            return null;   // meta jadvali yo'q bo'lsa ham sahifa ishlaydi
        }
    }

    /**
     * Kontent barmoq izi: doc_id + size (yoki lokal kontent uchun url).
     * Video almashtirilsa bu o'zgaradi → eski kesh avtomatik rad etiladi.
     */
    private static function fingerprint(array $playback, array $ctx = [], $meta = null)
    {
        $ch = (string) ($playback['channel'] ?? '');
        $post = (int) ($playback['post'] ?? 0);
        if ($ch !== '' && $post > 0) {
            return 'tg:' . (string) ($meta['id'] ?? '') . ':' . (int) ($meta['size'] ?? 0);
        }
        return 'ct:' . (int) ($ctx['content_id'] ?? 0) . ':'
            . (int) ($ctx['episode_id'] ?? 0) . ':'
            . sha1((string) ($playback['url'] ?? ''));
    }

    /** Eskirgan yozuvga tegishli indeks va prefikslarni o'chirish. */
    private static function discardStale(array $cached, array $playback, array $ctx, $meta)
    {
        $ch = (string) ($playback['channel'] ?? '');
        $post = (int) ($playback['post'] ?? 0);
        if ($ch === '' || $post <= 0) return;

        $docKey = $ch . '/' . $post;
        $old = $cached['sharedDoc'][$docKey] ?? null;
        if (!is_array($old)) $old = $cached['index'] ?? null;
        if (!is_array($old)) return;

        $oldDoc  = (string) ($old['id'] ?? $old['doc'] ?? '');
        $oldSize = (int) ($old['size'] ?? 0);
        if ($oldDoc === '' || $oldSize <= 0) return;

        // Yangi meta hali olinmagan bo'lsa, eskisini o'chirmaymiz — keyingi
        // ochilishda meta tayyor bo'lganda solishtirib o'chiriladi.
        if (!is_array($meta)) return;
        if ((string) ($meta['id'] ?? '') === $oldDoc
            && (int) ($meta['size'] ?? 0) === $oldSize) return;

        VideoIndex::forget($oldDoc, $oldSize);
        PrefixStore::forget($oldDoc);
    }

    private static function build(array $playback, array $ctx = [], $meta = null)
    {
        $out = [
            'playback'  => self::safePlayback($playback),
            'embed'     => null,
            'sharedDoc' => [],   // file_reference YO'Q — faqat umumiy maydonlar
            'preview'   => [],
            // MP4 indeks xaritasi (moov o'rni + ixtiyoriy keyframe jadvali).
            // Birinchi ochilishda bo'sh — brauzer topgandan keyin yoziladi.
            'index'     => null,
            'hls'       => self::hlsReady(),
            'topic'     => null,
            // r2-sign.php?info=1 JAVOBI SQLGA YOZILMAYDI: undagi HMAC imzo
            // vaqtga bog'liq (exp), 6 soatlik keshda imzo eskirib qolardi.
            // Bu GLOBAL sozlama bo'lib, HTTP darajasida 5 daqiqa keshlanadi.
        ];

        $ch   = (string) ($playback['channel'] ?? '');
        $post = (int) ($playback['post'] ?? 0);
        if ($ch !== '' && $post > 0) {
            $key = $ch . '/' . $post;

            // --- ommaviy kanal: anonim CDN manzili + embed tekshiruvi ----------
            if (preg_match('/^[A-Za-z0-9_]{3,64}$/', $ch) && !preg_match('/^c\d+$/i', $ch)) {
                try {
                    $res  = (new TgResolve())->resolve('https://t.me/' . rawurlencode($ch) . '/' . $post);
                    $cdn  = self::allowedCdn($res['video'] ?? null);
                    // Hech qanday ma'lumot kelmadi (t.me ga ulanib bo'lmadi):
                    // "not_found" deb keshlamaymiz — aks holda ishlaydigan
                    // embed 6 soatga o'chirib qo'yilardi. JS eski
                    // api/tg-embed.php yo'lini ishlataveradi.
                    $hasData = !empty($res['has_post']) || !empty($res['media_big'])
                        || !empty($res['embed_ok']) || $cdn !== null;
                    $out['embed'] = $hasData ? [
                        'playable' => !empty($res['embed_ok']) && $cdn !== null,
                        'reason'   => !empty($res['media_big']) ? 'too_big'
                            : (empty($res['has_post']) ? 'not_found'
                            : ($cdn === null ? 'no_video' : 'ok')),
                        'cdn'    => $cdn,
                        'poster' => self::allowedCdn($res['image'] ?? null),
                    ] : ['playable' => false, 'reason' => 'unknown', 'cdn' => null, 'poster' => null];
                } catch (Throwable $e) {
                    // t.me javob bermadi — embed'ni yoqmagan deb belgilamaymiz.
                    $out['embed'] = ['playable' => false, 'reason' => 'unknown', 'cdn' => null, 'poster' => null];
                }
            } else {
                // xususiy kanal: t.me/c/<id>/<post> — anonim CDN yo'q.
                $out['embed'] = ['playable' => false, 'reason' => 'private_channel', 'cdn' => null, 'poster' => null];
            }

            // --- doc ma'lumoti: faqat umumiy qism (chipta YO'Q) -----------------
            $m = is_array($meta) ? $meta : TgMeta::get($ch, $post);
            if (is_array($m)) {
                $docId = (string) ($m['id'] ?? '');
                $docSz = (int) ($m['size'] ?? 0);
                $out['sharedDoc'][$key] = [
                    'id'   => $docId,
                    'ah'   => (string) ($m['ah'] ?? ''),
                    'dc'   => (int) ($m['dc'] ?? 0),
                    'size' => $docSz,
                    'mime' => (string) ($m['mime'] ?? 'video/mp4'),
                    'fn'   => (string) ($m['fn'] ?? ''),
                    'w'    => (int) ($m['w'] ?? 0),
                    'h'    => (int) ($m['h'] ?? 0),
                    'dur'  => (int) ($m['dur'] ?? 0),
                ];

                // Issiq yo'l: indeks xaritasi bazada tayyor bo'lsa, uni ham
                // HTML/SPA javobiga qo'shamiz — SW endi moov o'rnini qidirish
                // uchun qo'shimcha so'rov yubormaydi.
                if ($docId !== '' && $docSz > 0) {
                    $idx = VideoIndex::get($docId, $docSz);
                    if (is_array($idx)) $out['index'] = $idx;
                }
            }

            // --- 1-s instant preview ------------------------------------------
            $pv = TgPreview::get($ch, $post);
            if (is_array($pv)) {
                $out['preview'][$key] = [
                    'ch'      => $pv['ch'] ?? $ch,
                    'p'       => $pv['p'] ?? $post,
                    'size'    => (int) ($pv['size'] ?? 0),
                    'mime'    => (string) ($pv['mime'] ?? ''),
                    'w'       => (int) ($pv['w'] ?? 0),
                    'h'       => (int) ($pv['h'] ?? 0),
                    'dur'     => (int) ($pv['dur'] ?? 0),
                    'instant' => $pv['instant'] ?? null,
                ];
            }
        }

        // --- izoh mavzusi (kontent bo'yicha bitta) -----------------------------
        $cid = (int) ($ctx['content_id'] ?? 0);
        if ($cid > 0) {
            try {
                $tid = (new TgTopics())->topicId(TgTopics::SCOPE_CONTENT, $cid);
                if ((int) $tid > 0) {
                    $out['topic'] = (int) $tid;
                }
            } catch (Throwable $e) {
                // ixtiyoriy
            }
        }

        return $out;
    }

    /** Faqat frontendga kerakli maydonlar — ichki ma'lumot chiqmaydi. */
    private static function safePlayback(array $pb)
    {
        $keys = ['type', 'url', 'mime', 'seek', 'poster', 'channel', 'post',
                 'warning', 'title', 'start', 'duration', 'deep'];
        $out = [];
        foreach ($keys as $k) {
            if (array_key_exists($k, $pb)) {
                $out[$k] = $pb[$k];
            }
        }
        return $out;
    }

    /** Faqat Telegram CDN domenlariga ruxsat (SSRF himoyasi). */
    private static function allowedCdn($url)
    {
        $url = trim((string) $url);
        if ($url === '' || !preg_match('#^https://#i', $url)) {
            return null;
        }
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        if ($host === '' || preg_match('#(^|\.)(telesco\.pe|cdn-telegram\.org)$#', $host) !== 1) {
            return null;
        }
        return $url;
    }

    private static function hlsReady()
    {
        if (!defined('HLS_CACHE_DIR') || !is_dir(HLS_CACHE_DIR)) {
            return false;
        }
        $hls = rtrim(HLS_CACHE_DIR, '/\\') . DIRECTORY_SEPARATOR . sha1('hls:' . (string) ($GLOBALS['__wc_hls_url'] ?? ''));
        return is_file($hls . DIRECTORY_SEPARATOR . 'index.m3u8');
    }

}
