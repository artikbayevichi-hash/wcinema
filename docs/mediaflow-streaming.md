# MediaFlow video oqimi

Sayt MediaFlow Proxy Light’ni ixtiyoriy Telegram oqim manbasi sifatida ishlata oladi. Sozlama bo‘lmasa, mavjud brauzer/Telegram Service Worker pleeri o‘zgarishsiz ishlaydi.

## Hozirgi kod yo‘li

`watch.php` MediaFlow’ni faqat uchta server sozlamasi to‘liq va yoqilgan bo‘lsa tanlaydi. PHP `api/mediaflow-url.php` orqali MediaFlow’dan muddati cheklangan, imzolangan oqim URL so‘raydi. API paroli va Telegram session string brauzerga yuborilmaydi. Video baytlari esa signed URL orqali MediaFlow serveridan to‘g‘ridan-to‘g‘ri brauzerga oqadi; saytning PHP hostingi videoni relay qilmaydi.

MediaFlow URL yaratilmasa yoki video brauzerda ochilmasa, player mavjud Telegram oqimiga qaytadi. Shu sababli ushbu rejimni yoqishdan oldin test nusxada ishlashini tekshiring.

## Sozlamalar

Mavjud `.env` fayliga quyidagilarni hostingda qo‘shing; haqiqiy parollarni GitHub yoki brauzer JavaScript’iga joylamang:

```dotenv
MEDIAFLOW_ENABLED=1
MEDIAFLOW_URL=https://stream.example.com
MEDIAFLOW_API_PASSWORD=uzun-va-tasodifiy-parol
MEDIAFLOW_URL_TTL=21600
```

`MEDIAFLOW_URL` MediaFlow xizmatining HTTPS manzili bo‘lishi kerak. `MEDIAFLOW_URL_TTL` soniyalarda; kod qiymatni 15 daqiqa–24 soat oralig‘ida cheklaydi. Local test uchun URL `http://localhost` bo‘lishi mumkin.

## Hosting talabi

MediaFlow Proxy Light doimiy ishlaydigan alohida servisdir. Uni Docker yoki qo‘llab-quvvatlanadigan Linux servisi bor VPS/hostingga joylashtiring; odatiy PHP shared hosting odatda bunday Rust/Docker servisni uzluksiz ishlata olmaydi. Veb-saytning PHP hostingi MediaFlow’ga serverdan HTTPS orqali chiqishi, foydalanuvchi brauzeri esa MediaFlow’ning HTTPS URL’iga ulana olishi kerak. Videoni ko‘rish uchun brauzer bilan MediaFlow domeni orasidagi `Range` so‘rovlari ishlashi zarur.

MediaFlow’ga Telegram API ID, API Hash va session string kerak bo‘ladi. Session string Telegram hisobiga kirish kaliti bilan teng kuchga ega: uni `.env`/hosting secret store’da saqlang, repozitoriyga qo‘shmang va menga yubormang. Reverse proxy’da HTTPS’ni yoqing, video uchun buffering’ni o‘chiring va faqat haqiqiy proxy IP’lariga ishoning.

MediaFlow sozlanmaguncha `MEDIAFLOW_ENABLED=0` qoldiring. Hosting provayderi va domen tayyor bo‘lgach, manzil hamda reverse-proxy sozlamalarini moslashtirib, `Range`/seek va fallback’ni haqiqiy video bilan sinash kerak.
