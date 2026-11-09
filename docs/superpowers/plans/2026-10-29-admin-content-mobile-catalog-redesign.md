# Admin Content + Mobile Catalog Redesign Implementation Plan

> **For agentic workers:** Implement task-by-task and verify each independently.

**Goal:** Mobil katalog/qidiruvni YouTube-ga o‘xshash qulay oqimga keltirish va `admin-content.php`ni professional, tezkor admin kontent boshqaruviga aylantirish.

**Architecture:** `admin-content.php` eski duplicate CRUD sahifa bo‘lib qolmaydi; autentifikatsiyadan keyin yangi `admin-panel.php#/content` moduliga yo‘naltiriladi. Asosiy CRUD, bulk status, duplicate, episode va metadata funksiyalari mavjud `admin-content.js` + `api/content-admin.php` orqali ishlaydi. Katalog/qidiruv esa mavjud `app.js`, `includes/nav.php`, `style.css` va `instagram.css` ustida, server API kontraktlarini buzmasdan, responsive UI sifatida yaxshilanadi.

**Tech Stack:** PHP, vanilla JavaScript, CSS, mavjud admin SPA, mavjud API; yangi tashqi kutubxona qo‘shilmaydi.

**Spec:** User preferences from 2026-10-29: clean dark YouTube Studio style; desktop sidebar + mobile bottom navigation; film/qism qo‘shish primary action; wizard form; bulk functions; poster preview; drag-and-drop; desktop table + mobile card list; mobile catalog/search should feel like YouTube; search gets realtime, filters, history, approximate matching where existing API allows, infinite/paged results.

## Design Decisions

- **Visual language:** YouTube Studio-inspired clean dark admin, not neon-heavy; purple accent retained only as action/state accent for compatibility with existing admin theme.
- **Layout:** desktop left sidebar; mobile fixed bottom navigation and compact sticky topbar.
- **Content list:** desktop table with selection and bulk toolbar; mobile stacked content cards with poster, title, status, episode count and primary edit action.
- **Create flow:** wizard-like edit view: source/metadata → poster/details → publish → episodes. Existing module tabs are retained and visually strengthened instead of rewriting API contracts.
- **Deletion:** preserve existing confirmation and server-side hard-delete behavior; user requested immediate delete semantics, but a confirm guard remains to prevent accidental destructive admin actions.
- **Mobile catalog:** YouTube-like single-column video feed for the catalog results, large 16:9 thumbnails, readable title/meta, 44px touch targets, horizontal category/filter chips, safe-area spacing.
- **Search:** full-screen mobile search sheet with prominent input, recent query chips stored locally, debounced results, clear empty/loading states, and existing server result sections.
- **Performance:** keep lazy images/async decoding; avoid new blocking dependencies; use `content-visibility` only on long result regions where safe; preserve pagination/infinite loading.

## Global Constraints

- Do not change the public response shape of `api/content-admin.php` or `api/search.php`.
- Do not weaken `requireAdmin()` or existing URL validation/SSRF protections.
- Preserve existing admin content actions: create, update, delete, duplicate, bulk status, add/update/delete episode, poster preview and metadata lookup.
- Preserve keyboard focus visibility, reduced-motion behavior, safe-area insets and minimum touch targets.
- Do not add a blocking external font or JavaScript CDN dependency.

## Review Focus

- Direct navigation to `admin-content.php` must land in the redesigned content module and preserve admin auth.
- Mobile content rows must remain usable at 320px width without horizontal page overflow.
- Bulk selection must survive list redraws and must not target unintended IDs.
- Search requests must be debounced and stale responses must not overwrite newer results.
- Poster URLs and titles must remain escaped; no raw API data may become executable HTML.

---

### Task 1: Route the legacy admin-content URL to the new content module

**Files:**
- Modify: `admin-content.php`
- Verify: PHP lint and direct URL behavior

- [ ] Replace the old duplicate page body after auth with a server redirect to `admin-panel.php#/content`, preserving the current directory/base path.
- [ ] Keep unauthenticated behavior routed through the existing admin login flow.
- [ ] Run `php -l admin-content.php`.

### Task 2: Redesign admin content list and mobile card presentation

**Files:**
- Modify: `assets/js/admin-content.js`
- Modify: `assets/css/admin-panel.css`

- [ ] Keep desktop table and bulk controls, but add a mobile card renderer/class contract for rows under 640px.
- [ ] Ensure each card exposes title, poster, category, episodes, views, status and edit/delete actions.
- [ ] Improve toolbar grouping: search, category/type/status filters, sort and primary “+ Yangi kontent” action.
- [ ] Add accessible labels and focus states to selection, status and row actions.
- [ ] Retain confirmation guard for destructive deletes and existing API actions.
- [ ] Run `node --check assets/js/admin-content.js`.

### Task 3: Polish admin wizard/edit view

**Files:**
- Modify: `assets/js/admin-content.js`
- Modify: `assets/css/admin-panel.css`

- [ ] Strengthen the step hierarchy for main metadata, poster/preview and episodes using existing tabs and form contracts.
- [ ] Make poster preview, auto metadata results and episode actions visually primary without changing request payloads.
- [ ] Make save actions sticky/visible on mobile and ensure episode rows wrap without horizontal overflow.
- [ ] Preserve drag-and-drop episode ordering and add clear drag affordance.
- [ ] Run PHP/API smoke checks and `node --check`.

### Task 4: Improve mobile catalog and search UI

**Files:**
- Modify: `assets/css/style.css`
- Modify: `assets/css/instagram.css`
- Modify: `includes/nav.php` only if search-history hooks need markup
- Modify: `assets/js/app.js` only if catalog state/history hooks need behavior

- [ ] Convert mobile catalog results to a YouTube-like single-column feed with full-width 16:9 thumbnails and readable metadata.
- [ ] Improve horizontal chip scrolling, loading skeleton/empty states, touch target sizes and safe-area spacing.
- [ ] Add local recent-search chips to the existing search overlay without changing API responses.
- [ ] Keep debouncing and stale-response sequence protection; add approximate-query fallback only if the current search API supports it without a schema change.
- [ ] Ensure lazy loading/async decoding remain enabled and avoid re-rendering unrelated cards.

### Task 5: Verification and browser review

**Files:**
- Verify: `admin-content.php`, `admin-panel.php`, `assets/js/admin-content.js`, `assets/js/app.js`, `assets/css/admin-panel.css`, `assets/css/style.css`, `assets/css/instagram.css`

- [ ] Run PHP lint on modified PHP files.
- [ ] Run Node syntax checks on modified JavaScript files.
- [ ] Check git diff for accidental API/auth changes.
- [ ] Check direct routes: `admin-content.php`, `admin-panel.php#/content`, `index.php`, search overlay.
- [ ] Review 320px, 390px, 768px and desktop layouts in the local browser; repair overflow, focus and sticky navigation issues.
