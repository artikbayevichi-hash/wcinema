<?php
// ============================================================================
// includes/FastStart.php — MP4 moov atomini fayl boshiga ko'chirish
// ============================================================================
// FFmpeg mavjud bo'lsa MP4 konteynerini qayta kodlamasdan (`-c copy`)
// faststart qiladi. FFmpeg yo'q yoki konvertatsiya muvaffaqiyatsiz bo'lsa,
// asl fayl saqlanadi va yuklash davom etadi. MP4 bo'lmagan fayllar o'tkazib
// yuboriladi.

final class FastStart
{
    /**
     * Faststart qilingan MP4'ni alohida vaqtinchalik faylga tayyorlaydi.
     * Manba o'zgarmaydi; chaqiruvchi upload tugagach cleanup() chaqiradi.
     *
     * @return array{path:string,name:string,optimized:bool,temporary:bool}
     */
    public static function prepare($source, $originalName)
    {
        $source = (string) $source;
        $originalName = (string) $originalName;
        $result = [
            'path' => $source,
            'name' => $originalName,
            'optimized' => false,
            'temporary' => false,
        ];

        if (!is_file($source)
            || strtolower(pathinfo($originalName, PATHINFO_EXTENSION)) !== 'mp4'
            || !defined('FASTSTART_ENABLED') || !FASTSTART_ENABLED
            || !defined('FFMPEG_BIN') || trim((string) FFMPEG_BIN) === ''
            || !function_exists('proc_open')
            || self::isFastStart($source)) {
            return $result;
        }

        $output = @tempnam(dirname($source), 'faststart_');
        if ($output === false) {
            return $result;
        }

        // FFMPEG_BIN faqat server sozlamasidan olinadi, barcha parametrlar va
        // yo'llar shell uchun alohida quote qilinadi. MP4 output format aniq
        // berilgani uchun vaqtinchalik fayl kengaytmasi talab qilinmaydi.
        $command = escapeshellarg((string) FFMPEG_BIN)
            . ' -nostdin -hide_banner -loglevel error -y -i '
            . escapeshellarg($source)
            . ' -map 0 -c copy -movflags +faststart -f mp4 '
            . escapeshellarg($output)
            . ' 2>&1';

        $pipes = [];
        $process = @proc_open($command, [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
        ], $pipes, dirname($source));

        if (!is_resource($process)) {
            @unlink($output);
            return $result;
        }

        if (isset($pipes[0]) && is_resource($pipes[0])) {
            fclose($pipes[0]);
        }
        $diagnostic = '';
        if (isset($pipes[1]) && is_resource($pipes[1])) {
            $diagnostic = (string) stream_get_contents($pipes[1]);
            fclose($pipes[1]);
        }
        $exitCode = proc_close($process);

        if ($exitCode !== 0 || !is_file($output) || (int) @filesize($output) <= 0) {
            @unlink($output);
            error_log('[FastStart] FFmpeg optimization failed (exit ' . (int) $exitCode . ').'
                . ($diagnostic !== '' ? ' ' . substr(trim($diagnostic), -1000) : ''));
            return $result;
        }

        $result['path'] = $output;
        $result['name'] = pathinfo($originalName, PATHINFO_FILENAME) . '.mp4';
        $result['optimized'] = true;
        $result['temporary'] = true;
        return $result;
    }

    /** Yangi import qilingan faylni joyida almashtiradi; xatoda asl fayl tiklanadi. */
    public static function optimizeInPlace($path)
    {
        $path = (string) $path;
        $prepared = self::prepare($path, basename($path));
        if (empty($prepared['optimized'])) {
            return false;
        }

        $backup = $path . '.faststart-backup-' . bin2hex(random_bytes(5));
        if (!@rename($path, $backup)) {
            self::cleanup($prepared);
            return false;
        }
        if (!@rename($prepared['path'], $path)) {
            @rename($backup, $path);
            self::cleanup($prepared);
            return false;
        }

        @unlink($backup);
        return true;
    }

    /** Vaqtinchalik optimallashtirilgan nusxani o'chiradi. */
    public static function cleanup(array $prepared)
    {
        if (!empty($prepared['temporary']) && !empty($prepared['path']) && is_file($prepared['path'])) {
            @unlink($prepared['path']);
        }
    }

    /** MP4 atomlarini o'qib, moov atom mdat'dan oldinligini tekshiradi. */
    private static function isFastStart($path)
    {
        $size = @filesize($path);
        $fp = @fopen($path, 'rb');
        if ($size === false || !$fp) {
            return false;
        }

        $position = 0;
        $moovPosition = null;
        $mdatPosition = null;
        $boxes = 0;
        while ($position + 8 <= $size && $boxes++ < 10000) {
            if (fseek($fp, $position) !== 0) {
                break;
            }
            $header = fread($fp, 8);
            if (!is_string($header) || strlen($header) !== 8) {
                break;
            }

            $boxSize = (int) unpack('Nvalue', substr($header, 0, 4))['value'];
            $type = substr($header, 4, 4);
            $headerSize = 8;
            if ($boxSize === 1) {
                $extended = fread($fp, 8);
                if (!is_string($extended) || strlen($extended) !== 8) {
                    break;
                }
                $parts = unpack('Nhigh/Nlow', $extended);
                $boxSize = (int) ($parts['high'] * 4294967296 + $parts['low']);
                $headerSize = 16;
            } elseif ($boxSize === 0) {
                $boxSize = $size - $position;
            }

            if ($boxSize < $headerSize || $position + $boxSize > $size) {
                break;
            }
            if ($type === 'moov') {
                $moovPosition = $position;
            } elseif ($type === 'mdat' && $mdatPosition === null) {
                $mdatPosition = $position;
            }
            if ($moovPosition !== null && $mdatPosition !== null) {
                fclose($fp);
                return $moovPosition < $mdatPosition;
            }
            $position += $boxSize;
        }

        fclose($fp);
        return false;
    }
}
