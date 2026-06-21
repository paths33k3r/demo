/* ============================================================
   UI enhancement layer — self-contained; builds on the existing
   sidebar by simulating clicks on its links. No app logic touched.

   Features:
   - Command palette (Ctrl+K) to jump to any sidebar destination
   - Sidebar quick-filter box
   - Mobile off-canvas navigation (hamburger + backdrop)
   - window.notify(msg, type) toast API
   - Scroll-to-top button
   - Keyboard shortcut help (?)
   - Tooltips for the collapsed icon rail
   ============================================================ */
(function () {
    'use strict';

    /* ----------------------------------------------------------
       Toasts — window.notify(message, type, durationMs)
       type: 'info' | 'success' | 'error' | 'warn'
    ---------------------------------------------------------- */
    function ensureToastHost() {
        let host = document.getElementById('toast-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'toast-host';
            document.body.appendChild(host);
        }
        return host;
    }

    window.notify = function (message, type = 'info', duration = 3200) {
        const icons = { info: 'ℹ️', success: '✅', error: '⚠️', warn: '⚠️' };
        const t = document.createElement('div');
        t.className = 'toast toast-' + type;
        const ico = document.createElement('span');
        ico.className = 'toast-ico';
        ico.textContent = icons[type] || icons.info;
        const msg = document.createElement('span');
        msg.textContent = message;
        t.append(ico, msg);
        ensureToastHost().appendChild(t);
        requestAnimationFrame(() => t.classList.add('toast-in'));
        setTimeout(() => {
            t.classList.remove('toast-in');
            setTimeout(() => t.remove(), 350);
        }, duration);
    };

    /* ----------------------------------------------------------
       Undo for deletes (roadmap Phase 5) — window.notifyUndo(msg,
       onUndo, toastMs, onExpire)
       Delete sites call this AFTER removing + saving; onUndo
       restores the snapshot + saves again. The toast is only the
       prompt — every deletion also lands in the "Recently deleted"
       tray (↩ chip, bottom-right) and stays restorable for the
       whole page session. Restore closures are live code, so the
       tray cannot survive a reload/close; `onExpire` (irreversible
       cleanup, e.g. purging a stored photo) runs when an entry is
       evicted by the cap or on pagehide (best-effort).
    ---------------------------------------------------------- */
    const undoStack = []; // newest first
    const UNDO_STACK_MAX = 50;
    let undoPanel = null;

    function undoEvict(entry) {
        if (entry.done) return;
        entry.done = true;
        if (entry.onExpire) {
            try { entry.onExpire(); } catch (e) { console.error('post-undo cleanup failed:', e); }
        }
    }

    function undoRestore(entry) {
        if (entry.done) return;
        entry.done = true;
        const i = undoStack.indexOf(entry);
        if (i > -1) undoStack.splice(i, 1);
        try { entry.onUndo(); } catch (e) { console.error('undo failed:', e); }
        updateUndoTray();
    }

    function undoAge(ts) {
        const m = Math.floor((Date.now() - ts) / 60000);
        if (m < 1) return 'just now';
        if (m < 60) return m + ' min ago';
        return Math.floor(m / 60) + ' h ago';
    }

    function closeUndoPanel() {
        if (undoPanel) { undoPanel.remove(); undoPanel = null; }
    }

    function openUndoPanel() {
        closeUndoPanel();
        if (!undoStack.length) return;
        undoPanel = document.createElement('div');
        undoPanel.id = 'undo-tray-panel';
        const head = document.createElement('div');
        head.className = 'utp-head';
        head.textContent = 'Recently deleted';
        const hint = document.createElement('div');
        hint.className = 'utp-hint';
        hint.textContent = 'Restorable until you close or reload this page.';
        undoPanel.append(head, hint);
        undoStack.forEach(entry => {
            const row = document.createElement('div');
            row.className = 'utp-row';
            const txt = document.createElement('span');
            txt.className = 'utp-label';
            txt.textContent = entry.label;
            const age = document.createElement('span');
            age.className = 'utp-age';
            age.textContent = undoAge(entry.time);
            const btn = document.createElement('button');
            btn.className = 'toast-undo-btn';
            btn.textContent = 'Restore';
            btn.addEventListener('click', () => { undoRestore(entry); });
            row.append(txt, age, btn);
            undoPanel.appendChild(row);
        });
        document.body.appendChild(undoPanel);
    }

    function updateUndoTray() {
        let chip = document.getElementById('undo-tray-chip');
        if (!undoStack.length) {
            if (chip) chip.remove();
            closeUndoPanel();
            return;
        }
        if (!chip) {
            chip = document.createElement('button');
            chip.id = 'undo-tray-chip';
            chip.title = 'Recently deleted — click to restore items';
            chip.addEventListener('click', () => {
                if (undoPanel) closeUndoPanel(); else openUndoPanel();
            });
            document.body.appendChild(chip);
        }
        chip.textContent = '↩ Deleted (' + undoStack.length + ')';
        if (undoPanel) openUndoPanel(); // refresh open panel
    }

    // best-effort irreversible cleanup when the page is going away
    window.addEventListener('pagehide', () => { undoStack.forEach(undoEvict); });

    window.notifyUndo = function (message, onUndo, duration = 7000, onExpire) {
        const entry = { label: message, time: Date.now(), onUndo: onUndo, onExpire: onExpire, done: false };
        undoStack.unshift(entry);
        while (undoStack.length > UNDO_STACK_MAX) undoEvict(undoStack.pop());
        updateUndoTray();

        const t = document.createElement('div');
        t.className = 'toast toast-warn toast-undo';
        const ico = document.createElement('span');
        ico.className = 'toast-ico';
        ico.textContent = '🗑️';
        const msg = document.createElement('span');
        msg.textContent = message;
        const btn = document.createElement('button');
        btn.className = 'toast-undo-btn';
        btn.textContent = 'Undo';
        t.append(ico, msg, btn);

        let dismissed = false;
        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            t.classList.remove('toast-in');
            setTimeout(() => t.remove(), 350);
        };
        btn.addEventListener('click', () => { undoRestore(entry); dismiss(); });
        // hovering pauses auto-dismiss; the entry stays in the tray either way
        let timer = setTimeout(dismiss, duration);
        t.addEventListener('mouseenter', () => clearTimeout(timer));
        t.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 2500); });
        ensureToastHost().appendChild(t);
        requestAnimationFrame(() => t.classList.add('toast-in'));
    };

    /* ----------------------------------------------------------
       Command palette (Ctrl+K)
    ---------------------------------------------------------- */
    let paletteOverlay = null;
    let paletteResults = [];
    let paletteSel = 0;

    function collectNavTargets() {
        const out = [];
        const els = document.querySelectorAll(
            '.sidebar .nav-link:not(#sidebar-logout), .sidebar .nav-item-header[id]:not(.has-children)');
        els.forEach(el => {
            // skip permission-hidden entries (display:none inline on a parent)
            for (let p = el; p && p !== document.body; p = p.parentElement) {
                if (p.style && p.style.display === 'none') return;
            }
            const labelEl = el.querySelector('.nav-label');
            const label = (labelEl ? labelEl.textContent : el.textContent).trim();
            if (!label) return;
            // breadcrumb from ancestor accordion headers
            const crumbs = [];
            let sub = el.closest('.nav-submenu');
            while (sub) {
                const head = sub.previousElementSibling;
                if (head && head.classList.contains('nav-item-header')) {
                    const hl = head.querySelector('.nav-label');
                    if (hl) crumbs.unshift(hl.textContent.trim());
                    sub = head.closest('.nav-submenu');
                } else break;
            }
            const iconEl = el.querySelector('.nav-icon');
            out.push({
                label,
                path: crumbs.join(' › '),
                icon: iconEl ? iconEl.textContent.trim() : '',
                el
            });
        });
        return out;
    }

    function scoreMatch(hay, needle) {
        hay = hay.toLowerCase();
        const idx = hay.indexOf(needle);
        if (idx === 0) return 100;
        if (idx > 0) return 60 - Math.min(idx, 30);
        // subsequence fallback (e.g. "hgang" -> "Harvesting Gang")
        let i = 0;
        for (const ch of hay) {
            if (ch === needle[i]) i++;
            if (i === needle.length) return 20;
        }
        return -1;
    }

    function navigateTo(target) {
        // expand ancestor groups so the sidebar reflects the destination
        let sub = target.el.closest('.nav-submenu');
        while (sub) {
            const head = sub.previousElementSibling;
            if (head && head.classList.contains('nav-item-header')) {
                head.classList.add('open');
                sub = head.closest('.nav-submenu');
            } else break;
        }
        closePalette();
        closeMobileNav();
        target.el.click();
    }

    function renderPaletteList(query) {
        const list = paletteOverlay.querySelector('#cmd-palette-list');
        const all = collectNavTargets();
        const q = query.trim().toLowerCase();
        paletteResults = !q ? all : all
            .map(t => ({ t, s: Math.max(scoreMatch(t.label, q), scoreMatch(t.path + ' ' + t.label, q) - 5) }))
            .filter(x => x.s >= 0)
            .sort((a, b) => b.s - a.s)
            .map(x => x.t);
        paletteSel = 0;
        list.innerHTML = '';
        if (!paletteResults.length) {
            const empty = document.createElement('div');
            empty.className = 'cp-empty';
            empty.textContent = 'No matching section';
            list.appendChild(empty);
            return;
        }
        paletteResults.forEach((t, i) => {
            const li = document.createElement('li');
            if (i === paletteSel) li.classList.add('sel');
            const ico = document.createElement('span');
            ico.className = 'cp-ico';
            ico.textContent = t.icon || '·';
            const lbl = document.createElement('span');
            lbl.textContent = t.label;
            li.append(ico, lbl);
            if (t.path) {
                const path = document.createElement('span');
                path.className = 'cp-path';
                path.textContent = t.path;
                li.appendChild(path);
            }
            li.addEventListener('mouseenter', () => setPaletteSel(i));
            li.addEventListener('click', () => navigateTo(t));
            list.appendChild(li);
        });
    }

    function setPaletteSel(i) {
        paletteSel = i;
        const items = paletteOverlay.querySelectorAll('#cmd-palette-list li');
        items.forEach((li, j) => li.classList.toggle('sel', j === paletteSel));
        const sel = items[paletteSel];
        if (sel) sel.scrollIntoView({ block: 'nearest' });
    }

    function openPalette() {
        // not useful before login
        const login = document.getElementById('login-overlay');
        if (login && login.style.display !== 'none') return;
        if (paletteOverlay) { closePalette(); return; }

        paletteOverlay = document.createElement('div');
        paletteOverlay.id = 'cmd-palette-overlay';
        paletteOverlay.innerHTML =
            '<div id="cmd-palette">' +
            '  <input type="text" placeholder="Jump to a section…" aria-label="Search sections" />' +
            '  <ul id="cmd-palette-list"></ul>' +
            '  <div id="cmd-palette-foot">' +
            '    <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>' +
            '    <span><kbd>Enter</kbd> open</span>' +
            '    <span><kbd>Esc</kbd> close</span>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(paletteOverlay);

        const input = paletteOverlay.querySelector('input');
        input.addEventListener('input', () => renderPaletteList(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (paletteResults.length) setPaletteSel((paletteSel + 1) % paletteResults.length); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); if (paletteResults.length) setPaletteSel((paletteSel - 1 + paletteResults.length) % paletteResults.length); }
            else if (e.key === 'Enter') { e.preventDefault(); if (paletteResults[paletteSel]) navigateTo(paletteResults[paletteSel]); }
        });
        paletteOverlay.addEventListener('mousedown', (e) => {
            if (e.target === paletteOverlay) closePalette();
        });
        renderPaletteList('');
        input.focus();
    }

    function closePalette() {
        if (paletteOverlay) { paletteOverlay.remove(); paletteOverlay = null; }
    }

    /* ----------------------------------------------------------
       Header search button (palette discoverability)
    ---------------------------------------------------------- */
    function initHeaderSearch() {
        const right = document.querySelector('.header-right');
        if (!right || document.getElementById('global-search-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'global-search-btn';
        btn.title = 'Search sections (Ctrl+K)';
        btn.innerHTML = '<span>🔍</span><span class="gsb-label">Search</span><kbd>Ctrl K</kbd>';
        btn.addEventListener('click', openPalette);
        right.insertBefore(btn, right.firstChild);
    }

    /* ----------------------------------------------------------
       Sidebar quick filter
    ---------------------------------------------------------- */
    function initSidebarFilter() {
        const nav = document.querySelector('.sidebar-nav');
        if (!nav || document.querySelector('.nav-filter-wrap')) return;
        const wrap = document.createElement('div');
        wrap.className = 'nav-filter-wrap';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'nav-filter-input';
        input.placeholder = '🔍 Filter menu…';
        input.setAttribute('aria-label', 'Filter menu');
        wrap.appendChild(input);
        nav.parentElement.insertBefore(wrap, nav);

        const sidebar = document.querySelector('.sidebar');
        input.addEventListener('input', () => {
            const q = input.value.toLowerCase().trim();
            sidebar.classList.toggle('nav-filtering', !!q);
            sidebar.querySelectorAll('.nav-item').forEach(li => {
                li.classList.toggle('nav-filter-hide', !!q && !li.textContent.toLowerCase().includes(q));
            });
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                input.value = '';
                input.dispatchEvent(new Event('input'));
                input.blur();
            }
        });
    }

    /* ----------------------------------------------------------
       Mobile off-canvas navigation
    ---------------------------------------------------------- */
    function initMobileNav() {
        const headerLeft = document.querySelector('.header-left');
        if (!headerLeft || document.getElementById('mobile-nav-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'mobile-nav-btn';
        btn.title = 'Menu';
        btn.textContent = '☰';
        headerLeft.insertBefore(btn, headerLeft.firstChild);

        const backdrop = document.createElement('div');
        backdrop.id = 'mobile-nav-backdrop';
        document.body.appendChild(backdrop);

        btn.addEventListener('click', () => {
            document.getElementById('app-layout-main')?.classList.remove('sidebar-collapsed');
            document.body.classList.toggle('mobile-nav-open');
        });
        backdrop.addEventListener('click', closeMobileNav);
        document.addEventListener('click', (e) => {
            if (document.body.classList.contains('mobile-nav-open') && e.target.closest('.sidebar .nav-link')) {
                closeMobileNav();
            }
        });
    }

    function closeMobileNav() {
        document.body.classList.remove('mobile-nav-open');
    }

    /* ----------------------------------------------------------
       Scroll-to-top button
    ---------------------------------------------------------- */
    function initScrollTop() {
        if (document.getElementById('scroll-top-btn')) return;
        const b = document.createElement('button');
        b.id = 'scroll-top-btn';
        b.title = 'Back to top';
        b.textContent = '↑';
        document.body.appendChild(b);
        window.addEventListener('scroll', () => {
            b.classList.toggle('show', window.scrollY > 400);
        }, { passive: true });
        b.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    /* ----------------------------------------------------------
       Keyboard shortcut help (?)
    ---------------------------------------------------------- */
    let helpOverlay = null;

    function toggleHelp() {
        if (helpOverlay) { closeHelp(); return; }
        helpOverlay = document.createElement('div');
        helpOverlay.id = 'help-overlay';
        helpOverlay.innerHTML =
            '<div class="help-modal">' +
            '  <h3>⌨️ Keyboard shortcuts</h3>' +
            '  <div class="help-row"><span>Search / jump to a section</span><span><kbd>Ctrl</kbd> + <kbd>K</kbd></span></div>' +
            '  <div class="help-row"><span>Move through search results</span><span><kbd>↑</kbd> <kbd>↓</kbd> then <kbd>Enter</kbd></span></div>' +
            '  <div class="help-row"><span>Close dialogs / menu</span><span><kbd>Esc</kbd></span></div>' +
            '  <div class="help-row"><span>Show this help</span><span><kbd>?</kbd></span></div>' +
            '  <div class="help-row"><span>Filter the sidebar menu</span><span>type in the 🔍 box</span></div>' +
            '</div>';
        helpOverlay.addEventListener('mousedown', (e) => {
            if (e.target === helpOverlay) closeHelp();
        });
        document.body.appendChild(helpOverlay);
    }

    function closeHelp() {
        if (helpOverlay) { helpOverlay.remove(); helpOverlay = null; }
    }

    /* ----------------------------------------------------------
       Tooltips for the collapsed icon rail
    ---------------------------------------------------------- */
    function initTooltips() {
        document.querySelectorAll('.sidebar .nav-link, .sidebar .nav-item-header').forEach(el => {
            if (!el.title) {
                const l = el.querySelector('.nav-label');
                if (l) el.title = l.textContent.trim();
            }
        });
    }

    /* ----------------------------------------------------------
       Deep links — open any view in a new tab via #nav=<sidebar-id>
       Gives every sidebar link a real href so the browser's native
       "Open link in new tab" / middle-click work, and replays the
       click on that link once the app has finished initialising.
    ---------------------------------------------------------- */
    // action links (downloads, imports, backup, logout) are not views
    const DEEPLINK_EXCLUDE = /^sidebar-(logout|download-|import-|export-|backup-)/;

    function initDeepLinks() {
        document.querySelectorAll('.sidebar .nav-link[id], .sidebar .nav-item-header[id]').forEach(el => {
            if (DEEPLINK_EXCLUDE.test(el.id)) return;
            const hash = '#nav=' + el.id;
            if (el.tagName === 'A') el.setAttribute('href', hash);
            // also enables the app's own right-click "Open in New Tab" menu
            el.setAttribute('data-view-hash', hash);
        });
        // keep the URL in sync on normal clicks so a refresh restores the view
        document.addEventListener('click', (e) => {
            const link = e.target.closest('.sidebar .nav-link[id], .sidebar .nav-item-header[id]');
            if (link && !DEEPLINK_EXCLUDE.test(link.id)) {
                history.replaceState(null, '', '#nav=' + link.id);
            }
        });
    }

    // an element hidden by the permission system (display:none / .hidden on
    // any ancestor) must never be reachable through deep links or the palette
    function navTargetHidden(el) {
        for (let p = el; p && p !== document.body; p = p.parentElement) {
            if (p.style && p.style.display === 'none') return true;
            if (p.classList && p.classList.contains('hidden')) return true;
        }
        return false;
    }

    function replayDeepLink() {
        const m = window.location.hash.match(/[#&]nav=([\w-]+)/);
        if (!m) return;
        const target = document.getElementById(m[1]);
        if (!target || DEEPLINK_EXCLUDE.test(m[1])) return;
        // wait until login is done and init has finished loading data
        const t0 = Date.now();
        const timer = setInterval(() => {
            const layout = document.getElementById('app-layout-main');
            const loading = document.getElementById('loading');
            const ready = layout && layout.style.display !== 'none' &&
                (!loading || loading.classList.contains('hidden'));
            if (ready) {
                clearInterval(timer);
                if (navTargetHidden(target)) return; // permission-hidden view
                // expand ancestor groups so the sidebar shows the location
                let sub = target.closest('.nav-submenu');
                while (sub) {
                    const head = sub.previousElementSibling;
                    if (head && head.classList.contains('nav-item-header')) {
                        head.classList.add('open');
                        sub = head.closest('.nav-submenu');
                    } else break;
                }
                setTimeout(() => target.click(), 80);
            } else if (Date.now() - t0 > 600000) {
                clearInterval(timer); // never logged in — give up quietly
            }
        }, 250);
    }

    /* ----------------------------------------------------------
       Unsaved-changes tracking (roadmap Phase 1)
       - mark dirty on edits to .edit-input/.ha-input inside <main>
       - clear on any Firebase write under /shared/ — several save
         fns are module-local, so the reliable choke point is the
         compat-SDK Reference prototype's set()
       - "● unsaved" badge in the header + beforeunload guard
       False-dirty is acceptable (one extra confirm); never block
       a save path on this layer failing.
    ---------------------------------------------------------- */
    let dirty = false;

    function ensureUnsavedBadge() {
        let b = document.getElementById('unsaved-badge');
        if (!b) {
            b = document.createElement('span');
            b.id = 'unsaved-badge';
            b.title = 'You have edits that are not saved to the cloud yet';
            b.textContent = '● unsaved';
            const userInfo = document.getElementById('header-user-info');
            const right = document.querySelector('.header-right');
            if (userInfo && userInfo.parentElement === right) {
                right.insertBefore(b, userInfo);
            } else if (right) {
                right.insertBefore(b, right.firstChild);
            }
        }
        return b;
    }

    function setDirty(on) {
        dirty = !!on;
        const b = ensureUnsavedBadge();
        if (b) b.classList.toggle('show', dirty);
    }
    window._markUnsaved = function () { setDirty(true); };

    function patchFirebaseSet() {
        try {
            if (!window.firebase || !firebase.apps || !firebase.apps.length) return false;
            const ref = firebase.database().ref('_ui_probe');
            let proto = Object.getPrototypeOf(ref);
            while (proto && !Object.prototype.hasOwnProperty.call(proto, 'set')) {
                proto = Object.getPrototypeOf(proto);
            }
            if (!proto || proto._unsavedPatched) return true;
            const origSet = proto.set;
            proto.set = function (...args) {
                const result = origSet.apply(this, args);
                try {
                    if (String(this.toString()).indexOf('/shared/') !== -1) {
                        if (result && typeof result.then === 'function') {
                            result.then(() => setDirty(false)).catch(() => { });
                        } else {
                            setDirty(false);
                        }
                    }
                } catch (_) { /* never break a save */ }
                return result;
            };
            proto._unsavedPatched = true;
            return true;
        } catch (_) {
            return false;
        }
    }

    function initDirtyTracking() {
        document.addEventListener('input', (e) => {
            const el = e.target;
            if (!el || !el.matches || !el.matches('.edit-input, .ha-input')) return;
            if (!el.closest('main')) return;
            if (el.closest('#login-overlay, #forgot-pw-overlay, #first-login-overlay')) return;
            setDirty(true);
        }, true);

        // firebase app may not be initialised yet — retry briefly
        if (!patchFirebaseSet()) {
            let tries = 0;
            const timer = setInterval(() => {
                if (patchFirebaseSet() || ++tries > 40) clearInterval(timer);
            }, 250);
        }

        window.addEventListener('beforeunload', (e) => {
            if (!dirty) return;
            e.preventDefault();
            e.returnValue = '';
        });
    }

    /* ----------------------------------------------------------
       Dark mode toggle (roadmap Phase 8)
       html.dark is applied pre-paint by an inline head script;
       this just owns the header button, persistence and Chart.js
       defaults (charts draw with fixed colors, so axis/legend
       text must be re-tinted and visible charts re-rendered).
    ---------------------------------------------------------- */
    /* ----------------------------------------------------------
       Chart tooltips on click, not hover — moving the cursor
       across a chart no longer pops figures; click (or tap) a
       point to see them, leave the chart to clear them.
       Applies to every chart via Chart.js global defaults.
    ---------------------------------------------------------- */
    function initChartClickTooltips() {
        if (typeof Chart === 'undefined') {
            window.addEventListener('load', initChartClickTooltips, { once: true });
            return;
        }
        Chart.defaults.events = ['click', 'mouseout', 'touchstart'];
    }

    function applyChartTheme(dark) {
        if (typeof Chart === 'undefined') return;
        Chart.defaults.color = dark ? '#94a3b8' : '#666';
        Chart.defaults.borderColor = dark ? 'rgba(148,163,184,0.18)' : 'rgba(0,0,0,0.1)';
    }

    function initThemeToggle() {
        const right = document.querySelector('.header-right');
        if (!right || document.getElementById('theme-toggle-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'theme-toggle-btn';
        const sync = () => {
            const dark = document.documentElement.classList.contains('dark');
            btn.textContent = dark ? '☀️' : '🌙';
            btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
        };
        btn.addEventListener('click', () => {
            const dark = document.documentElement.classList.toggle('dark');
            try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) { }
            sync();
            applyChartTheme(dark);
            // charts cache their colors — re-render the dashboard if it's on screen
            const dash = document.getElementById('dashboard-wrapper');
            if (dash && !dash.classList.contains('hidden') && typeof window.renderDashboard === 'function') {
                window.renderDashboard();
            }
        });
        sync();
        applyChartTheme(document.documentElement.classList.contains('dark'));
        right.insertBefore(btn, right.firstChild);
    }

    /* ----------------------------------------------------------
       Print / save-as-PDF (roadmap Phase 6)
       The print stylesheet already strips chrome and outputs just
       the report — this button names the document after the
       current view (becomes the suggested PDF filename) and opens
       the browser print dialog ("Save as PDF" destination).
    ---------------------------------------------------------- */
    function currentViewTitle() {
        const wrappers = document.querySelectorAll('main .report-wrapper, main [id$="-wrapper"]');
        for (const w of wrappers) {
            if (w.classList.contains('hidden') || w.style.display === 'none') continue;
            if (!w.offsetParent && w.offsetWidth === 0) continue;
            const h = w.querySelector('h1, h2, h3');
            if (h && h.textContent.trim()) return h.textContent.trim();
        }
        return 'Harvesting Report';
    }

    function initPrintButton() {
        const right = document.querySelector('.header-right');
        if (!right || document.getElementById('print-pdf-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'print-pdf-btn';
        btn.title = 'Print or save the current view as PDF (Ctrl+P)';
        btn.innerHTML = '<span>🖨️</span><span class="ppb-label">PDF</span>';
        btn.addEventListener('click', () => {
            const oldTitle = document.title;
            const d = new Date();
            const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            document.title = currentViewTitle().replace(/[\\/:*?"<>|]/g, '-') + ' — ' + stamp;
            const restore = () => { document.title = oldTitle; window.removeEventListener('afterprint', restore); };
            window.addEventListener('afterprint', restore);
            setTimeout(restore, 60000); // safety net if afterprint never fires
            window.print();
        });
        const search = document.getElementById('global-search-btn');
        right.insertBefore(btn, search ? search.nextSibling : right.firstChild);
    }

    /* ----------------------------------------------------------
       Offline support (roadmap Phase 4)
       - registers sw.js (app shell + CDN libs cached for offline)
       - "📡 offline" header badge + reconnect toast. The RTDB web
         SDK queues writes in memory and flushes them on reconnect,
         but a reload while offline loses queued writes — hence the
         badge warns to stay on the page.
    ---------------------------------------------------------- */
    function initOffline() {
        if ('serviceWorker' in navigator &&
            (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
            navigator.serviceWorker.register('sw.js').then(reg => {
                // Auto-pick-up new deploys: when an updated worker finishes installing
                // (and one was already running, i.e. this is an update — not the first
                // install), reload once so the page runs the fresh code instead of a
                // stale cache. Avoids the "I deployed but it looks the same" trap.
                reg.addEventListener('updatefound', () => {
                    const nw = reg.installing;
                    if (!nw) return;
                    nw.addEventListener('statechange', () => {
                        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                            if (typeof window.notify === 'function') window.notify('Updated to the latest version — refreshing…', 'info', 1500);
                            setTimeout(() => location.reload(), 1200);
                        }
                    });
                });
                // Check for a new version periodically while the app is open.
                setInterval(() => { try { reg.update(); } catch (e) {} }, 60000);
            }).catch(() => { /* offline support is best-effort */ });
        }

        let badge = document.getElementById('offline-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.id = 'offline-badge';
            badge.title = 'No connection — keep this page open; changes sync when you are back online';
            badge.textContent = '📡 offline';
            const right = document.querySelector('.header-right');
            if (right) right.insertBefore(badge, right.firstChild);
        }
        const update = () => badge.classList.toggle('show', !navigator.onLine);
        window.addEventListener('online', () => {
            update();
            window.notify('Back online — changes are syncing.', 'success');
        });
        window.addEventListener('offline', () => {
            update();
            window.notify('You are offline. Keep this page open — edits will sync when the connection returns.', 'warn', 5000);
        });
        update();
    }

    /* ----------------------------------------------------------
       Global key bindings
    ---------------------------------------------------------- */
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            openPalette();
            return;
        }
        if (e.key === 'Escape') {
            closePalette();
            closeHelp();
            closeMobileNav();
            closeUndoPanel();
            return;
        }
        const tag = (e.target.tagName || '').toLowerCase();
        const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
        if (!typing && e.key === '?') {
            e.preventDefault();
            toggleHelp();
        }
    });

    /* ----------------------------------------------------------
       Init
    ---------------------------------------------------------- */
    function init() {
        initHeaderSearch();
        initSidebarFilter();
        initMobileNav();
        initScrollTop();
        initTooltips();
        initDeepLinks();
        replayDeepLink();
        initDirtyTracking();
        initOffline();
        initPrintButton();
        initThemeToggle();
        initChartClickTooltips();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
