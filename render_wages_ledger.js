// =====================================================================
// render_wages_ledger.js — Wage Ledger (detailed actuals) module
// ---------------------------------------------------------------------
// The "Rate of Wages" calculator (render_wages.js) is a per-gang MONTHLY
// estimator. This module stores the detailed ACTUALS ledger that sits
// behind those payments — imported from the user's monthly Excel, which
// has three independent wage schemes on three sheets:
//
//   • Harvester       — per harvest ticket/employee
//                       Ripe Amount = Weight(KG) × Ripe Unit Price (+ Bags + Daily Piece Rate)
//   • Driver & loader — per delivery ticket
//                       each Amount = Weight MT × that role's Unit Price
//   • jobcardpr       — per job card
//                       Amount = Unit Done × Pay Rate
//
// Dates in the source are Excel serial numbers (e.g. 46113) — converted
// to ISO on import. A matching downloadable template lets future months
// drop in cleanly.
//
// Storage: Firebase  shared/wages_ledger_data   (window._wagesLedgerDb)
// Surfaced as the "Wage Ledger" sub-tab under 💵 Rate of Wages.
// Access:  menu key 'wages'  (window._canEdit / _applyReadOnly) — shared
//          with the calculator; template is available to read-only users.
// =====================================================================

(function () {
    'use strict';

    const WL_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const WL_MAX_ROWS_SHOWN = 500;   // default DOM rows per category; "Show all" expands (totals always cover everything)
    const _wlShowAll = new Set();    // scheme keys the user has expanded to full
    const _wlFilters = {};           // scheme → { colKey: filterText } — per-column header filters
    const wlClearAllFilters = () => { Object.keys(_wlFilters).forEach(k => delete _wlFilters[k]); };

    // HTML-escape DB/user free text before innerHTML (shared data → untrusted).
    const wlEsc = (s) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s == null ? '' : s));

    // Robust number: handles ExcelJS formula objects ({ result }) and "-".
    const wlNum = (v) => {
        if (v && typeof v === 'object' && 'result' in v) v = v.result;
        const n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    };
    // Robust text: handles ExcelJS rich-text / hyperlink / formula objects.
    const wlText = (v) => {
        if (v && typeof v === 'object') {
            if ('result' in v) v = v.result;
            else if ('text' in v) v = v.text;
            else if (Array.isArray(v.richText)) v = v.richText.map(t => t.text).join('');
        }
        return String(v == null ? '' : v).trim();
    };
    const wlRM = (n) => 'RM' + wlNum(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const wlPad = (n) => String(n).padStart(2, '0');

    // Excel cell (Date / ISO string / serial) → 'YYYY-MM-DD'. Mirrors mntToISO.
    const wlToISO = (v) => {
        if (v == null || v === '') return '';
        if (v instanceof Date) return `${v.getFullYear()}-${wlPad(v.getMonth() + 1)}-${wlPad(v.getDate())}`;
        if (typeof v === 'object' && v !== null && 'result' in v) return wlToISO(v.result);
        if (typeof v === 'number') {
            const d = new Date(Math.round((v - 25569) * 86400000));   // Excel 1900 epoch
            return `${d.getUTCFullYear()}-${wlPad(d.getUTCMonth() + 1)}-${wlPad(d.getUTCDate())}`;
        }
        const s = String(v).trim();
        if (s === '-' || s === '') return '';
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        if (!isNaN(d)) return `${d.getFullYear()}-${wlPad(d.getMonth() + 1)}-${wlPad(d.getDate())}`;
        return s;   // keep unparseable text as-is rather than dropping it
    };

    // Normalise a header cell for comparison (mirror mntNormHeader).
    const wlNormHeader = (h) => wlText(h).toUpperCase().replace(/[^A-Z0-9]/g, '');

    const wlCurrentYear = () => String(new Date().getFullYear());
    const wlCurrentMonth = () => WL_MONTHS[new Date().getMonth()];

    // ── Column specs (single source of truth for template, import, render) ──
    // type: text | num | money | date.  amount:true → auto-compute when blank.
    // dropdown: 'gang' | 'block' → list data-validation in the template.
    const SCHEMES = {
        harvester: {
            label: 'Harvester', sheet: 'Harvester',
            sig: ['RIPEBUNCHES', 'RIPEUNITPRICE'],     // header-signature tokens
            cols: [
                { key: 'no', header: 'No.', type: 'num', w: 6 },
                { key: 'deliveryDate', header: 'Delivery Date', type: 'date', w: 14 },
                { key: 'harvestingDate', header: 'Harvesting Date', type: 'date', w: 14 },
                { key: 'ticketNo', header: 'Ticket No.', type: 'text', w: 12 },
                { key: 'rampChitNo', header: 'Ramp Chit No.', type: 'text', w: 13 },
                { key: 'block', header: 'Block', type: 'text', w: 9, dropdown: 'block' },
                { key: 'gang', header: 'Gang', type: 'text', w: 16, dropdown: 'gang' },
                { key: 'employee', header: 'Employee', type: 'text', w: 24 },
                { key: 'ripeBunches', header: 'Ripe Bunches', type: 'num', w: 11 },
                { key: 'weightKg', header: 'Weight (KG)', type: 'num', w: 11 },
                { key: 'ripeUnitPrice', header: 'Ripe Unit Price', type: 'money', w: 12 },
                { key: 'ripeAmount', header: 'Ripe Amount (RM)', type: 'money', w: 14, amount: true, qty: 'weightKg', rate: 'ripeUnitPrice' },
                { key: 'bags', header: 'Bags', type: 'num', w: 8 },
                { key: 'bagsAmount', header: 'Bags Amount (RM)', type: 'money', w: 14 },
                { key: 'dailyPieceRate', header: 'Daily Piece Rate', type: 'money', w: 13 },
            ],
            // a ledger row's total pay = these fields summed
            payFields: ['ripeAmount', 'bagsAmount', 'dailyPieceRate'],
            keyField: 'employee',
        },
        driverLoader: {
            label: 'Driver & Loader', sheet: 'Driver & loader',
            sig: ['DRIVERUNITPRICE', 'WEIGHTMT'],
            cols: [
                { key: 'no', header: 'No.', type: 'num', w: 6 },
                { key: 'deliveryDate', header: 'Delivery Date', type: 'date', w: 14 },
                { key: 'ticketNo', header: 'Ticket No.', type: 'text', w: 12 },
                { key: 'rampChitNo', header: 'Ramp Chit No.', type: 'text', w: 13 },
                { key: 'block', header: 'Block', type: 'text', w: 9, dropdown: 'block' },
                { key: 'gang', header: 'Gang', type: 'text', w: 16, dropdown: 'gang' },
                { key: 'driver', header: 'Driver', type: 'text', w: 22 },
                { key: 'weightMt', header: 'Weight MT', type: 'num', w: 10 },
                { key: 'driverUnitPrice', header: 'Driver Unit Price', type: 'money', w: 13 },
                { key: 'driverAmount', header: 'Driver Amount (RM)', type: 'money', w: 14, amount: true, qty: 'weightMt', rate: 'driverUnitPrice' },
                { key: 'loader', header: 'Loader', type: 'text', w: 22 },
                { key: 'loaderUnitPrice', header: 'Loader Unit Price', type: 'money', w: 13 },
                { key: 'loaderAmount', header: 'Loader Amount (RM)', type: 'money', w: 14, amount: true, qty: 'weightMt', rate: 'loaderUnitPrice' },
                { key: 'loader2', header: 'Loader 2', type: 'text', w: 18 },
                { key: 'loader2Amount', header: 'Loader 2 Amount (RM)', type: 'money', w: 16 },
                { key: 'lorryDriver', header: 'Lorry Driver', type: 'text', w: 22 },
                { key: 'lorryDriverUnitPrice', header: 'Lorry Driver Unit Price', type: 'money', w: 15 },
                { key: 'lorryAmount', header: 'Lorry Amount (RM)', type: 'money', w: 14, amount: true, qty: 'weightMt', rate: 'lorryDriverUnitPrice' },
            ],
            payFields: ['driverAmount', 'loaderAmount', 'loader2Amount', 'lorryAmount'],
            keyField: null,   // require any of driver/loader/lorryDriver (see wlRowHasKey)
        },
        jobcard: {
            label: 'Job Card', sheet: 'jobcardpr',
            sig: ['JOBCARDNO', 'JOBACTIVITY'],
            cols: [
                { key: 'no', header: 'No.', type: 'num', w: 6 },
                { key: 'gang', header: 'Gang', type: 'text', w: 16, dropdown: 'gang' },
                { key: 'employee', header: 'Employee', type: 'text', w: 24 },
                { key: 'jobCardNo', header: 'Job Card No.', type: 'text', w: 16 },
                { key: 'jobDate', header: 'Job Date', type: 'date', w: 13 },
                { key: 'startDate', header: 'Start Date', type: 'date', w: 13 },
                { key: 'completeDate', header: 'Complete Date', type: 'date', w: 14 },
                { key: 'block', header: 'Block', type: 'text', w: 9, dropdown: 'block' },
                { key: 'jobActivity', header: 'Job Activity', type: 'text', w: 30 },
                { key: 'unitDone', header: 'Unit Done', type: 'num', w: 10 },
                { key: 'payRate', header: 'Pay Rate', type: 'money', w: 10 },
                { key: 'amount', header: 'Amount (RM)', type: 'money', w: 13, amount: true, qty: 'unitDone', rate: 'payRate' },
            ],
            payFields: ['amount'],
            keyField: 'employee',
        },
    };
    const SCHEME_KEYS = ['harvester', 'driverLoader', 'jobcard'];

    // Pre-built map: scheme → { NORMALIZEDHEADER : fieldKey } (from the specs).
    const wlFieldMaps = {};
    SCHEME_KEYS.forEach(sk => {
        const map = {};
        SCHEMES[sk].cols.forEach(c => { map[wlNormHeader(c.header)] = c.key; });
        wlFieldMaps[sk] = map;
    });

    const wlRowPay = (scheme, row) => SCHEMES[scheme].payFields.reduce((s, f) => s + wlNum(row[f]), 0);
    const wlRowHasKey = (scheme, row) => {
        if (scheme === 'driverLoader') {
            // Require an actual person — this excludes the sheet's TOTALS row,
            // which carries weights/amounts but no driver/loader/lorry names.
            return !!(String(row.driver || '').trim() || String(row.loader || '').trim() || String(row.lorryDriver || '').trim());
        }
        const kf = SCHEMES[scheme].keyField;
        return kf ? String(row[kf] || '').trim() !== '' : true;
    };

    // ── State helpers ───────────────────────────────────────────────────
    const wlEnsureMonth = (year, month) => {
        if (!window.state.wagesLedger) window.state.wagesLedger = {};
        if (!window.state.wagesLedger[year]) window.state.wagesLedger[year] = {};
        if (!window.state.wagesLedger[year][month]) {
            window.state.wagesLedger[year][month] = { harvester: [], driverLoader: [], jobcard: [] };
        }
        const m = window.state.wagesLedger[year][month];
        SCHEME_KEYS.forEach(sk => { if (!Array.isArray(m[sk])) m[sk] = []; });
        return m;
    };

    const wlYearList = () => {
        const set = new Set();
        [window.state.wagesLedger, window.state.wages, window.state.performance, window.state.gangsByYear]
            .forEach(obj => { if (obj) Object.keys(obj).forEach(k => { if (/^\d{4}$/.test(k)) set.add(k); }); });
        set.add(wlCurrentYear());
        return [...set].sort((a, b) => parseInt(b) - parseInt(a));
    };

    // Gangs (union of harvesting + maintenance + saved wages) for template dropdowns.
    const wlGangList = (year) => {
        const set = new Set();
        ((window.state.gangsByYear && window.state.gangsByYear[year]) || []).forEach(g => { if (g) set.add(g); });
        const mnt = (window.state.maintenance && window.state.maintenance[year] && window.state.maintenance[year].gangs) || {};
        Object.keys(mnt).forEach(g => { if (g) set.add(g); });
        const wg = (window.state.wages && window.state.wages[year] && window.state.wages[year].gangs) || {};
        Object.keys(wg).forEach(g => { if (g) set.add(g); });
        return [...set].sort((a, b) => a.localeCompare(b));
    };

    const wlBlockList = (year) => {
        const rows = (window.state.reports && window.state.reports[year]) || [];
        const ids = [...new Set(rows.map(r => String(r.block_id)).filter(Boolean))];
        ids.sort((a, b) => {
            const na = parseFloat(a), nb = parseFloat(b);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
            return a.localeCompare(b);
        });
        return ids;
    };

    // ── Firebase save ───────────────────────────────────────────────────
    const saveWageLedgerData = (silent) => {
        const db = window._wagesLedgerDb || window._wagesDb;
        if (!db) { if (!silent && window.notify) window.notify('Not connected to cloud — ledger not saved.', 'error'); return Promise.resolve(); }
        if (typeof window._markUnsaved === 'function') window._markUnsaved();
        return db.ref('shared/wages_ledger_data').set(JSON.stringify(window.state.wagesLedger))
            .then(() => { if (!silent && window.notify) window.notify('Wage ledger saved.', 'success'); })
            .catch(e => { if (window.notify) window.notify('Save failed: ' + e.message, 'error'); });
    };
    window.saveWageLedgerData = saveWageLedgerData;

    const wlEnsureExcelJS = async () => {
        if (typeof window.ExcelJS !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
            document.head.appendChild(s);
        });
    };

    // ── Styling (match the Reports / wages look) ────────────────────────
    const SS = 'padding:0.45rem 0.6rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);font-size:0.9rem;';
    const CARD = 'border:1px solid var(--border-color,#ddd);border-radius:8px;padding:1.1rem 1.25rem;margin-bottom:1rem;background:var(--bg-card,#fff);box-shadow:0 1px 3px rgba(0,0,0,0.05);';

    // =====================================================================
    // Main render
    // =====================================================================
    window.renderWagesLedgerView = () => {
        const host = document.getElementById('wages-ledger-wrapper');
        if (!host) return;

        const state = window.state;
        if (!state.wagesLedgerYear || !/^\d{4}$/.test(state.wagesLedgerYear)) state.wagesLedgerYear = wlCurrentYear();
        if (!state.wagesLedgerMonth || !WL_MONTHS.includes(state.wagesLedgerMonth)) state.wagesLedgerMonth = wlCurrentMonth();
        const year = state.wagesLedgerYear, month = state.wagesLedgerMonth;
        const canEdit = (typeof window._canEdit !== 'function') || window._canEdit('wages');

        const yearOpts = wlYearList().map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('');
        const monthOpts = WL_MONTHS.map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${m}</option>`).join('');

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:1300px;">
          <h2 style="margin:0 0 0.25rem; color:var(--text-primary);">📒 Wage Ledger</h2>
          <p style="color:var(--text-secondary); margin:0 0 1.1rem; font-size:0.85rem;">
            Detailed monthly actuals imported from Excel — Harvester, Driver &amp; Loader, and Job Card payments.
            Download the template, fill it (or use your existing report), then import.
            <br>Type in the boxes under any column header to filter rows (e.g. by gang, block or employee) — the table count and total update to the matching rows.
          </p>

          <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin-bottom:1.1rem;">
            <label style="font-size:0.82rem; color:var(--text-secondary);">Year
              <select id="wl-year" style="${SS} margin-left:4px;">${yearOpts}</select></label>
            <label style="font-size:0.82rem; color:var(--text-secondary);">Month
              <select id="wl-month" style="${SS} margin-left:4px;">${monthOpts}</select></label>
            <div style="flex:1;"></div>
            <button id="wl-dl-template" style="padding:0.45rem 1rem; border:1px solid var(--border-color,#ccc); border-radius:4px; background:var(--bg-card,#fff); color:var(--text-primary); cursor:pointer;" title="Download a blank import template for this month">⬇ Template</button>
            <button id="wl-import" class="btn-primary" style="padding:0.45rem 1rem; ${canEdit ? '' : 'opacity:.5; cursor:not-allowed;'}" ${canEdit ? '' : 'disabled'} title="${canEdit ? 'Import a filled Excel for this month' : 'You do not have edit access for wages'}">📥 Import</button>
            <input type="file" id="wl-import-input" accept=".xlsx,.xls" style="display:none;">
          </div>

          <div id="wl-body"></div>
        </div>`;

        host.querySelector('#wl-year').onchange = (e) => { state.wagesLedgerYear = e.target.value; wlClearAllFilters(); window.renderWagesLedgerView(); };
        host.querySelector('#wl-month').onchange = (e) => { state.wagesLedgerMonth = e.target.value; wlClearAllFilters(); window.renderWagesLedgerView(); };

        host.querySelector('#wl-dl-template').onclick = async () => {
            const btn = host.querySelector('#wl-dl-template');
            btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ Generating…';
            try { await downloadWageLedgerTemplate(year, month); }
            catch (err) { if (window.notify) window.notify('Template failed: ' + err.message, 'error'); }
            finally { btn.disabled = false; btn.textContent = old; }
        };

        if (canEdit) {
            const input = host.querySelector('#wl-import-input');
            host.querySelector('#wl-import').onclick = () => input.click();
            input.onchange = async () => {
                const file = input.files[0];
                input.value = '';
                if (file) await importWageLedger(file, year, month);
            };
        }

        wlRenderBody(year, month);
    };

    // ── Body: summary + per-category tables ─────────────────────────────
    const wlRenderBody = (year, month) => {
        const body = document.getElementById('wl-body');
        if (!body) return;
        const m = wlEnsureMonth(year, month);
        const counts = SCHEME_KEYS.map(sk => (m[sk] || []).length);
        const totalRows = counts.reduce((a, b) => a + b, 0);

        if (totalRows === 0) {
            body.innerHTML = `<div style="${CARD} text-align:center; color:var(--text-secondary);">
                No wage ledger data for <strong>${wlEsc(month)} ${wlEsc(year)}</strong> yet.<br><br>
                Click <strong>⬇ Template</strong> to get the import format, or <strong>📥 Import</strong> to load a filled Excel.
            </div>`;
            return;
        }

        // Totals per scheme + per-gang breakdown across all schemes
        const schemeTotals = {};
        const gangTotals = {};
        let grand = 0;
        SCHEME_KEYS.forEach(sk => {
            let t = 0;
            (m[sk] || []).forEach(row => {
                const pay = wlRowPay(sk, row);
                t += pay;
                const g = String(row.gang || '').trim() || '(no gang)';
                gangTotals[g] = (gangTotals[g] || 0) + pay;
            });
            schemeTotals[sk] = t;
            grand += t;
        });

        const gangRows = Object.entries(gangTotals).sort((a, b) => b[1] - a[1])
            .map(([g, v]) => `<tr><td style="padding:3px 8px;">${wlEsc(g)}</td><td style="padding:3px 8px; text-align:right;">${wlRM(v)}</td></tr>`).join('');

        // Job Card payments broken down by job activity (jobcard scheme only).
        const jobActivityTotals = {};
        const jobActivityCounts = {};
        (m.jobcard || []).forEach(row => {
            const act = String(row.jobActivity || '').trim() || '(no activity)';
            jobActivityTotals[act] = (jobActivityTotals[act] || 0) + wlRowPay('jobcard', row);
            jobActivityCounts[act] = (jobActivityCounts[act] || 0) + 1;
        });
        const jobActivityRows = Object.entries(jobActivityTotals).sort((a, b) => b[1] - a[1])
            .map(([a, v]) => `<tr><td style="padding:3px 8px;">${wlEsc(a)} <span style="color:var(--text-secondary); font-size:0.82em;">(${jobActivityCounts[a]})</span></td><td style="padding:3px 8px; text-align:right;">${wlRM(v)}</td></tr>`).join('');
        const jobCardActivityBlock = (m.jobcard && m.jobcard.length)
            ? `<div style="flex:1; min-width:260px;">
                 <div style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:4px;">Job Card — by activity</div>
                 <div style="max-height:220px; overflow:auto; border:1px solid var(--border-color,#e3e3e3); border-radius:6px;">
                   <table style="width:100%; border-collapse:collapse; font-size:0.85rem; color:var(--text-primary);">${jobActivityRows}</table>
                 </div>
               </div>`
            : '';

        const summary = `
        <div style="${CARD} background:var(--bg-main,#f7f9f7); border:2px solid var(--accent-color,#16a34a);">
          <h3 style="margin:0 0 0.7rem; font-size:1rem; color:var(--text-primary);">Summary — ${wlEsc(month)} ${wlEsc(year)}</h3>
          <div style="display:flex; gap:2rem; flex-wrap:wrap; align-items:flex-start;">
            <table style="border-collapse:collapse; font-size:0.9rem; color:var(--text-primary); min-width:280px;">
              ${SCHEME_KEYS.map((sk, i) => `<tr><td style="padding:4px 0;">${wlEsc(SCHEMES[sk].label)} <span style="color:var(--text-secondary);">(${counts[i]} rows)</span></td><td style="text-align:right; padding:4px 0 4px 1.5rem;">${wlRM(schemeTotals[sk])}</td></tr>`).join('')}
              <tr style="border-top:2px solid var(--border-color,#ccc); font-weight:700; font-size:1.05rem;">
                <td style="padding:8px 0;">Grand total</td><td style="text-align:right; padding:8px 0;">${wlRM(grand)}</td></tr>
            </table>
            <div style="flex:1; min-width:260px;">
              <div style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:4px;">Per gang (all schemes)</div>
              <div style="max-height:220px; overflow:auto; border:1px solid var(--border-color,#e3e3e3); border-radius:6px;">
                <table style="width:100%; border-collapse:collapse; font-size:0.85rem; color:var(--text-primary);">${gangRows}</table>
              </div>
            </div>
            ${jobCardActivityBlock}
          </div>
        </div>`;

        const sections = SCHEME_KEYS.map(sk => wlRenderTable(sk)).join('');
        body.innerHTML = summary + sections;

        // Delegated handlers (survive the partial tbody/note re-renders so the
        // filter inputs keep focus while you type):
        //  • typing in a column-header filter box → patch just that table
        //  • Show all / Show fewer toggle
        //  • Clear-filters button
        body.oninput = (e) => {
            const inp = e.target.closest && e.target.closest('.wl-col-filter');
            if (!inp) return;
            const sk = inp.dataset.scheme, col = inp.dataset.col;
            (_wlFilters[sk] || (_wlFilters[sk] = {}))[col] = inp.value;
            wlUpdateTable(sk);
        };
        body.onclick = (e) => {
            const tgl = e.target.closest && e.target.closest('.wl-toggle-rows');
            if (tgl) {
                const sk = tgl.dataset.scheme;
                if (_wlShowAll.has(sk)) _wlShowAll.delete(sk); else _wlShowAll.add(sk);
                wlUpdateTable(sk);
                return;
            }
            const clr = e.target.closest && e.target.closest('.wl-clear-filter');
            if (clr) {
                const sk = clr.dataset.scheme;
                _wlFilters[sk] = {};
                body.querySelectorAll(`.wl-col-filter[data-scheme="${sk}"]`).forEach(i => { i.value = ''; });
                wlUpdateTable(sk);
            }
        };
    };

    // ── Per-column header filters ───────────────────────────────────────
    // Plain (un-escaped) display text for a cell — used for both rendering
    // and contains-matching, so "what you see is what you filter".
    const wlCellPlain = (c, row) => {
        const v = row[c.key];
        if (c.type === 'money') return (v === '' || v == null) ? '' : wlNum(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (c.type === 'num') return (v === '' || v == null) ? '' : String(v);
        return String(v == null ? '' : v);
    };
    // Numerics are HTML-safe; escape everything else (text/date may be untrusted).
    const wlFmtCell = (c, row) => {
        const t = wlCellPlain(c, row);
        return (c.type === 'money' || c.type === 'num') ? t : wlEsc(t);
    };
    const wlActiveFilters = (scheme) =>
        Object.entries(_wlFilters[scheme] || {}).filter(([, v]) => String(v).trim() !== '');
    const wlFilterRows = (scheme, rows) => {
        const active = wlActiveFilters(scheme);
        if (!active.length) return rows;
        const byKey = {}; SCHEMES[scheme].cols.forEach(c => { byKey[c.key] = c; });
        const needles = active.map(([k, v]) => [byKey[k], String(v).toLowerCase().trim()]).filter(([c]) => c);
        return rows.filter(row => needles.every(([c, needle]) => wlCellPlain(c, row).toLowerCase().includes(needle)));
    };

    // Everything a table render/update needs, derived from current state + filters.
    const wlTableModel = (scheme) => {
        const m = wlEnsureMonth(window.state.wagesLedgerYear, window.state.wagesLedgerMonth);
        const rows = m[scheme] || [];
        const filtered = wlFilterRows(scheme, rows);
        const isFiltered = wlActiveFilters(scheme).length > 0;
        const showAll = _wlShowAll.has(scheme);
        const shown = showAll ? filtered : filtered.slice(0, WL_MAX_ROWS_SHOWN);
        const fullTotal = rows.reduce((s, r) => s + wlRowPay(scheme, r), 0);
        const filteredTotal = isFiltered ? filtered.reduce((s, r) => s + wlRowPay(scheme, r), 0) : fullTotal;
        return { rows, filtered, isFiltered, showAll, shown, fullTotal, filteredTotal, count: rows.length };
    };
    const wlCountText = (model) => model.isFiltered ? `· ${model.filtered.length} of ${model.count} rows` : `· ${model.count} rows`;
    const wlTotalLabel = (model) => model.isFiltered
        ? `${wlRM(model.filteredTotal)} <span style="font-weight:400; color:var(--text-secondary); font-size:0.76rem;">filtered &middot; ${wlRM(model.fullTotal)} total</span>`
        : wlRM(model.fullTotal);

    const wlRowsHTML = (scheme, shown) => {
        const cols = SCHEMES[scheme].cols;
        if (!shown.length) return `<tr><td colspan="${cols.length}" style="padding:16px; text-align:center; color:var(--text-secondary);">No rows match the column filters.</td></tr>`;
        return shown.map(row => `<tr>${cols.map(c => `<td style="padding:4px 8px; text-align:${c.type === 'text' ? 'left' : 'right'}; white-space:nowrap; border-bottom:1px solid var(--border-color,#eee);">${wlFmtCell(c, row)}</td>`).join('')}</tr>`).join('');
    };
    const wlMoreNoteHTML = (scheme, model) => {
        if (model.filtered.length <= WL_MAX_ROWS_SHOWN) return '';
        const shownTxt = model.showAll ? 'all ' + model.filtered.length : 'first ' + WL_MAX_ROWS_SHOWN + ' of ' + model.filtered.length;
        return `<div style="font-size:0.78rem; color:var(--text-secondary); padding:6px 10px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                  <span>Showing ${shownTxt} ${model.isFiltered ? 'matching ' : ''}rows — all rows remain stored and counted in the totals above.</span>
                  <button class="wl-toggle-rows" data-scheme="${scheme}" style="font-size:0.78rem; padding:0.2rem 0.6rem; border:1px solid var(--border-color,#ccc); border-radius:4px; background:var(--bg-card,#fff); color:var(--text-primary); cursor:pointer;">${model.showAll ? 'Show fewer' : 'Show all ' + model.filtered.length}</button>
                </div>`;
    };

    const wlRenderTable = (scheme) => {
        const spec = SCHEMES[scheme];
        const model = wlTableModel(scheme);
        if (!model.count) return '';
        // Each <th> stacks the column label over a filter input — one sticky
        // header row, so no offset math for a separate filter row.
        const head = spec.cols.map(c => {
            const align = c.type === 'text' ? 'left' : 'right';
            const val = (_wlFilters[scheme] && _wlFilters[scheme][c.key]) || '';
            return `<th style="padding:5px 8px; text-align:${align}; white-space:nowrap; border-bottom:2px solid var(--border-color,#ccc); position:sticky; top:0; background:var(--bg-card,#fff); vertical-align:top; z-index:1;">
                      <div style="margin-bottom:4px;">${wlEsc(c.header)}</div>
                      <input type="text" class="wl-col-filter" data-scheme="${scheme}" data-col="${wlEsc(c.key)}" value="${wlEsc(val)}" placeholder="🔎" title="Filter ${wlEsc(c.header)}" style="width:100%; min-width:64px; box-sizing:border-box; font-weight:400; font-size:0.72rem; padding:2px 5px; border:1px solid var(--border-color,#ccc); border-radius:3px; background:var(--bg-card,#fff); color:var(--text-primary); text-align:${align};">
                    </th>`;
        }).join('');

        return `
        <div style="${CARD} padding:0; overflow:hidden;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:0.8rem 1.1rem; background:var(--bg-main,#f3f5f3); border-bottom:1px solid var(--border-color,#e0e0e0);">
            <h3 style="margin:0; font-size:0.98rem; color:var(--text-primary);">${wlEsc(spec.label)} <span id="wl-count-${scheme}" style="color:var(--text-secondary); font-weight:400;">${wlCountText(model)}</span></h3>
            <div style="display:flex; align-items:center; gap:10px;">
              <button class="wl-clear-filter" data-scheme="${scheme}" id="wl-clear-${scheme}" title="Clear all column filters for this table" style="display:${model.isFiltered ? 'inline-block' : 'none'}; font-size:0.74rem; padding:0.2rem 0.55rem; border:1px solid var(--border-color,#ccc); border-radius:4px; background:var(--bg-card,#fff); color:var(--text-primary); cursor:pointer;">✕ Clear filters</button>
              <div id="wl-total-${scheme}" style="font-weight:700; color:var(--text-primary); text-align:right;">${wlTotalLabel(model)}</div>
            </div>
          </div>
          <div style="max-height:420px; overflow:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:0.82rem; color:var(--text-primary);">
              <thead><tr>${head}</tr></thead>
              <tbody id="wl-tbody-${scheme}">${wlRowsHTML(scheme, model.shown)}</tbody>
            </table>
          </div>
          <div id="wl-more-${scheme}">${wlMoreNoteHTML(scheme, model)}</div>
        </div>`;
    };

    // Patch a single table in place — preserves the filter inputs (focus/caret)
    // because the <thead> is never re-rendered, only the tbody/labels/note.
    const wlUpdateTable = (scheme) => {
        const model = wlTableModel(scheme);
        const tb = document.getElementById('wl-tbody-' + scheme);
        if (tb) tb.innerHTML = wlRowsHTML(scheme, model.shown);
        const ct = document.getElementById('wl-count-' + scheme);
        if (ct) ct.textContent = wlCountText(model);
        const tot = document.getElementById('wl-total-' + scheme);
        if (tot) tot.innerHTML = wlTotalLabel(model);
        const more = document.getElementById('wl-more-' + scheme);
        if (more) more.innerHTML = wlMoreNoteHTML(scheme, model);
        const clr = document.getElementById('wl-clear-' + scheme);
        if (clr) clr.style.display = model.isFiltered ? 'inline-block' : 'none';
    };

    // =====================================================================
    // Template download — 3 sheets, exact columns
    // =====================================================================
    const downloadWageLedgerTemplate = async (year, month) => {
        await wlEnsureExcelJS();
        const wb = new window.ExcelJS.Workbook();
        const gangs = wlGangList(year);
        const blocks = wlBlockList(year);

        // Hidden Lists sheet feeds the Gang/Block dropdowns
        const lists = wb.addWorksheet('Lists', { state: 'hidden' });
        lists.getCell('A1').value = 'Gangs';
        lists.getCell('B1').value = 'Blocks';
        gangs.forEach((g, i) => { lists.getCell(`A${i + 2}`).value = g; });
        blocks.forEach((b, i) => { lists.getCell(`B${i + 2}`).value = b; });
        const gangRange = gangs.length ? `Lists!$A$2:$A$${gangs.length + 1}` : null;
        const blockRange = blocks.length ? `Lists!$B$2:$B$${blocks.length + 1}` : null;

        const HDR_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
        const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

        SCHEME_KEYS.forEach(sk => {
            const spec = SCHEMES[sk];
            const ws = wb.addWorksheet(spec.sheet);
            const HR = 1;
            const hdr = ws.getRow(HR);
            hdr.values = spec.cols.map(c => c.header);
            hdr.height = 28;
            hdr.eachCell((cell) => {
                cell.font = { bold: true, color: { argb: 'FFF8FAFC' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                cell.fill = HDR_FILL;
                cell.border = border;
            });
            spec.cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w || 12; });

            // Apply per-column number formats + dropdowns to the next 500 rows
            for (let r = HR + 1; r <= HR + 500; r++) {
                const row = ws.getRow(r);
                spec.cols.forEach((c, i) => {
                    const cell = row.getCell(i + 1);
                    if (c.type === 'date') cell.numFmt = 'yyyy-mm-dd';
                    else if (c.type === 'money') cell.numFmt = '#,##0.00';
                    if (c.dropdown === 'gang' && gangRange) cell.dataValidation = { type: 'list', allowBlank: true, formulae: [gangRange] };
                    if (c.dropdown === 'block' && blockRange) cell.dataValidation = { type: 'list', allowBlank: true, formulae: [blockRange] };
                });
            }
            ws.views = [{ state: 'frozen', ySplit: HR }];
        });

        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `Wage_Ledger_Template_${month}_${year}.xlsx`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
        if (window.notify) window.notify('Template downloaded.', 'success');
    };
    window.downloadWageLedgerTemplate = downloadWageLedgerTemplate;

    // =====================================================================
    // Import — detect each scheme by header signature, then parse rows
    // =====================================================================
    // Find the header row + scheme for a worksheet (independent of sheet
    // name/order; tolerates the jobcardpr header sitting on row 2).
    const wlDetectSheet = (ws) => {
        let found = null;
        ws.eachRow((row, idx) => {
            if (found) return;
            const tokens = new Set((row.values || []).map(wlNormHeader).filter(Boolean));
            for (const sk of SCHEME_KEYS) {
                if (SCHEMES[sk].sig.some(t => tokens.has(t))) {
                    const colMap = {};
                    const fieldMap = wlFieldMaps[sk];
                    const vals = row.values;
                    for (let c = 1; c < vals.length; c++) {
                        const f = fieldMap[wlNormHeader(vals[c])];
                        if (f && colMap[f] === undefined) colMap[f] = c;
                    }
                    found = { scheme: sk, headerRowIdx: idx, colMap };
                    break;
                }
            }
        });
        return found;
    };

    const wlParseRow = (spec, colMap, vals) => {
        const row = {};
        spec.cols.forEach(c => {
            if (colMap[c.key] === undefined) { row[c.key] = c.type === 'text' ? '' : ''; return; }
            const raw = vals[colMap[c.key]];
            if (c.type === 'date') row[c.key] = wlToISO(raw);
            else if (c.type === 'num' || c.type === 'money') row[c.key] = (raw === '' || raw == null) ? '' : wlNum(raw);
            else { const t = wlText(raw); row[c.key] = t === '-' ? '' : t; }
        });
        // Auto-compute amount columns when left blank but the inputs exist.
        spec.cols.forEach(c => {
            if (c.amount && (row[c.key] === '' || row[c.key] == null) && c.qty && c.rate) {
                const q = wlNum(row[c.qty]), rt = wlNum(row[c.rate]);
                if (q && rt) row[c.key] = +(q * rt).toFixed(2);
            }
        });
        return row;
    };

    const importWageLedger = async (file, year, month) => {
        if (!file) return;
        if (typeof window._canEdit === 'function' && !window._canEdit('wages')) {
            if (window.notify) window.notify('You do not have edit access for wages.', 'warn');
            return;
        }
        try {
            await wlEnsureExcelJS();
            const wb = new window.ExcelJS.Workbook();
            await wb.xlsx.load(await file.arrayBuffer());

            const parsed = { harvester: null, driverLoader: null, jobcard: null };
            const skipped = {};
            wb.eachSheet((ws) => {
                const det = wlDetectSheet(ws);
                if (!det) return;
                const spec = SCHEMES[det.scheme];
                const out = [];
                let skip = 0;
                ws.eachRow((row, idx) => {
                    if (idx <= det.headerRowIdx) return;          // skip title/header rows
                    const vals = row.values || [];
                    const nonEmpty = vals.filter(v => v != null && wlText(v) !== '').length;
                    if (nonEmpty === 0) return;                   // blank row
                    const parsedRow = wlParseRow(spec, det.colMap, vals);
                    if (!wlRowHasKey(det.scheme, parsedRow)) { skip++; return; }
                    out.push(parsedRow);
                });
                // If a workbook somehow has two sheets of the same scheme, append.
                parsed[det.scheme] = (parsed[det.scheme] || []).concat(out);
                skipped[det.scheme] = (skipped[det.scheme] || 0) + skip;
            });

            // Only categories with at least one parsed row count — an empty
            // recognised sheet must not silently wipe existing data.
            const present = SCHEME_KEYS.filter(sk => parsed[sk] && parsed[sk].length > 0);
            const totalFound = present.reduce((s, sk) => s + parsed[sk].length, 0);
            if (present.length === 0 || totalFound === 0) {
                if (window.notify) window.notify('No recognisable wage sheets found.\nExpected Harvester, Driver & loader, or Job Card columns.', 'warn');
                return;
            }

            const summary = present.map(sk => `• ${SCHEMES[sk].label}: ${parsed[sk].length} row(s)${skipped[sk] ? ` (${skipped[sk]} skipped)` : ''}`).join('\n');
            const m = wlEnsureMonth(year, month);
            const replacing = present.filter(sk => (m[sk] || []).length > 0);
            const warn = replacing.length
                ? `\n\n⚠ This REPLACES existing rows for ${month} ${year} in: ${replacing.map(sk => SCHEMES[sk].label).join(', ')}.`
                : '';
            const proceed = confirm(`Import into ${month} ${year}:\n\n${summary}${warn}\n\nProceed?`);
            if (!proceed) return;

            present.forEach(sk => { m[sk] = parsed[sk]; });
            m.importedAt = new Date().toISOString();
            m.importedBy = window.currentUserEmail || (window.auth && window.auth.currentUser && window.auth.currentUser.email) || 'import';

            await saveWageLedgerData(false);
            if (typeof window.logAudit === 'function') window.logAudit('import', 'wages_ledger', `${month} ${year}: ${present.map(sk => `${SCHEMES[sk].label} ${parsed[sk].length}`).join(', ')}`, year);
            window.renderWagesLedgerView();
            if (window.notify) window.notify(`Imported ${totalFound} row(s) into ${month} ${year}.`, 'success');
        } catch (err) {
            console.error('Wage ledger import error:', err);
            if (window.notify) window.notify('Import error: ' + err.message, 'error');
        }
    };
    window.importWageLedger = importWageLedger;

})();
