# W CINEMA — Site-wide UI/UX improvement roadmap

## Ishlash tartibi

Sayt bir yo‘la xavfli tarzda qayta yozilmaydi. Har bir qatlam avval o‘qiladi, kichik o‘zgarish kiritiladi, PHP/JS sintaksisi tekshiriladi va lokal brauzerda asosiy oqim qayta ochiladi. Umumiy dizayn tokenlari va accessibility qoidalari alohida qatlam sifatida saqlanadi.

## Audit xulosasi

Audit qilingan bo‘limlar: bosh sahifa/katalog, watch va kommentariya, Reels, chat/DM, login/profil/sozlamalar, admin panel, umumiy navigation/responsive qatlam va API/authentication. Eng yuqori ustuvorliklar — server-side identity/session ishonchliligi, CSRF va rate-limit himoyasi, modal/fokus accessibility, mobile keyboard/safe-area holatlari, Telegram/GramJS yuklanishini kechiktirish va katta ro‘yxatlarni pagination qilish.

## Bosqichlar

### 1. Umumiy UI foundation — bajarilmoqda

Global `:focus-visible` ring, `prefers-reduced-motion`, mobil zoomni bloklamaslik, search grid responsive selectorini tuzatish, TV settings selectorini tuzatish, search/profile dialog semantikasi va upload dropzone keyboard interaction kiritildi.

### 2. Kommentariya va watch — keyingi navbat

Film uchun qismsiz kommentariya topic kontraktini alohida qo‘llab-quvvatlash, expandable comment’larni keyboard-accessible qilish, media alt/aria label, retry/error state, modal focus trap va direct player preload siyosatini yaxshilash kerak.

### 3. Navigation va account oqimlari

Search/settings/notification overlaylarida focus capture/restore, Escape va background inert holati; profil statistikasi va tabs uchun aniq mobile grid; saved/history uchun pagination; login status/error’larini `aria-live` bilan e’lon qilish.

### 4. Reels va chat UX

Reels modal/action sheet focus trap, keyboard play/pause, progress semantics, lazy active/next slide, upload timeout/cancel va stale search guard. Chatda polling abort/backoff/visibility throttling, auto-scrollni faqat pastda bo‘lganda ishlatish, CSRF va server-side identity tekshiruvi.

### 5. API va xavfsizlik

`TG_TRUST_CLIENT_ID` faqat development compatibility rejimida qolishi, server-issued client session asosiy identity bo‘lishi, mutatsion endpointlarga CSRF/Origin tekshiruvi, video-topic POST authentication/rate limit, Login Widget `auth_date` replay tekshiruvi, generic production errors, input bounds va notification/report rate limit.

### 6. Performance va polish

GramJS/Telegram bundle’larini faqat kerak bo‘lganda lazy init qilish, katalog hover preview uchun AbortController, `srcset/sizes` va intrinsic image dimensions, reels active/neighbor media cache, admin resize debounce, shared loading/empty/error components va visual regression smoke checks.

## Joriy o‘zgarishlar

- Kommentariya composeri desktopda izohlar ro‘yxatidan oldinga chiqarildi.
- PHP sintaksisi `watch.php`, `reels.php`, `profile.php`, `includes/nav.php`, `includes/Auth.php`, `api/video-topic.php` va `reels-upload.php` uchun tekshirildi.
- Navigation label escaping kuchaytirildi.
- Login Widget’da `auth_date` majburiy va kelajak timestamp tolerance bilan tekshiriladi.
- Video topic yaratish POST’i server tanigan sessiya/client-sessionga bog‘landi.
