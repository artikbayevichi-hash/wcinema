# Mobile UX, Performance, and Adaptive Quality Implementation Plan

> **For agentic workers:** Tasks are implemented incrementally with syntax and browser checks after each group.

**Goal:** Make the mobile experience more comfortable, reduce catalog/search and video startup work, and expose reliable automatic/manual HLS quality selection.

**Architecture:** Preserve the current vanilla PHP/CSS/JS structure. Use CSS-only mobile refinements for layout and touch targets, keep catalog pagination/lazy image behavior, and improve the existing HLS player rather than adding a second player library.

**Tech Stack:** PHP, vanilla JavaScript, CSS, hls.js when HLS is used.

## Global Constraints

- Do not break Telegram playback, direct MP4 playback, comments, or existing desktop layout.
- Keep automatic quality as the default; manual quality selection is an override.
- Do not download full video data before playback; metadata/poster may load early.
- Verify PHP and JavaScript syntax after edits.

## Review Focus

- Slow mobile network: poster and player shell appear before video bytes.
- HLS manifest with one or zero levels: quality menu remains usable and does not throw.
- HLS manifest with multiple levels: Auto plus height labels are selectable.
- Narrow phones: no horizontal page overflow; actions remain touch-scrollable.
- Direct MP4/Telegram streams: playback and autoplay behavior remain intact.

### Task 1: Video startup and adaptive quality

- Modify `assets/player/player.js` HLS config to favor fast startup with automatic ABR, cap level by player size, and retain Auto/manual selector behavior.
- Keep `metadata` preload in `assets/js/watch.js`, `assets/js/tg-stream.js`, and `assets/player/player.js`.
- Verify node syntax and inspect the generated quality menu logic.

### Task 2: Mobile watch UI polish

- Modify `assets/css/watch.css` mobile rules for safe-area spacing, compact title/meta rhythm, touch-friendly action pills, episode carousel affordance, and no horizontal overflow.
- Verify at narrow viewport widths in the local browser.

### Task 3: Catalog/search loading polish

- Modify `assets/css/style.css` and `assets/css/instagram.css` only where mobile layout causes unnecessary reflow or oversized cards.
- Keep paginated API loading and lazy thumbnails; avoid speculative prefetch.
- Verify `app.js` syntax and catalog/search markup behavior.
