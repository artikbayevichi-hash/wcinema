<?php
// ============================================================================
// VideoIndex — video uchun MP4 indeks xaritasining doimiy keshi
// ============================================================================
//
// NIMA SAQLANADI:
//   • moov qutisinining ANIQ o'rni: {inHead:true} yoki {start, len}
//   • ixtiyoriy keyframe jadvali: [[sekund, bayt ofseti], ...]
//
// NIMA SAQLANMAYDI:
//   • video baytlari (faqat indeksning O'RNI, indeksning o'zi ham yo'q);
//   • file_reference / access_hash / foydalanuvchi sessiyasi / cookie / IP.
//
// KALIT: doc_id + size. Film almashtirilsa (post yangilansa) doc_id yoki
// hajm o'zgaradi — eski xarita avtomatik ishlamay qoladi.
//
// KELIB CHIQISHI: birinchi tomoshabinning brauzeri SW orqali moov o'rnini
// aniqlaydi va `api/video-index.php` ga yuboradi. Keyingi tomoshabinlar uni
// `watch.php` / `api/episode.php` orqali `__WCBOOT` ichida tayyor oladi.
// ============================================================================

require_once __DIR__ . '/StreamCache.php';

final class VideoIndex
{
    const V        = 1;
    const MAX_KF   = 4000;                  // 2 soatlik film uchun yetarli
    const MAX_LEN  = 8 * 1024 * 1024;       // SW dagi IDX_MAX bilan bir xil
    const TTL      = 604800;                // 7 kun (kontent o'zgarmasa yetarli)

    /** Faqat kontent kaliti — hech qanday foydalanuvchi ma'lumoti yo'q. */
    public static function key($doc, $size)
    {
        return sha1('vi:' . self::doc($doc) . ':' . (int) $size);
    }

    /** Hujjat ID'si — faqat raqam, uzunligi cheklangan. */
    private static function doc($v)
    {
        $v = trim((string) $v);
        return preg_match('/^[0-9]{1,20}$/', $v) ? $v : '';
    }

    /**
     * Keshdan o'qish. Noto'g'ri/eski formatdagi yozuv rad etiladi.
     * @return array|null
     */
    public static function get($doc, $size)
    {
        $doc  = self::doc($doc);
        $size = (int) $size;
        if ($doc === '' || $size <= 0) return null;

        $p = StreamCache::get(self::key($doc, $size), StreamCache::SCOPE_INDEX);
        if (!is_array($p) || (int) ($p['v'] ?? 0) !== self::V) return null;
        if ((string) ($p['doc'] ?? '') !== $doc || (int) ($p['size'] ?? 0) !== $size) return null;
        if (!is_array($p['moov'] ?? null)) return null;
        return $p;
    }

    /**
     * Indeks xaritasini yozish. Kirish qattiq filtrelanadi — endpoint orqali
     * kelgan hech qanday qo'shimcha maydon bazaga o'tmaydi.
     *
     * @return bool
     */
    public static function put($doc, $size, array $data)
    {
        $doc  = self::doc($doc);
        $size = (int) $size;
        if ($doc === '' || $size <= 0) return false;

        $moov = self::cleanMoov($data['moov'] ?? null, $size);
        if ($moov === null) return false;   // indekssiz yozuvning foydasi yo'q

        $payload = [
            'v'       => self::V,
            'doc'     => $doc,
            'size'    => $size,
            'moov'    => $moov,
            'kf'      => self::cleanKeyframes($data['kf'] ?? [], $size),
            'dur'     => max(0, min(86400, (int) ($data['dur'] ?? 0))),
            'builtAt' => time(),
        ];

        return (bool) StreamCache::put(
            self::key($doc, $size), $payload, StreamCache::SCOPE_INDEX, self::TTL
        );
    }

    public static function forget($doc, $size)
    {
        $doc = self::doc($doc);
        if ($doc === '') return false;
        return (bool) StreamCache::forget(self::key($doc, (int) $size), StreamCache::SCOPE_INDEX);
    }

    /**
     * Yuboruvchi haqiqatan ham katalogdagi shu video haqida gapiryaptimi?
     * Faqat kontent darajasidagi tekshiruv — foydalanuvchi bilan ish yo'q.
     */
    public static function known($ch, $post, $doc, $size)
    {
        $ch   = strtolower(preg_replace('/[^A-Za-z0-9_]/', '', (string) $ch));
        $post = (int) $post;
        $doc  = self::doc($doc);
        $size = (int) $size;
        if ($ch === '' || $post <= 0 || $doc === '' || $size <= 0) return false;

        $db = Database::getInstance();

        // 1) Doimiy metama'lumot bor bo'lsa — doc_id/hajm AYNAN mos kelishi shart.
        try {
            $row = $db->fetchOne(
                'SELECT doc_id, size FROM `telegram_meta` WHERE `channel`=? AND `post`=? LIMIT 1',
                [$ch, $post]
            );
            if ($row) {
                if (!empty($row['doc_id']) && (string) $row['doc_id'] !== $doc) return false;
                if ((int) ($row['size'] ?? 0) > 0 && (int) $row['size'] !== $size) return false;
                return true;
            }
        } catch (Throwable $e) {
            // jadval bo'lmasligi mumkin — katalog tekshiruviga o'tamiz.
        }

        // 2) Katalogda shu (kanal, post) bor bo'lsa — qabul qilamiz.
        $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $ch) . '%';
        $re   = '#(?:t|telegram)\.me/(?:c/\d+|' . preg_quote($ch, '#') . ')/'
              . $post . '(?:[/?\#]|$)#i';
        try {
            foreach (['episodes', 'reels'] as $tbl) {
                $rows = $db->fetchAll(
                    "SELECT video_url FROM `{$tbl}` WHERE video_url LIKE ? LIMIT 100", [$like]
                );
                foreach ($rows as $r) {
                    if (preg_match($re, (string) ($r['video_url'] ?? ''))) return true;
                }
            }
        } catch (Throwable $e) {
            return false;
        }
        return false;
    }

    /** SW yuborgan indeks o'rnini filterlash. */
    private static function cleanMoov($m, $size)
    {
        if (!is_array($m)) return null;
        if (!empty($m['inHead'])) return ['inHead' => true];

        $start = (int) ($m['start'] ?? -1);
        $len   = (int) ($m['len'] ?? 0);
        if ($start < 0 || $len <= 0 || $len > self::MAX_LEN) return null;
        if ($start >= $size) return null;
        if ($start + $len > $size) $len = $size - $start;
        return ['start' => $start, 'len' => $len];
    }

    /** Ixtiyoriy keyframe jadvali: faqat [sekund, ofset] juftliklari. */
    private static function cleanKeyframes($list, $size)
    {
        if (!is_array($list)) return [];
        $out = [];
        foreach ($list as $pair) {
            if (!is_array($pair) || count($pair) < 2) continue;
            $t   = $pair[0];
            $off = $pair[1];
            if (!is_numeric($t) || !is_numeric($off)) continue;
            $t   = (float) $t;
            $off = (int) $off;
            if ($t < 0 || $t > 86400 || $off < 0 || $off >= $size) continue;
            $out[] = [round($t, 3), $off];
            if (count($out) >= self::MAX_KF) break;
        }
        return $out;
    }
}
