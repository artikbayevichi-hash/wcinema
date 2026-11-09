# YouTube-style Comment Composer Implementation Plan

> **For agentic workers:** This is a small native UI change in the existing watch page.

**Goal:** Make the desktop comment composer visible before the comment list, like YouTube, so users do not scroll to the bottom to write.

**Architecture:** Reorder the existing composer markup in `watch.php` so the existing IDs and JavaScript contracts remain unchanged. Update only watch-page-specific CSS so desktop shows composer first while mobile collapsed/full behavior remains intact.

**Tech Stack:** PHP markup, existing CSS, existing `watch.js` and `tg-comments.js`.

**Spec:** User request in chat: desktop comment input should be easy to find like YouTube.

## Global Constraints

- Do not change Telegram comment APIs or shared Reels/Chat styles.
- Preserve existing element IDs (`commentForm`, `commentsList`, `cPicker`, `cReplyBar`, `watchCMore`).
- Preserve mobile collapsed behavior and full-comments toggle.

## Review Focus

- Desktop: composer appears before the comment list.
- Mobile collapsed state: composer remains hidden when 3+ comments are present.
- Mobile expanded state: composer becomes visible and all comments remain accessible.
- Formatting/attachment controls still use the same IDs and event handlers.
- PHP syntax remains valid.

### Task 1: Reorder watch-page composer

**Files:**
- Modify: `watch.php:348-401`
- Modify: `assets/css/watch.css:721-754`
- Test: PHP lint and browser inspection of `watch.php?c=2`

- [ ] Move the existing form before the comment list without changing IDs.
- [ ] Update desktop card border radii so the form is the top section and the list follows it.
- [ ] Keep mobile media-query selectors and `wc-full` behavior unchanged.
- [ ] Run PHP lint and inspect the rendered DOM and composer visibility.
