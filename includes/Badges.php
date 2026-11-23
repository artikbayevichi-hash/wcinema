<?php
// ============================================================================
// Badges — foydalanuvchiga xos sanoqlar uchun KICHIK, TEZ kesh
// ============================================================================
// Nima uchun kerak:
//   `notifications.php?action=count` va `dm.php?action=unread` har 15/30 s
//   da chaqirilardi. Millionlab tomoshabin video ko'rayotganda bu har soniyada
//   minglab MySQL COUNT so'rovi demak edi.
//
// Yechim:
//   1) ikki sanoq BITTA so'rovda (`api/badges.php`);
//   2) natija foydalanuvchi ID'si bilan keshlashadi:
//      - APCu bor bo'lsa -> jarayonlararo xotira (disk yo'q);
//      - yo'q bo'lsa -> storage/cache/badges/<uid>.json (bir fayl, glob yo'q);
//   3) yozuvlar (Notifications::add/markRead, DM::touchContacts/markRead)
//      keshni O'CHIRADI — shuning uchun TTL faqat xavfsizlik to'ri;
//   4) brauzer ham `Cache-Control: private` bilan 30 s ushlab turadi, ya'ni
//      kesh yaroqli bo'lsa SERVERGA UMUMAN so'rov ketmaydi.
//
// MUHIM: bu kesh FAQAT foydalanuvchiga xos (uid kalit). Video/post keshga
// aralashmaydi; `tg_me` kabi foydalanuvchi kiritgan qiymat kalit bo'lmaydi.
// ============================================================================

class Badges
{
    /** Xavfsizlik to'ri: yozuv eskirmay qolsa ham kesh 90 s dan keyin yangilanadi. */
    private const TTL = 90;

    /** APCu ishlayaptimi (CLI'da ko'pincha o'chirilgan bo'ladi). */
    private static function apcu(): bool
    {
        if (!function_exists('apcu_fetch') || !function_exists('apcu_store')) {
            return false;
        }
        return function_exists('apcu_enabled') ? apcu_enabled() : true;
    }

    private static function key(int $uid): string
    {
        return 'wc_badges_' . $uid;
    }

    private static function dir(): string
    {
        $d = dirname(__DIR__) . '/storage/cache/badges';
        if (!is_dir($d)) {
            @mkdir($d, 0777, true);
        }
        return $d;
    }

    private static function file(int $uid): string
    {
        return self::dir() . '/' . $uid . '.json';
    }

    /**
     * Keshdan qaytaradi yoki $cb ni BIR marta hisoblab keshga yozadi.
     *
     * @return array{upload?:mixed,unread?:mixed,dm?:mixed,recent?:array}
     */
    public static function remember(int $uid, callable $cb): array
    {
        $uid = (int) $uid;
        if ($uid <= 0) {
            return $cb();
        }

        if (self::apcu()) {
            $hit = apcu_fetch(self::key($uid), $ok);
            if ($ok && is_array($hit) && !empty($hit['_t']) && time() - (int) $hit['_t'] < self::TTL) {
                return $hit['_v'];
            }
        } else {
            $path = self::file($uid);
            if (is_file($path)) {
                $raw = @file_get_contents($path);
                $data = $raw ? json_decode($raw, true) : null;
                if (is_array($data) && isset($data['_t'], $data['_v'])
                    && time() - (int) $data['_t'] < self::TTL && is_array($data['_v'])) {
                    return $data['_v'];
                }
            }
        }

        $value = $cb();
        if (!is_array($value)) {
            $value = [];
        }
        $record = ['_t' => time(), '_v' => $value];

        if (self::apcu()) {
            @apcu_store(self::key($uid), $record, self::TTL);
        } else {
            @file_put_contents(
                self::file($uid),
                json_encode($record, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR),
                LOCK_EX
            );
        }
        return $value;
    }

    /** Bildirishnoma yoki DM o'zgarganda chaqiriladi. */
    public static function forget(int $uid): void
    {
        $uid = (int) $uid;
        if ($uid <= 0) {
            return;
        }
        if (self::apcu()) {
            @apcu_delete(self::key($uid));
        }
        $path = self::file($uid);
        if (is_file($path)) {
            @unlink($path);
        }
    }
}
