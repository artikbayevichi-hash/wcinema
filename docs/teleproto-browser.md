# Teleproto brauzer integratsiyasi

**Default dvigatel — GramJS.** Teleproto 1.232.0 client bundle faqat
`?tgengine=teleproto` parametri bilan ochilgan sahifada sinov uchun tanlanadi;
ishlab chiqarish oqimi GramJS’da ishlaydi. Ikkala holatda ham sayt serverida
video saqlanmaydi: Telegram media baytlari tomoshabin brauzeri va Service
Worker orqali keladi. Mavjud `tg-cdn-worker.js` diapazonli bo‘laklarni parallel
so‘rashda davom etadi.

Teleproto rasmiy qo‘llanmasida paket hozircha Node.js uchun mo‘ljallangani aytiladi. Bu loyihada esa uni browser uchun maxsus Vite bundle, Node API polyfill/stub’lari va Telegram WSS transport adapteri orqali uladik. Shu sabab bu — moslashtirilgan, sinov talab qiladigan integratsiya: lokal bundle smoke-test’i o‘tdi, ammo haqiqiy Telegram akkauntiga/XAMPP brauzer sessiyasiga ulanish bu muhitda tasdiqlanmagan. Tezlik oshishi kafolatlanmaydi.

## Xavfsiz qaytish

Teleproto’ni sinab ko‘rish uchun sahifani `?tgengine=teleproto` parametri bilan oching:

```text
watch.php?id=123&tgengine=teleproto
```

Ulanish yoki kirish muammosi chiqsa, parametri **olib tashlang** — default
GramJS oqimiga qaytasiz. Bundle yuklanmasa yoki kutilgan eksportlar topilmasa,
kod avtomatik ravishda GramJS’ga qaytadi. Teleproto mavjud GramJS sessiya
satrini o‘qishni qo‘llab-quvvatlaydi; testdan oldin brauzerdagi sessiyani
o‘chirmang.

## Qayta yig‘ish

Node.js 18+ va npm kerak. `.work/tools/teleproto-build` papkasida quyidagilarni bajaring:

```powershell
npm.cmd install --ignore-scripts --no-audit --no-fund
npm.cmd run build
npm.cmd run package
```

Build `assets/js/teleproto-client.bundle.js` va uning `.gz` nusxasini yangilaydi. PHP yordamchi bundle URL’iga filemtime versiyasini qo‘shadi; skript video ochilmaguncha yuklanmaydi. Teleproto va GramJS litsenziya matni `docs/teleproto-license.txt` faylida.
