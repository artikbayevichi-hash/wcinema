# ============================================================================
#  start-all.ps1 — W CINEMA butun tizimni avtomatik ishga tushirish
# ============================================================================
#  Kompyuter yoqilganda (logon) va har 5 daqiqada (watchdog) ishlaydi.
#  IDEMPOTENT: faqat O'CHGAN komponentni ishga tushiradi:
#    1) Apache  (httpd)
#    2) MySQL   (mysqld)
#    3) Cloudflare tunnel (cloudflared) + .env SITE_URL'ni yangilash
#    4) Telegram bot (bot.php)
#
#  Xulosa log:  C:\xampp\htdocs\tele_uzdub\storage\logs\autostart.log
# ============================================================================
$ErrorActionPreference = 'SilentlyContinue'

$proj = 'C:\xampp\htdocs\tele_uzdub'
$logs = "$proj\storage\logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$logFile = "$logs\autostart.log"

function Log($m) {
    $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "  " + $m
    try { $line | Out-File -Append -Encoding utf8 $logFile } catch {}
    Write-Host $line
}

function Test-Port($port) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $task = $c.ConnectAsync('127.0.0.1', $port)
        if (-not $task.Wait(3000)) { $c.Close(); return $false }
        $ok = $c.Connected
        $c.Close()
        return $ok
    } catch { return $false }
}

Log '=== start-all ishga tushdi ==='

# ---------------------------------------------------------------- 1) Apache
if (-not (Get-Process httpd -ErrorAction SilentlyContinue)) {
    Log 'Apache o''chgan — ishga tushirilmoqda...'
    Start-Process 'C:\xampp\apache\bin\httpd.exe' -WindowStyle Hidden
    Start-Sleep -Seconds 4
} else {
    Log 'Apache ishlayapti'
}

# ------------------------------------------------------------------ 2) MySQL
if (-not (Get-Process mysqld -ErrorAction SilentlyContinue)) {
    Log 'MySQL o''chgan — ishga tushirilmoqda...'
    Start-Process 'C:\xampp\mysql\bin\mysqld.exe' -WindowStyle Hidden
    Start-Sleep -Seconds 4
} else {
    Log 'MySQL ishlayapti'
}

# Apache 80-portgacha kutish (maks 30 soniya)
for ($i = 0; $i -lt 15; $i++) {
    if (Test-Port 80) { break }
    Start-Sleep -Seconds 2
}

# ----------------------------------------------------------------- 3) Tunnel
$envFile = "$proj\.env"
$oldUrl = ''
$content = Get-Content $envFile -Encoding utf8 -ErrorAction SilentlyContinue
$oldUrl = (($content | Where-Object { $_ -match '^SITE_URL=' }) -split '=', 2)[1]
$oldUrl = ($oldUrl -replace '\s+$', '').Trim()

$siteOk = $false
if ($oldUrl) {
    try {
        $base = $oldUrl.TrimEnd('/')
        $r = Invoke-WebRequest -Uri "$base/index.php" -Method Head -TimeoutSec 10 -UseBasicParsing -MaximumRedirection 5
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { $siteOk = $true }
    } catch {}
}

if ($siteOk) {
    Log "Sayt ishlayapti: $oldUrl"
} else {
    $cfProc = Get-Process cloudflared -ErrorAction SilentlyContinue
    if ($cfProc) {
        Log 'Sayt javob bermadi — cloudflared qayta ishga tushirilmoqda...'
        $cfProc | Stop-Process -Force
        Start-Sleep -Seconds 2
    } else {
        Log 'cloudflared o''chgan — ishga tushirilmoqda...'
    }

    $cfd = 'C:\Users\user\cloudflared\cloudflared.exe'
    Start-Process $cfd -ArgumentList 'tunnel','--url','http://localhost:80','--no-autoupdate' `
        -WindowStyle Hidden `
        -RedirectStandardOutput "$logs\cfd-out.log" `
        -RedirectStandardError  "$logs\cfd-err.log"

    # Yangi URL'ni logdan tikish (max ~2 daqiqa)
    $url = $null
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 2
        $m = Get-Content "$logs\cfd-err.log" -ErrorAction SilentlyContinue |
             Select-String 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -Last 1
        if ($m) {
            $m.Line | Select-String '(https://[a-z0-9-]+\.trycloudflare\.com)' | ForEach-Object { $url = $_.Matches[0].Groups[1].Value }
            if ($url) { break }
        }
    }

    if ($url) {
        $newSite = $url.TrimEnd('/') + '/tele_uzdub'
        $upd = foreach ($line in $content) {
            if ($line -match '^SITE_URL=') { "SITE_URL=$newSite" } else { $line }
        }
        $upd | Set-Content $envFile -Encoding utf8
        Log "Tunnel yangilandi: $newSite"
        Start-Sleep -Seconds 6
    } else {
        Log 'XATO: cloudflared URL topilmadi!'
    }
}

# LAN manzili (uydagi tarmoq — tunnel cheklovisiz TO'LIQ tezlik)
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
          Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } |
          Select-Object -First 1).IPAddress
if ($lanIp) { Log "LAN (tez oqim): http://$lanIp/tele_uzdub" }

# ------------------------------------------------------------------ 4) Bot
$botRunning = Get-CimInstance Win32_Process -Filter "Name='php.exe'" -ErrorAction SilentlyContinue |
              Where-Object { $_.CommandLine -like '*bot.php*' }
if (-not $botRunning) {
    Log 'Bot o''chgan — ishga tushirilmoqda...'
    Start-Process 'C:\xampp\php\php.exe' -ArgumentList "$proj\bot.php" `
        -WindowStyle Hidden `
        -RedirectStandardOutput "$logs\bot-out.log" `
        -RedirectStandardError  "$logs\bot-err.log"
} else {
    Log 'Bot ishlayapti'
}

Log '=== start-all tugadi ==='