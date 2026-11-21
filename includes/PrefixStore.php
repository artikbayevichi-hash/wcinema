<?php
// ============================================================================
// PrefixStore — mahalliy head/tail prefikslari uchun yagona saqlovchi
// ============================================================================
// Maqsad: kontent almashtirilganda ESKI prefiks ishlamay qolishi va o'chirilishi.
//
// Kalit: doc_id + size. Manifest faqat {size, head, tail, at} saqlaydi —
// file_reference, sessiya, cookie, IP yoki foydalanuvchi ID'si YO'Q.
//
// Eski yozuvlar ikki yo'l bilan chiqariladi:
//   1) `at` bo'yicha TTL (7 kun) tugaganda;
//   2) 500 doc limiti to'lganda eng eskisi evakuatsiya qilinadi (429 yo'q).
// ============================================================================

final class PrefixStore
{
    const TTL      = 604800; // 7 kun
    const MAX_DOCS = 500;

    public static function dir()
    {
        return dirname(__DIR__) . '/storage/prefix';
    }

    public static function manifestFile()
    {
        return self::dir() . '/manifest.json';
    }

    public static function file($doc, $part)
    {
        $doc = preg_replace('/[^0-9]/', '', (string) $doc);
        if ($doc === '' || ($part !== 'head' && $part !== 'tail')) return '';
        return self::dir() . '/' . $doc . '.' . $part;
    }

    /** Manifestni o'qish. Faqat kontent maydonlari qaytariladi. */
    public static function read()
    {
        $raw = @file_get_contents(self::manifestFile());
        $m = $raw !== false ? json_decode((string) $raw, true) : null;
        if (!is_array($m)) return ['v' => 1, 'docs' => []];
        $docs = (isset($m['docs']) && is_array($m['docs'])) ? $m['docs'] : $m;
        return ['v' => 1, 'docs' => is_array($docs) ? $docs : []];
    }

    /** Atomic yozish. Qulflanishni chaqiruvchi bajaradi. */
    public static function write(array $m)
    {
        $dir = self::dir();
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) return false;
        if (!isset($m['docs']) || !is_array($m['docs'])) $m = ['v' => 1, 'docs' => []];
        $m['v'] = 1;
        $tmp = $dir . '/manifest.' . getmypid() . '.' . bin2hex(random_bytes(3)) . '.tmp';
        $ok = @file_put_contents(
            $tmp,
            json_encode($m, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
        ) !== false;
        if ($ok) $ok = @rename($tmp, self::manifestFile());
        if (!$ok) @unlink($tmp);
        return (bool) $ok;
    }

    /** Bir doc ning barcha prefiks fayllarini o'chirish. */
    public static function unlinkDoc($doc)
    {
        foreach (['head', 'tail'] as $part) {
            $f = self::file($doc, $part);
            if ($f !== '') @unlink($f);
        }
    }

    /**
     * Eskirgan va limitdan ortiq yozuvlarni o'chirib, manifestni yangilaydi.
     * @return int o'chirilgan doc soni
     */
    public static function prune(array &$m, $ttl = self::TTL, $max = self::MAX_DOCS)
    {
        if (!isset($m['docs']) || !is_array($m['docs'])) $m = ['v' => 1, 'docs' => []];
        $now = time();
        $removed = 0;
        foreach ($m['docs'] as $doc => $e) {
            $at = (int) (is_array($e) ? ($e['at'] ?? 0) : 0);
            if ($at > 0 && $now - $at > $ttl) {
                self::unlinkDoc($doc);
                unset($m['docs'][$doc]);
                $removed++;
            }
        }
        if (count($m['docs']) > $max) {
            uasort($m['docs'], static function ($a, $b) {
                return (int) (is_array($a) ? ($a['at'] ?? 0) : 0)
                     <=> (int) (is_array($b) ? ($b['at'] ?? 0) : 0);
            });
            foreach (array_keys($m['docs']) as $doc) {
                if (count($m['docs']) <= $max) break;
                self::unlinkDoc($doc);
                unset($m['docs'][$doc]);
                $removed++;
            }
        }
        return $removed;
    }

    /** Faqat hali amal qiladigan yozuvlar ( GET ?info=1 uchun ). */
    public static function visible($ttl = self::TTL)
    {
        $m = self::read();
        $now = time();
        $out = [];
        foreach ($m['docs'] as $doc => $e) {
            if (!is_array($e)) continue;
            $at = (int) ($e['at'] ?? 0);
            if ($at > 0 && $now - $at > $ttl) continue;   // eskirgan — ishlatilmaydi
            $out[(string) $doc] = $e;
        }
        return $out;
    }

    /** Kontent almashtirilganda eskisini butunlay o'chirish. */
    public static function forget($doc)
    {
        $doc = preg_replace('/[^0-9]/', '', (string) $doc);
        if ($doc === '') return false;
        $file = self::manifestFile();
        $lock = @fopen($file . '.lock', 'c+');
        if ($lock) @flock($lock, LOCK_EX);
        $m = self::read();
        unset($m['docs'][$doc]);
        $ok = self::write($m);
        if ($lock) { @flock($lock, LOCK_UN); fclose($lock); }
        self::unlinkDoc($doc);
        return $ok;
    }
}
