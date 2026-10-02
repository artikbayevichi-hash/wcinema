<?php
// ============================================================================
// TgResolve - Telegram post havolasini hal qilish (rasm/video topish)
// ============================================================================
// Nima uchun: foydalanuvchilar media-ni Telegram'ga yuklab, t.me post
// havolasini qo'yishadi (masalan https://t.me/Kinolark/9147). Bu havola
// HTML sahifa — <video>/<img> uchun to'g'ridan-to'g'ri yaroqsiz. Server
// sahifani o'qib, ichidagi og:image / og:video (Telegram CDN) manzillarini
// topadi. Natija uploads/tg_cache.json da 6 soat keshlanadi.
//
// Xavfsizlik (SSRF): faqat t.me / telegram.me domenlariga ruxsat beriladi.
// Rasm yuklab olish esa faqat Telegram CDN (telesco.pe / cdn-telegram.org)
// manzillaridan amalga oshiriladi.
// ============================================================================

class TgResolve {

    const TTL = 21600;               // kesh muddati: 6 soat
    const CACHE_FILE = 'uploads/tg_cache.json';
    const MAX_IMAGE_BYTES = 8388608; // poster rasm chegi: 8 MB
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

    /** t.me post manzilini ochadi: ['ok','image','video','title','has_video','has_post','embed_ok','reason','cached'] */
    public function resolve($url) {
        $bad = [
            'ok' => false, 'image' => null, 'video' => null,
            'title' => null, 'has_video' => false, 'has_post' => false,
            'embed_ok' => false, 'media_big' => false, 'reason' => 'Manzil noto‘g‘ri', 'cached' => false,
        ];
        $url = trim((string) $url);
        if (!preg_match('#^https?://#i', $url)) {
            $bad['reason'] = 'http/https manzil kerak';
            return $bad;
        }
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        if (!preg_match('#(^|\.)(t\.me|telegram\.me)$#', $host)) {
            $bad['reason'] = 'Faqat t.me havolalari qabul qilinadi';
            return $bad;
        }
        $path = (string) parse_url($url, PHP_URL_PATH);
        if (!preg_match('#^/(?:c/)?[A-Za-z0-9_]+/\d+$#', $path)) {
            $bad['reason'] = 'Telegram post havolasi emas';
            return $bad;
        }

        // v3: media_big ("Media is too big") aniqlash qo'shilgan (2026) — eski keshlar qayta to'ldiriladi. v2: embed-tahlil qo'shilgan.
        $key = sha1('v3|' . $url);
        $cached = $this->readCache($key);
        if ($cached !== null) {
            $cached['ok']     = !empty($cached['ok']);
            $cached['cached'] = true;
            return $cached;
        }

        $out = $this->fetchPage($url);
        // Telegram (2025+) anonim t.me sahifalarida post mazmuni endi
        // ko'rinmaydi — haqiqiy holatni "?embed=1&mode=tme" widget
        // sahifasidan aniqlaymiz: post bormi, media ko'rinadimi, videomi.
        $emb = $this->fetchEmbed($url);
        $out['has_post']  = !empty($emb['has_post']);
        $out['embed_ok']  = !empty($emb['embed_ok']);
        $out['media_big'] = !empty($emb['media_big']);
        $out['has_video'] = $out['has_video'] || !empty($emb['has_video']) || !empty($emb['video']);
        if (empty($out['video']) && !empty($emb['video'])) {
            $out['video'] = $emb['video'];
        }
        $out['cached'] = false;
        $this->writeCache($key, $out);
        return $out;
    }

    /**
     * "?embed=1&mode=tme" (widget) sahifasini tahlil qiladi.
     *
     * Telegram 2025+ oddiy t.me sahifasida post mazmunini anonimga
     * yashirib qo'ydi — faqat embed varianti widget HTML'ini beradi.
     * Bu yerda aniqlanadi:
     *   has_post  - post widget bormi (post mavjud)
     *   embed_ok  - media tashqarida ko'rinadimi (aksi: "Please open
     *               Telegram to view this post")
     *   media_big - media tashqarida ko'rinmaydi, chunki "Media is too
     *               big" (katta videolar/filmlar Telegram veb-playerida
     *               o'ynamaydi)
     *   video     - post ichidagi HAQIQIY video (CDN <video src="...">)
     *   has_video - postda video widget bormi
     */
    private function fetchEmbed($url) {
        $empty = ['has_post' => false, 'embed_ok' => false, 'media_big' => false, 'video' => null, 'has_video' => false];
        $q = (string) parse_url($url, PHP_URL_QUERY);
        $frame = $url . ($q !== '' ? '&' : '?') . 'embed=1&mode=tme';

        $ch = curl_init($frame);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 3,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_USERAGENT      => self::UA,
            CURLOPT_ENCODING       => '',
            CURLOPT_HTTPHEADER     => ['Accept-Language: en-US,en;q=0.9'],
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if (!is_string($body) || $code < 200 || $code >= 400 || strlen($body) < 500) {
            return $empty;
        }

        $hasPost = (bool) preg_match('#class="[^"]*tgme_widget_message#i', $body);
        // Media yashirilgan bo'lsa Telegram shunday deb yozadi:
        //   "Please open Telegram to view this post" (VIEW IN TELEGRAM)
        $blocked = (bool) preg_match('#message_media_not_supported|text_not_supported_wrap#i', $body);
        // Katta video (film o'lchamidagi) bo'lsa:
        //   "Media is too big" — Telegram veb-player faqat kichik
        //   videolarni tashqarida o'ynatadi, kattasini o'ynatmaydi.
        $mediaBig = (bool) preg_match('#message_media_not_supported_label[^>]*>\s*Media is too big#i', $body);

        $video = null;
        if (preg_match('#<video[^>]+src=["\']([^"\']+)["\']#i', $body, $m)) {
            $val = html_entity_decode($m[1], ENT_QUOTES, 'UTF-8');
            if (preg_match('#^https?://#i', $val)) {
                $video = $val;
            }
        }
        $hasVideo = !empty($video)
            || (bool) preg_match('#class="[^"]*tgme_widget_message_video#i', $body);

        return [
            'has_post'  => $hasPost,
            'embed_ok'  => $hasPost && !$blocked,
            'media_big' => $hasPost && $mediaBig,
            'video'     => $video,
            'has_video' => $hasVideo,
        ];
    }

    /** t.me sahifasidan CDN manzillarni ajratib oladi. */
    private function fetchPage($url) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 3,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_USERAGENT      => self::UA,
            CURLOPT_ENCODING       => '',
            CURLOPT_HTTPHEADER     => ['Accept-Language: en-US,en;q=0.9'],
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $out = [
            'ok' => $code >= 200 && $code < 400 && is_string($body) && strlen($body) > 1000,
            'image' => null, 'video' => null, 'title' => null,
            'has_video' => false, 'has_post' => false, 'embed_ok' => false, 'media_big' => false,
            'reason' => 'HTTP ' . $code, 'cached' => false,
        ];
        if (!$out['ok']) {
            return $out;
        }

        // Post ko'rinadimi (kanal link-preview yoqilgan bo'lsa widget bor)
        $out['has_post'] = (bool) preg_match('#class="[^"]*tgme_widget_message#i', $body);

        // og:* meta-teglari (atribut tartibi har xil bo'ladi — butun tegni olamiz)
        foreach (['image' => 'og:image', 'video' => 'og:video', 'title' => 'og:title'] as $field => $prop) {
            if (preg_match('#<meta[^>]+property=["\']' . preg_quote($prop, '#') . '["\'][^>]*>#i', $body, $meta)
                && preg_match('#content=["\']([^"\']+)["\']#i', $meta[0], $m)) {
                $val = html_entity_decode($m[1], ENT_QUOTES, 'UTF-8');
                if (preg_match('#^https?://#i', $val)) {
                    $out[$field] = $val;
                }
            }
        }

        // og:video topilmasa — <video src> dan olib ko'ramiz
        if (!$out['video'] && preg_match('#<video[^>]+src=["\']([^"\']+)["\']#i', $body, $m)) {
            $val = html_entity_decode($m[1], ENT_QUOTES, 'UTF-8');
            if (preg_match('#^https?://#i', $val)) {
                $out['video'] = $val;
            }
        }

        // Post ichida HAQIQIY video bormi: og:video / <video> / video widget
        if ($out['video']
            || preg_match('#class="[^"]*tgme_widget_message_video#i', $body)
            || preg_match('#<video[^>]+src=#i', $body)) {
            $out['has_video'] = true;
        }
        return $out;
    }

    /** Resolved rasm manzili (CDN) yoki null. */
    public function image($url) {
        $r = $this->resolve($url);
        return $r['image'] ?? null;
    }

    /** Resolved video manzili (CDN) yoki null. */
    public function video($url) {
        $r = $this->resolve($url);
        return $r['video'] ?? null;
    }

    /**
     * t.me post rasm (poster) ni SERVERGA yuklab oladi.
     *
     * Agar $url t.me post havolasi bo'lsa, avval og:image CDN topiladi
     * (kesh orqali), so'ngra u uploads/posters/ ga saqlanadi va
     * "uploads/posters/tg_....ext" qaytariladi. Muvaffaqiyatsiz -> null.
     */
    public function downloadImage($url) {
        $src = trim((string) $url);
        $host = strtolower((string) parse_url($src, PHP_URL_HOST));
        if (preg_match('#(^|\.)(t\.me|telegram\.me)$#', $host)) {
            $src = (string) $this->image($src);
            if (!preg_match('#^https?://#i', $src)) {
                return null;
            }
        }
        if (!preg_match('#^https?://#i', $src)) {
            return null;
        }

        // Xavfsizlik: faqat Telegram CDN manzillaridan yuklaymiz
        $dstHost = strtolower((string) parse_url($src, PHP_URL_HOST));
        if (!preg_match('#(^|\.)(telesco\.pe|cdn-telegram\.org)$#', $dstHost)
            && !preg_match('#(^|\.)t\.me$#', $dstHost)) {
            return null;
        }

        $ext = 'jpg';
        if (preg_match('#\.([a-z0-9]{3,4})(\?|$)#i', $src, $m)
            && in_array(strtolower($m[1]), ['jpg', 'jpeg', 'png', 'webp', 'gif'], true)) {
            $ext = strtolower($m[1] === 'jpeg' ? 'jpg' : $m[1]);
        }

        $dir = UPLOAD_DIR . 'posters';
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            return null;
        }

        $data = '';
        $ch = curl_init($src);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 4,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_USERAGENT      => self::UA,
            CURLOPT_WRITEFUNCTION  => function ($ch, $chunk) use (&$data) {
                $left = self::MAX_IMAGE_BYTES - strlen($data);
                if ($left <= 0) {
                    return 0; // chek: oshirib yubormaymiz
                }
                $take = min(strlen($chunk), $left);
                $data .= substr($chunk, 0, $take);
                return $take;
            },
        ]);
        $ok = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $mime = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_close($ch);

        if (!$ok || $code < 200 || $code >= 400 || strlen($data) < 200) {
            return null;
        }
        if (stripos($mime, 'png') !== false)        $ext = 'png';
        elseif (stripos($mime, 'webp') !== false)   $ext = 'webp';
        elseif (stripos($mime, 'gif') !== false)    $ext = 'gif';
        elseif (stripos($mime, 'jpeg') !== false || stripos($mime, 'jpg') !== false) $ext = 'jpg';

        $name = 'tg_' . bin2hex(random_bytes(10)) . '.' . $ext;
        if (@file_put_contents($dir . '/' . $name, $data) === false) {
            return null;
        }
        @chmod($dir . '/' . $name, 0644);
        return 'uploads/posters/' . $name;
    }

    // ---------------------------------------------------------------- kesh
    private function cachePath() {
        return UPLOAD_DIR . 'tg_cache.json';
    }

    private function load() {
        $p = $this->cachePath();
        if (!is_file($p)) {
            return [];
        }
        $arr = json_decode((string) @file_get_contents($p), true);
        return is_array($arr) ? $arr : [];
    }

    private function readCache($key) {
        $arr = $this->load();
        if (!isset($arr[$key]) || !is_array($arr[$key])) {
            return null;
        }
        if ((int) ($arr[$key]['at'] ?? 0) + self::TTL < time()) {
            return null;
        }
        return $arr[$key];
    }

    private function writeCache($key, $row) {
        $arr = $this->load();
        $arr[$key] = [
            'at'     => time(),
            'ok'     => !empty($row['ok']),
            'image'  => $row['image'] ?? null,
            'video'  => $row['video'] ?? null,
            'title'  => $row['title'] ?? null,
            'has_video' => !empty($row['has_video']),
            'has_post'  => !empty($row['has_post']),
            'embed_ok'  => !empty($row['embed_ok']),
            'media_big' => !empty($row['media_big']),
            'reason' => $row['reason'] ?? null,
        ];
        if (count($arr) > 1000) {
            $arr = array_slice($arr, -500, 500, true);
        }
        @file_put_contents($this->cachePath(), json_encode($arr, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }
}