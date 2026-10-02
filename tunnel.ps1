# ============================================================================
#  Tunel boshqaruvchi — saytni HTTPS orqali doim ochib turadi
# ============================================================================
#
#  NIMA UCHUN?
#  Bu sayt Service Worker ishlatadi (Telegram CDN dan video oqish uchun).
#  Service Worker FAQAT https:// yoki localhost da ishlaydi — shuning uchun
#  sizga HTTPS manzil kerak.
#
#  localhost.run / trycloudflare.com bepul xizmatlari VAQTINCHA manzil beradi
#  va vaqt-fayt uziladi. Bu skript shuning uchun:
#     * ssh//cloudflared jarayonini kuzatadi,
#     * o'lsa qayta ishga tushiradi,
#     * yangi manzilni  tg-url.txt  fayliga yozib qo'yadi
#       (shunda manzilni doim shu fayldan o'qish mumkin).
#
#  ISHLATISH:
#     powershell -File C:\xampp\htdocs\tele_uzdub\tunnel.ps1
#     (yoki .\tunnel.ps1 -Tunnel cloudflare)
# ============================================================================
param(
    # "lhr" = localhost.run (ssh, ishonchliroq) | "cf" = trycloudflare
    [string]$Tunnel = "lhr",
    [int]$Port = 80
)

$ErrorActionPreference = "Continue"
$Root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutDir = Join-Path $env:TEMP "opencode"
$UrlFile = Join-Path $Root "tg-url.txt"
$Log    = Join-Path $OutDir "tunnel.log"

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
    Add-Content -Path $Log -Value $line -Encoding UTF8
    Write-Host $line
}

# ------------------------------------------------------------------ tozalash
Get-Process ssh, cloudflared -ErrorAction SilentlyContinue |
    Where-Object { $_.StartTime -gt (Get-Date).AddHours(-12) } |
    ForEach-Object { Log "eski jarayon to'xtatildi: $($_.ProcessName) ($($_.Id))"; Stop-Process -Id $_.Id -Force }
Start-Sleep -Seconds 1

function Start-Lhr {
    $out = Join-Path $OutDir "lhr.out"
    $err = Join-Path $OutDir "lhr.err"
    Remove-Item $out, $err -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath "C:\Windows\System32\OpenSSH\ssh.exe" `
        -ArgumentList "-o", "StrictHostKeyChecking=no", "-o", "ServerAliveInterval=25",
                      "-o", "ServerAliveCountMax=1000", "-o", "ExitOnForwardFailure=no",
                      "-R", "$Port`:localhost:$Port", "nokey@localhost.run" `
        -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru

    Start-Sleep -Seconds 15
    $raw = Get-Content $out -Raw -ErrorAction SilentlyContinue
    if (-not $raw) { return $null }
    # ANSI rang kodlarini tozalab, https://...lhr.life manzilini olamiz
    $clean = [regex]::Replace($raw, "\x1B\[[0-9;?]*[ -/]*[@-~]", "") -replace "`0", ""
    $m = [regex]::Match($clean, "https://[a-zA-Z0-9\.\-]+\.lhr\.life")
    if ($m.Success) { return $m.Value }
    return $null
}

function Start-Cf {
    $exe = "C:\Users\user\cloudflared\cloudflared.exe"
    if (-not (Test-Path $exe)) { $exe = "cloudflared.exe" }
    $out = Join-Path $OutDir "cf.out"
    $err = Join-Path $OutDir "cf.err"
    Remove-Item $out, $err -ErrorAction SilentlyContinue
    Start-Process -FilePath $exe `
        -ArgumentList "tunnel", "--url", "http://localhost:$Port", "--no-autoupdate" `
        -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden | Out-Null

    for ($i = 0; $i -lt 12; $i++) {
        Start-Sleep -Seconds 5
        $raw = Get-Content $err -Raw -ErrorAction SilentlyContinue
        if ($raw) {
            $m = [regex]::Match($raw, "https://[a-z0-9\-]+\.trycloudflare\.com")
            if ($m.Success) { return $m.Value }
        }
    }
    return $null
}

$starter = if ($Tunnel -eq "cf") { "Start-Cf" } else { "Start-Lhr" }

# ------------------------------------------------------------------- asosiy
Log "=== Tunel boshqaruvchisi ishga tushdi (rejim: $Tunnel) ==="
$url = $null
$fail = 0

while ($true) {
    if ($url -eq $null) {
        $url = & $starter
        if ($url) {
            $fail = 0
            $full = "$url/tele_uzdub/"
            Set-Content -Path $UrlFile -Value $full -Encoding ASCII
            Log "MANZIL TAYYOR: $full"
        } else {
            $fail++
            Log "ulashga urinish #$fail muvaffaqiyatsiz (5 s kutib, qayta uriniladi)"
            Start-Sleep -Seconds 5
        }
    }

    Start-Sleep -Seconds 20

    # --- jonlik tekshiruvi ------------------------------------------------
    $alive = $false
    try {
        $resp = Invoke-WebRequest -Uri "$url/tele_uzdub/" -Method Head -TimeoutSec 15 -UseBasicParsing
        $alive = ($resp.StatusCode -eq 200)
    } catch { $alive = $false }

    if (-not $alive) {
        Log "javob yo'q yoki xato -> tunel qayta ulanmoqda"
        Get-Process ssh, cloudflared -ErrorAction SilentlyContinue |
            Where-Object { $_.StartTime -gt (Get-Date).AddHours(-12) } |
            ForEach-Object { Stop-Process -Id $_.Id -Force }
        $url = $null
    }
}
