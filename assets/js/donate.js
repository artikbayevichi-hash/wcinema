/* W CINEMA donation UI — payment integration is intentionally disabled until a merchant is configured. */
(function () {
    'use strict';

    var dialog = document.getElementById('donateDialog');
    if (!dialog) return;

    var panel = dialog.querySelector('.donate-panel');
    var triggers = Array.prototype.slice.call(document.querySelectorAll('[data-donate-open]'));
    var lastFocus = null;
    var bodyHadLock = false;

    function focusableElements() {
        return Array.prototype.slice.call(dialog.querySelectorAll(
            'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(function (el) {
            return !el.hidden && el.getAttribute('aria-hidden') !== 'true';
        });
    }

    function openDialog(event) {
        if (event) event.preventDefault();
        if (!dialog.hidden) return;
        lastFocus = document.activeElement;
        bodyHadLock = document.body.classList.contains('donate-open');
        dialog.hidden = false;
        document.body.classList.add('donate-open');
        var first = dialog.querySelector('[data-donate-close-button]');
        if (first) first.focus();
    }

    function closeDialog() {
        if (dialog.hidden) return;
        dialog.hidden = true;
        if (!bodyHadLock) document.body.classList.remove('donate-open');
        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
        lastFocus = null;
    }

    triggers.forEach(function (trigger) {
        trigger.addEventListener('click', openDialog);
    });

    dialog.querySelectorAll('[data-donate-close], [data-donate-close-button]').forEach(function (button) {
        button.addEventListener('click', closeDialog);
    });

    document.addEventListener('keydown', function (event) {
        if (dialog.hidden) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDialog();
            return;
        }
        if (event.key !== 'Tab') return;
        var items = focusableElements();
        if (!items.length) {
            event.preventDefault();
            if (panel) panel.focus();
            return;
        }
        var first = items[0];
        var last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
})();
