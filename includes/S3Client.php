<?php
// ============================================================================
// S3Client — S3-mos saqlash (Cloudflare R2 / Backblaze B2) uchun minimal klient
// ============================================================================
// Nima uchun: HLS segmentlari o'zgarmas fayllar. Ularni uy kompyuteridan
// tarqatish "1000 tomoshabin = 2-4 Gbit/s upload" degani. Segmentlarni R2/B2
// ga yuklab, tomoshabinga o'sha yerdan berish esa upload muammosini yo'q
// qiladi (R2 chiqish trafigi uchun pul olmaydi).
//
// Faqat kerakli minimal amallar: PutObject, HeadObject, DeleteObject.
// AWS SigV4 imzosi tashqi kutubxonasiz, sof PHP + cURL bilan.
//
// .env:
//   S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   (yoki B2 endpoint)
//   S3_BUCKET=wc-hls
//   S3_REGION=auto                (R2: auto, B2: masalan us-west-004)
//   S3_ACCESS_KEY=...
//   S3_SECRET_KEY=...
//   S3_PUBLIC_BASE=https://cdn.example.com   (bucket'ning ochiq domeni)
//   S3_PREFIX=hls
// ============================================================================

class S3Client
{
    private string $endpoint;
    private string $bucket;
    private string $region;
    private string $access;
    private string $secret;
    private string $publicBase;
    private string $prefix;
    private string $lastError = '';

    public function __construct(array $cfg)
    {
        $this->endpoint   = rtrim((string) ($cfg['endpoint'] ?? ''), '/');
        $this->bucket     = trim((string) ($cfg['bucket'] ?? ''));
        $this->region     = trim((string) ($cfg['region'] ?? 'auto')) ?: 'auto';
        $this->access     = (string) ($cfg['access'] ?? '');
        $this->secret     = (string) ($cfg['secret'] ?? '');
        $this->publicBase = rtrim((string) ($cfg['public_base'] ?? ''), '/');
        $this->prefix     = trim((string) ($cfg['prefix'] ?? ''), '/');
    }

    public static function fromEnv(): ?self
    {
        $c = new self([
            'endpoint'    => env_value('S3_ENDPOINT', ''),
            'bucket'      => env_value('S3_BUCKET', ''),
            'region'      => env_value('S3_REGION', 'auto'),
            'access'      => env_value('S3_ACCESS_KEY', ''),
            'secret'      => env_value('S3_SECRET_KEY', ''),
            'public_base' => env_value('S3_PUBLIC_BASE', ''),
            'prefix'      => env_value('S3_PREFIX', 'hls'),
        ]);
        return $c->isConfigured() ? $c : null;
    }

    public function isConfigured(): bool
    {
        return $this->endpoint !== '' && $this->bucket !== ''
            && $this->access !== '' && $this->secret !== '';
    }

    public function lastError(): string
    {
        return $this->lastError;
    }

    /** Bucket ichidagi to'liq kalit (prefiks bilan). */
    public function key(string $name): string
    {
        $name = ltrim($name, '/');
        return $this->prefix !== '' ? $this->prefix . '/' . $name : $name;
    }

    /** Ochiq URL (S3_PUBLIC_BASE bo'lmasa — endpoint ko'rinishi). */
    public function publicUrl(string $name): string
    {
        $key = $this->encodePath($this->key($name));
        if ($this->publicBase !== '') {
            return $this->publicBase . '/' . $key;
        }
        return $this->endpoint . '/' . rawurlencode($this->bucket) . '/' . $key;
    }

    /** Fayl yuklaydi. Muvaffaqiyatli bo'lsa true. */
    public function putFile(string $name, string $path, string $contentType = 'application/octet-stream', ?string $cacheControl = null): bool
    {
        if (!is_file($path) || !is_readable($path)) {
            $this->lastError = 'Fayl o\'qilmadi: ' . $path;
            return false;
        }
        $try = 0;
        do {
            $try++;
            [$code, $body] = $this->request('PUT', $this->key($name), $path, $contentType, $cacheControl);
            if ($code >= 200 && $code < 300) {
                return true;
            }
            $this->lastError = 'PUT ' . $name . ' -> HTTP ' . $code . ' ' . substr(trim($body), 0, 300);
            if ($code === 403 || $code === 404) {
                break; // imzo/bucket xatosi — qayta urinish foydasiz
            }
            sleep($try);
        } while ($try < 3);
        return false;
    }

    public function head(string $name): bool
    {
        [$code] = $this->request('HEAD', $this->key($name), null, '', null);
        return $code >= 200 && $code < 300;
    }

    public function delete(string $name): bool
    {
        [$code, $body] = $this->request('DELETE', $this->key($name), null, '', null);
        if ($code >= 200 && $code < 300) {
            return true;
        }
        $this->lastError = 'DELETE ' . $name . ' -> HTTP ' . $code . ' ' . substr(trim($body), 0, 200);
        return false;
    }

    // ------------------------------------------------------------------ SigV4

    /**
     * @return array{0:int,1:string} [HTTP kod, javob tanasi]
     */
    private function request(string $method, string $key, ?string $bodyPath, string $contentType, ?string $cacheControl): array
    {
        $host      = (string) parse_url($this->endpoint, PHP_URL_HOST);
        $scheme    = strtolower((string) parse_url($this->endpoint, PHP_URL_SCHEME));
        $port      = (int) parse_url($this->endpoint, PHP_URL_PORT);
        // SigV4 `host` sarlavhasi HTTP `Host` bilan AYNAN bir xil bo'lishi shart.
        // Standart bo'lmagan port (masalan, lokal sinovda :9333) ham kiradi.
        if ($port > 0 && !(($scheme === 'https' && $port === 443) || ($scheme === 'http' && $port === 80))) {
            $host .= ':' . $port;
        }
        $basePath  = (string) parse_url($this->endpoint, PHP_URL_PATH);
        $uriPath   = rtrim($basePath, '/') . '/' . rawurlencode($this->bucket) . '/' . $this->encodePath($key);
        $url       = $this->endpoint . substr($uriPath, strlen(rtrim($basePath, '/')));
        $now       = gmdate('Ymd\THis\Z');
        $date      = substr($now, 0, 8);
        $payload   = $bodyPath !== null ? (string) hash_file('sha256', $bodyPath) : hash('sha256', '');
        $ct        = $contentType !== '' ? $contentType : 'application/octet-stream';
        $cc        = $cacheControl !== null && $cacheControl !== '' ? $cacheControl : 'public, max-age=300';

        $canonicalHeaders = "cache-control:" . $cc . "\n"
            . "content-type:" . $ct . "\n"
            . "host:" . $host . "\n"
            . "x-amz-content-sha256:" . $payload . "\n"
            . "x-amz-date:" . $now . "\n";
        $signedHeaders = 'cache-control;content-type;host;x-amz-content-sha256;x-amz-date';

        $canonicalRequest = $method . "\n" . $uriPath . "\n\n" . $canonicalHeaders . "\n"
            . $signedHeaders . "\n" . $payload;

        $scope       = $date . '/' . $this->region . '/s3/aws4_request';
        $stringToSign = "AWS4-HMAC-SHA256\n" . $now . "\n" . $scope . "\n"
            . hash('sha256', $canonicalRequest);

        $k = hash_hmac('sha256', $date, 'AWS4' . $this->secret, true);
        $k = hash_hmac('sha256', $this->region, $k, true);
        $k = hash_hmac('sha256', 's3', $k, true);
        $k = hash_hmac('sha256', 'aws4_request', $k, true);
        $signature = hash_hmac('sha256', $stringToSign, $k);

        $auth = 'AWS4-HMAC-SHA256 Credential=' . $this->access . '/' . $scope
            . ', SignedHeaders=' . $signedHeaders . ', Signature=' . $signature;

        $headers = [
            'Authorization: ' . $auth,
            'Host: ' . $host,
            'Content-Type: ' . $ct,
            'Cache-Control: ' . $cc,
            'x-amz-content-sha256: ' . $payload,
            'x-amz-date: ' . $now,
        ];

        $ch = curl_init($url);
        $opts = [
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER         => false,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT        => 900,      // katta segmentlar sekin tarmoqda
        ];
        $fp = null;
        if ($method === 'PUT' && $bodyPath !== null) {
            $fp = @fopen($bodyPath, 'rb');
            if (!$fp) {
                $this->lastError = 'Fayl ochilmadi: ' . $bodyPath;
                return [0, ''];
            }
            $opts[CURLOPT_UPLOAD]     = true;
            $opts[CURLOPT_INFILE]     = $fp;
            $opts[CURLOPT_INFILESIZE] = (int) filesize($bodyPath);
        } elseif ($method === 'HEAD') {
            $opts[CURLOPT_NOBODY] = true;
        }
        curl_setopt_array($ch, $opts);

        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if ($body === false) {
            $this->lastError = 'cURL: ' . curl_error($ch);
            $body = '';
        }
        curl_close($ch);
        if ($fp) {
            fclose($fp);
        }
        return [$code, (string) $body];
    }

    /** Har bir segmentni RFC3986 bo'yicha kodlaydi (imzo bilan mos bo'lishi shart). */
    private function encodePath(string $key): string
    {
        $parts = explode('/', $key);
        return implode('/', array_map('rawurlencode', $parts));
    }
}
