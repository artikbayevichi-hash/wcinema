# Teleproto brauzer integratsiyasi

`assets/js/tg-stream.js` video ochilganda Teleproto 1.232.0 client bundle’ni tanlaydi. U sayt serverida video saqlamaydi: Telegram media baytlari avvalgidek tomoshabin brauzeri va Service Worker orqali keladi. Mavjud `tg-cdn-worker.js` diapazonli bo‘laklarni parallel so‘rashda davom etadi.

Teleproto rasmiy qo‘llanmasida paket hozircha Node.js uchun mo‘ljallangani aytiladi. Bu loyihada esa uni browser uchun maxsus Vite bundle, Node API polyfill/stub’lari va Telegram WSS transport adapteri orqali uladik. Shu sabab bu — moslashtirilgan, sinov talab qiladigan integratsiya: lokal bundle smoke-test’i o‘tdi, ammo haqiqiy Telegram akkauntiga/XAMPP brauzer sessiyasiga ulanish bu muhitda tasdiqlanmagan. Tezlik oshishi kafolatlanmaydi.

## Xavfsiz qaytish

Agar Teleproto’da ulanish yoki kirish muammosi chiqsa, sahifani `?tgengine=gramjs` parametri bilan oching. Masalan:

```text
watch.php?id=123&tgengine=gramjs
```

Mavjud GramJS bundle saqlangan. Teleproto bundle yuklanmasa yoki undagi kutilgan eksportlar topilmasa, kod shu sahifada GramJS’ga avtomatik qaytadi. Agar bundle yuklanib, keyin Telegram ulanishi muvaffaqiyatsiz bo‘lsa, yuqoridagi qo‘lda qaytish parametridan foydalaning. Teleproto mavjud GramJS session satrini o‘qishni qo‘llab-quvvatlaydi; testdan oldin brauzerdagi sessiyani o‘chirmang.

## Qayta yig‘ish

Node.js 18+ va npm kerak. `.work/tools/teleproto-build` papkasida quyidagilarni bajaring:

```powershell
npm.cmd install --ignore-scripts --no-audit --no-fund
npm.cmd run build
npm.cmd run package
```

Build `assets/js/teleproto-client.bundle.js` va uning `.gz` nusxasini yangilaydi. PHP yordamchi bundle URL’iga filemtime versiyasini qo‘shadi; skript video ochilmaguncha yuklanmaydi. Teleproto va GramJS litsenziya matni `docs/teleproto-license.txt` faylida.
