# ============================================================================
#  cf-show.ps1 — Saytni do'stlaringizga ko'rsatish uchun doimiy Cloudflare
#                tunnel (bepul, vaqtinchalik trycloudflare.com manzil).
#
#  NIMA QILADI:
#    1) tools\cf-proxy.js ni ishga tushiradi (faqat /tele_uzdub yo'lini
#       o'tkazadi — phpMyAdmin va boshqa ilovalar tashqariga chiqmaydi),
#    2) cloudflared quick tunnel ochadi (https://<random>.trycloudflare.com),
#    3) .env dagi SITE_URL va tg-url.txt ni yangilaydi,
#    4) har 30 sekundda jonlikni tekshiradi. Tunnel haqiqatan o'lsa yoki
#       bir-biriga ketma-ket 3 marta javob bermasa — o'zi qayta ulanadi va
#       yangi manzilni yozib qo'yadi (tinch holatda manzil o'zgarmaydi!).
#
#  ISHLATISH:
#    powershell -ExecutionPolicy Bypass -File C:\xampp\htdocs\tele_uzdub\cf-show.ps1
#
#  TO'XTATISH:
#    Task Manager'da node.exe, cloudflared.exe va ushbu powershell ni to'xtiring.
#
#  DIQQAT: trycloudflare.com manzili VAQTINCHA — kompyuterni o'chirsa yoki
#  internet uzilsa, tunnel yangi manzil oladi (eski havola o'chadi).
# ============================================================================
param(
    [switch]$NoWatch     # faqat bir marta ishga tushirib, monitoring o''chiriladi
)

$ErrorActionPreference = 'Continue'

$Root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir  = Join-Path $Root 'storage\logs'
$UrlFile = Join-Path $Root 'tg-url.txt'
$EnvFile = Join-Path $Root '.env'
$StateFile = Join-Path $LogDir 'cf-current-url.txt'
$ProxyJs = Join-Path $Root 'tools\cf-proxy.js'
$NodeExe = 'C:\Program Files\nodejs\node.exe'
$CfExe   = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$Port    = 8099

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
    Add-Content -Path (Join-Path $LogDir 'cf-show.log') -Value $line -Encoding UTF8
    Write-Host $line
}

function Set-SiteUrl([string]$url) {
    if (-not (Test-Path $EnvFile)) { return }
    $site = ($url.TrimEnd('/')) + '/tele_uzdub'
    $raw  = [System.IO.File]::ReadAllText($EnvFile)
    if ($raw -match '(?m)^SITE_URL=') {
        $raw = [regex]::Replace($raw, '(?m)^SITE_URL=.*$', 'SITE_URL=' + $site)
    } else {
        $raw = $raw.TrimEnd() + "`r`nSITE_URL=$site`r`n"
    }
    [System.IO.File]::WriteAllText($EnvFile, $raw, (New-Object System.Text.UTF8Encoding($false)))
    Set-Content -Path $UrlFile -Value $site -Encoding ASCII
    Set-Content -Path $StateFile -Value $url -Encoding ASCII
    Log "SITE_URL yangilandi: $site"
}

function Test-Local {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/tele_uzdub/" -UseBasicParsing -TimeoutSec 10
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

function Test-Public([string]$url) {
    if (-not $url) { return $false }
    try {
        $r = Invoke-WebRequest -Uri ($url.TrimEnd('/') + '/tele_uzdub/') -UseBasicParsing -TimeoutSec 25
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

# Log faylni o'qish: cloudflared faylni "yozib turgan" holatda bo'ladi,
# shuning uchun FileShare.ReadWrite bilan ochamiz (ReadAllText xato beradi).
function Read-Shared([string]$file) {
    try {
        $fs = [System.IO.File]::Open($file, [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $sr = New-Object System.IO.StreamReader($fs)
            $t = $sr.ReadToEnd()
            $sr.Close()
            return $t
        } finally { $fs.Dispose() }
    } catch { return '' }
}

function Get-TunnelUrl {
    $err = Join-Path $LogDir 'cf-tunnel.err'
    $out = Join-Path $LogDir 'cf-tunnel.out'
    $txt = (Read-Shared $err) + (Read-Shared $out)
    $m = [regex]::Match([string]$txt, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($m.Success) { return $m.Value }
    return $null
}

function Start-Proxy {
    $running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
               Where-Object { $_.CommandLine -like '*cf-proxy.js*' }
    if ($running) { Log 'proksi allaqachon ishlayapti'; return }
    if (-not (Test-Path $NodeExe)) { Log 'node.js topilmadi!'; return }
    Start-Process -FilePath $NodeExe -ArgumentList $ProxyJs -WorkingDirectory $Root `
        -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogDir 'cf-proxy.out') `
        -RedirectStandardError (Join-Path $LogDir 'cf-proxy.err') | Out-Null
    Start-Sleep -Seconds 2
    Log 'proksi ishga tushirildi'
}

function Start-Tunnel {
    Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    $err = Join-Path $LogDir 'cf-tunnel.err'
    $out = Join-Path $LogDir 'cf-tunnel.out'
    Remove-Item $err, $out -ErrorAction SilentlyContinue
    # --protocol http2 (TCP) barqarorroq: ba'zi ISP'lar UDP/QUIC ni
    # uzoq vaqtda tushirib qo'yadi va tunnel "o'zi o'ladi".
    # --edge-ip-version 4: noto'g'ri IPv6 yo'llaridan qat'iy yashirish.
    Start-Process -FilePath $CfExe `
        -ArgumentList 'tunnel', '--no-autoupdate', '--protocol', 'http2', '--edge-ip-version', '4', '--url', "http://127.0.0.1:$Port" `
        -WorkingDirectory $Root -WindowStyle Hidden `
        -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
    Log 'cloudflared ishga tushirildi, URL kutilmoqda...'

    $url = $null
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        $url = Get-TunnelUrl
        if ($url) { break }
    }
    if (-not $url) { Log 'URL olinmadi!'; return $null }

    # Yangi manzil darhol ishlashini tekshiramiz (bir necha sekund kutamiz).
    for ($i = 0; $i -lt 10; $i++) {
        if (Test-Public $url) { return $url }
        Start-Sleep -Seconds 3
    }
    Log 'Yangi URL javob bermadi (yana 10 s kutamiz)'
    Start-Sleep -Seconds 10
    if (Test-Public $url) { return $url }
    return $url
}

# ------------------------------------------------------------------ boshqaruv
Log '=== cf-show boshqaruvchisi ishga tushdi ==='

Start-Proxy
if (-not (Test-Local)) { Log 'XATO: proksi javob bermadi' }

# Agar tunnel allaqachon ishlayotgan bo'lsa — URL ni o'zidan olamiz (yangi URL
# yaratmaymiz, chunki u do'stlaringizga tarqatilgan bo'lishi mumkin).
$url = $null
$existing = $null
if (Test-Path $StateFile) { $existing = (Get-Content $StateFile -Raw -ErrorAction SilentlyContinue).Trim() }
if (-not $existing) { $existing = Get-TunnelUrl }

if ($existing -and (Test-Public $existing)) {
    $url = $existing
    Log "mavjud tunnel topildi va ishlayapti: $url"
} else {
    $url = Start-Tunnel
    if ($url) { Log "YANGI TUNNEL: $url" } else { Log 'XATO: tunnelni ishga tushirib bo''lmadi' }
}

if ($url) {
    Set-SiteUrl $url
    Write-Host ''
    Write-Host "  DO'STLARINGIZ UCHUN MANZIL: $url/tele_uzdub/" -ForegroundColor Green
    Write-Host ''
}

if ($NoWatch) { Log 'monitoring o''chirildi (-NoWatch)'; exit 0 }

# --------------------------------------------------------------- jonlik nazorati
$fails = 0
while ($true) {
    Start-Sleep -Seconds 30

    $cfAlive = [bool](Get-Process cloudflared -ErrorAction SilentlyContinue)
    if (-not $cfAlive) {
        Log "cloudflared jarayoni o'ldi -> qayta ulanmoqda..."
    } else {
        if (Test-Public $url) {
            $fails = 0
            continue
        }
        $fails++
        Log "javob yo'q ($fails/3)..."
        if ($fails -lt 3) { continue }
        Log '3 marta ketma-ket xato -> tunnel qayta ishga tushiriladi'
    }

    $fails = 0
    if (-not (Test-Local)) { Start-Proxy }
    $new = Start-Tunnel
    if ($new) {
        $url = $new
        Set-SiteUrl $url
        Log "YANGI MANZIL: $url/tele_uzdub/"
    }
}
