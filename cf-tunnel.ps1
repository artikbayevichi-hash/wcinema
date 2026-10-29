# ============================================================================
#  cf-tunnel.ps1 - Cloudflare Tunnel (bepul) bilan saytni HTTPS da ochish
# ============================================================================
#  IKKI REJIM:
#
#  1) QUICK (hisobsiz, hoziroq ishlaydi):
#       .\cf-tunnel.ps1
#     Har ishga tushishda yangi https://<random>.trycloudflare.com beradi.
#     URL avtomatik tg-url.txt ga yoziladi (va -UpdateEnv bilan .env ga).
#
#  2) NAMED (barqaror domen - Cloudflare hisobi + o'z domeningiz kerak):
#       cloudflared tunnel login            # bir marta, brauzerda
#       cloudflared tunnel create wcinema   # bir marta
#       cloudflared tunnel route dns wcinema cinema.example.com
#       .\cf-tunnel.ps1 -Named wcinema -Hostname cinema.example.com -UpdateEnv
#
#  DIQQAT: tunnel VIDEO tezligini oshirmaydi - video Telegram dan to'g'ridan
#  to'g'ri brauzerga oqadi (tunnel faqat HTML/JS/CSS ni o'tkazadi).
#  Tunnel HLS rejimi (api/hls.php) yoqilganda muhim: o'shanda segmentlar
#  Cloudflare orqali ketadi va edge da keshlanadi.
# ============================================================================
param(
    [string]$Named = '',        # nomlangan tunnel nomi
    [string]$Hostname = '',     # named tunnel uchun domen (masalan cinema.example.com)
    [int]$Port = 80,            # Apache porti
    [switch]$UpdateEnv,         # .env dagi SITE_URL ni yangilash
    [switch]$Once               # bitta urinish (test uchun) - qayta ishga tushmaydi
)

$ErrorActionPreference = 'Continue'

$Root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$UrlFile = Join-Path $Root 'tg-url.txt'
$EnvFile = Join-Path $Root '.env'
$LogDir  = Join-Path $env:TEMP 'wc-tunnel'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

function Find-Cf {
    $cands = @(
        'C:\Program Files (x86)\cloudflared\cloudflared.exe',
        'C:\Program Files\cloudflared\cloudflared.exe'
    )
    foreach ($c in $cands) { if (Test-Path $c) { return $c } }
    $g = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($g) { return $g.Source }
    return $null
}

$cf = Find-Cf
if (-not $cf) {
    Write-Host "cloudflared topilmadi. Ornatish: winget install Cloudflare.cloudflared" -ForegroundColor Red
    exit 1
}

if ($Named -ne '') {
    $cert = Join-Path $env:USERPROFILE '.cloudflared\cert.pem'
    if (-not (Test-Path $cert)) {
        Write-Host "Avval bir marta login qiling:  cloudflared tunnel login" -ForegroundColor Yellow
        exit 1
    }
}

function Set-SiteUrl([string]$url) {
    if (-not $UpdateEnv -or -not (Test-Path $EnvFile)) { return }
    $site = ($url.TrimEnd('/')) + '/tele_uzdub'
    $raw  = Get-Content $EnvFile -Raw
    if ($raw -match '(?m)^SITE_URL=') {
        $raw = [regex]::Replace($raw, '(?m)^SITE_URL=.*$', 'SITE_URL=' + $site)
    } else {
        $raw = $raw.TrimEnd() + "`r`nSITE_URL=$site`r`n"
    }
    Set-Content -Path $EnvFile -Value $raw -Encoding UTF8 -NoNewline
    Write-Host "SITE_URL yangilandi: $site" -ForegroundColor Green
}

Write-Host "tunnel ishga tushirilmoqda (port $Port) ..." -ForegroundColor Cyan

$attempt = 0
while ($true) {
    $attempt++
    $out = Join-Path $LogDir "cf-$attempt.out"
    $err = Join-Path $LogDir "cf-$attempt.err"
    Remove-Item $out, $err -ErrorAction SilentlyContinue

    if ($Named -ne '') {
        $cfArgs = @('tunnel', '--no-autoupdate', 'run', '--url', "http://localhost:$Port", $Named)
    } else {
        $cfArgs = @('tunnel', '--no-autoupdate', '--url', "http://localhost:$Port")
    }

    $p = Start-Process -FilePath $cf -ArgumentList $cfArgs `
        -RedirectStandardOutput $out -RedirectStandardError $err `
        -WindowStyle Hidden -PassThru

    $url = $null
    for ($i = 0; $i -lt 25; $i++) {
        Start-Sleep -Seconds 1
        if ($p.HasExited) { break }
        if ($Named -ne '' -and $Hostname -ne '') { $url = "https://$Hostname"; break }
        $txt = ''
        try { $txt += (Get-Content $err -Raw -ErrorAction SilentlyContinue) } catch {}
        try { $txt += (Get-Content $out -Raw -ErrorAction SilentlyContinue) } catch {}
        $m = [regex]::Match([string]$txt, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($m.Success) { $url = $m.Value; break }
    }

    if ($url) {
        Set-Content -Path $UrlFile -Value $url -Encoding UTF8
        Write-Host ""
        Write-Host "  HTTPS: $url/tele_uzdub/" -ForegroundColor Green
        Write-Host ""
        Set-SiteUrl $url
    } else {
        Write-Host "URL olinmadi - log: $err" -ForegroundColor Yellow
    }

    if ($Once) { Wait-Process -Id $p.Id -ErrorAction SilentlyContinue; break }

    Wait-Process -Id $p.Id -ErrorAction SilentlyContinue
    Write-Host "tunnel uzildi - 5 soniyadan keyin qayta ulanadi" -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}
