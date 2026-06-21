// =====================================================================
// render_wages.js — Rate of Wages (payment calculation) module
// ---------------------------------------------------------------------
// Calculates gang payment per month from three components:
//   1. FFB payment  = (FFB MT − daily-rate harvest blocks) × RM/MT rate
//   2. Daily rate   = Σ over lines ( rate × Σ manpower per day )
//   3. Penalty      = unripe bunches × RM/bunch  (subtracted)
//   Total = FFB payment + daily rate − penalty
//
// FFB MT per gang/month is pulled automatically from harvesting
// performance data (state.performance), summing r1+r2+r3+r4 across the
// gang's blocks (ALL rounds — note this can differ slightly from the
// Iron Horse "Cost per FFB MT" figure, which drops r4). When a block is
// worked on a daily rate for HARVESTING, its tonnage is auto-subtracted
// from the FFB pool (so those bunches aren't paid twice) — auto value is
// editable per line.
//
// Storage: Firebase  shared/wages_data   (window._wagesDb)
// Gangs:   harvesting (state.gangsByYear) + maintenance (state.maintenance) merged.
// Blocks:  state.reports[year] (Planting Phase Record).
// Access:  menu key 'wages'  (window._canEdit / _applyReadOnly).
// =====================================================================

(function () {
    'use strict';

    const WG_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const WG_DEFAULT_PENALTY = 10;     // RM per unripe bunch
    const WG_DEFAULT_FFB_RATE = 50;    // RM per FFB MT — default until edited
    const WG_DEFAULT_DAILY_RATE = 30;  // RM per person/day — default until edited
    const WG_DEFAULT_ACTIVITIES = ['Spraying', 'Slashing', 'Manuring', 'Pruning'];

    // HTML-escape DB/user free text before innerHTML (shared data → untrusted).
    const wgEsc = (s) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s == null ? '' : s));

    const wgNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    // Effective value: the stored number if set, otherwise the default.
    const wgEffRate = (v, dflt) => (v !== '' && v != null) ? wgNum(v) : dflt;
    const wgRM = (n) => 'RM' + wgNum(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const wgMT = (n) => wgNum(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MT';

    const wgCurrentYear = () => String(new Date().getFullYear());
    const wgCurrentMonth = () => WG_MONTHS[new Date().getMonth()];

    // ── State helpers ───────────────────────────────────────────────────
    const wgEnsureYear = (yearStr) => {
        if (!window.state.wages) window.state.wages = {};
        let yd = window.state.wages[yearStr];
        if (!yd) {
            yd = window.state.wages[yearStr] = { penaltyPerBunch: WG_DEFAULT_PENALTY, gangs: {} };
        }
        if (yd.penaltyPerBunch == null) yd.penaltyPerBunch = WG_DEFAULT_PENALTY;
        if (!yd.gangs) yd.gangs = {};
        return yd;
    };

    const wgGangMonth = (yearStr, gang, month) => {
        const yd = wgEnsureYear(yearStr);
        if (!yd.gangs[gang]) yd.gangs[gang] = { months: {} };
        if (!yd.gangs[gang].months) yd.gangs[gang].months = {};
        if (!yd.gangs[gang].months[month]) {
            yd.gangs[gang].months[month] = { ffbRate: '', penaltyBunches: '', grossMtOverride: '', dailyLines: [] };
        }
        const m = yd.gangs[gang].months[month];
        if (!Array.isArray(m.dailyLines)) m.dailyLines = [];
        return m;
    };

    // ── Carry-forward (rate + daily work duplicated into the next month) ─
    // A month is "filled" if it carries any rate, penalty, override or work
    // line. Used to decide whether to auto-prefill and which prior month to
    // copy from.
    const wgMonthHasData = (m) => {
        if (!m) return false;
        if (m.ffbRate !== '' && m.ffbRate != null) return true;
        if (m.penaltyBunches !== '' && m.penaltyBunches != null) return true;
        if (m.grossMtOverride !== '' && m.grossMtOverride != null) return true;
        if (Array.isArray(m.dailyLines) && m.dailyLines.length > 0) return true;
        return false;
    };

    // A month is "future" if it is after the current calendar month — we do
    // NOT auto-carry into future/ongoing months (no phantom pre-billing).
    const wgIsFutureMonth = (yearStr, month) => {
        const now = new Date();
        const y = parseInt(yearStr, 10), mi = WG_MONTHS.indexOf(month);
        if (isNaN(y) || mi < 0) return false;
        return (y > now.getFullYear()) || (y === now.getFullYear() && mi > now.getMonth());
    };

    // Walk back up to 12 months (crossing the year boundary) for the most
    // recent month that has data for this gang. Returns { data, label }.
    const wgFindPrevMonthWithData = (yearStr, gang, month) => {
        let y = parseInt(yearStr, 10), mi = WG_MONTHS.indexOf(month);
        for (let i = 0; i < 12; i++) {
            mi -= 1;
            if (mi < 0) { mi = 11; y -= 1; }
            const md = window.state.wages && window.state.wages[String(y)] &&
                window.state.wages[String(y)].gangs && window.state.wages[String(y)].gangs[gang] &&
                window.state.wages[String(y)].gangs[gang].months && window.state.wages[String(y)].gangs[gang].months[WG_MONTHS[mi]];
            if (wgMonthHasData(md)) return { data: md, label: `${WG_MONTHS[mi]} ${y}` };
        }
        return null;
    };

    // If the selected month is brand-new (never created) and not in the
    // future, seed it from the most recent prior month: FFB rate + daily-rate
    // lines (block, work type, RM/day, per-day manpower). Dates and the
    // incident-specific fields (penalty, tonnage/MT overrides) reset so
    // nothing is pre-counted. Returns true if a carry happened.
    const wgMaybeCarry = (yearStr, gang, month) => {
        if (typeof window._canEdit === 'function' && !window._canEdit('wages')) return false;
        const yd = wgEnsureYear(yearStr);
        const existing = yd.gangs[gang] && yd.gangs[gang].months && yd.gangs[gang].months[month];
        if (existing) return false;                 // already created/edited — leave it
        if (wgIsFutureMonth(yearStr, month)) return false;
        const src = wgFindPrevMonthWithData(yearStr, gang, month);
        if (!src) return false;
        const m = wgGangMonth(yearStr, gang, month);
        m.ffbRate = src.data.ffbRate;
        m.penaltyBunches = '';      // incident-specific — start blank
        m.grossMtOverride = '';     // data-specific — auto each month
        m.dailyLines = (src.data.dailyLines || []).map(l => ({
            workType: l.workType, block: l.block, dailyRate: l.dailyRate, tonnageOverride: '',
            days: (l.days || []).map(d => ({ date: '', manpower: d.manpower }))
        }));
        m._carriedFrom = src.label;
        saveWagesData(true);
        return true;
    };

    // ── Lookups (gangs, blocks, work types) ─────────────────────────────
    // Gangs grouped by source: Harvesting (state.gangsByYear), Maintenance
    // (state.maintenance[y].gangs, excluding any already in Harvesting), and
    // "Other" for gangs that only exist in saved wages data. Used to build
    // the dropdown's <optgroup>s.
    const wgGangGroups = (yearStr) => {
        const sortf = (a, b) => a.localeCompare(b);
        const harvest = [...new Set((window.state.gangsByYear && window.state.gangsByYear[yearStr] || []).filter(Boolean))];
        const harvestSet = new Set(harvest);
        const mntObj = (window.state.maintenance && window.state.maintenance[yearStr] && window.state.maintenance[yearStr].gangs) || {};
        const maint = [...new Set(Object.keys(mntObj).filter(Boolean))].filter(g => !harvestSet.has(g));
        const known = new Set([...harvest, ...maint]);
        const wg = (window.state.wages && window.state.wages[yearStr] && window.state.wages[yearStr].gangs) || {};
        const other = [...new Set(Object.keys(wg).filter(g => g && !known.has(g)))];
        const groups = [];
        if (harvest.length) groups.push({ label: 'Harvesting Gangs', gangs: harvest.sort(sortf) });
        if (maint.length) groups.push({ label: 'Maintenance Gangs', gangs: maint.sort(sortf) });
        if (other.length) groups.push({ label: 'Other (saved)', gangs: other.sort(sortf) });
        return groups;
    };

    // Flat de-duplicated union of all gangs for a year (validation + Excel report).
    const wgGangList = (yearStr) => {
        const set = new Set();
        wgGangGroups(yearStr).forEach(grp => grp.gangs.forEach(g => set.add(g)));
        return [...set].sort((a, b) => a.localeCompare(b));
    };

    const wgBlockList = (yearStr) => {
        const rows = (window.state.reports && window.state.reports[yearStr]) || [];
        const ids = rows.map(r => String(r.block_id)).filter(Boolean);
        const uniq = [...new Set(ids)];
        uniq.sort((a, b) => {
            const na = parseFloat(a), nb = parseFloat(b);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
            return a.localeCompare(b);
        });
        return uniq;
    };

    const wgWorkTypes = (yearStr) => {
        const acts = (window.state.maintenance && window.state.maintenance[yearStr] && window.state.maintenance[yearStr].activityTypes) || WG_DEFAULT_ACTIVITIES;
        const set = new Set(['Harvesting']);
        acts.forEach(a => { if (a) set.add(a); });
        return [...set];
    };

    const wgYearList = () => {
        const set = new Set();
        [window.state.wages, window.state.performance, window.state.gangsByYear, (window.state.maintenance || {})]
            .forEach(obj => { if (obj) Object.keys(obj).forEach(k => { if (/^\d{4}$/.test(k)) set.add(k); }); });
        set.add(wgCurrentYear());
        return [...set].sort((a, b) => parseInt(b) - parseInt(a));
    };

    // ── Per-block tonnage from performance (r1+r2+r3+r4), fuzzy gang match ─
    // Returns { blockId: mt } for the gang in that month. Mirrors the
    // 3-tier name matching used by the Iron Horse Cost per FFB MT report.
    const wgPerfMonthKey = (m) => m.charAt(0) + m.slice(1).toLowerCase(); // "APR" → "Apr"
    const wgSumBlock = (b) => wgNum(b.r1) + wgNum(b.r2) + wgNum(b.r3) + wgNum(b.r4);

    const wgGangBlocks = (yearStr, gang, month) => {
        const out = {};
        if (!gang) return out;
        const monthPerf = (window.state.performance && window.state.performance[yearStr] && window.state.performance[yearStr][wgPerfMonthKey(month)]) || {};
        const addBlocks = (gData) => {
            if (!gData || !gData.blocks) return;
            Object.entries(gData.blocks).forEach(([bid, b]) => { out[bid] = (out[bid] || 0) + wgSumBlock(b); });
        };
        // 1. exact key
        if (monthPerf[gang]) { addBlocks(monthPerf[gang]); return out; }
        const lowerG = gang.toLowerCase();
        const perfKeys = Object.keys(monthPerf).filter(k => k !== 'gangAssignments');
        // 2a. case-insensitive exact
        let key = perfKeys.find(k => k.toLowerCase() === lowerG);
        // 2b. performance key is a prefix of the gang name
        if (!key) key = perfKeys.find(k => { const kl = k.toLowerCase(); return kl.length >= 4 && lowerG.startsWith(kl); });
        // 2c. first word of gang name matches start of performance key
        if (!key) { const fw = gang.split(' ')[0].toLowerCase(); if (fw.length >= 4) key = perfKeys.find(k => k.toLowerCase().startsWith(fw)); }
        // 2d. first 5 letters (spelling differences)
        if (!key) {
            const strip = s => s.toLowerCase().replace(/[^a-z]/g, '');
            const f = strip(gang).substring(0, 5);
            if (f.length >= 5) key = perfKeys.find(k => strip(k).startsWith(f));
        }
        // 2e. name after "previously"
        if (!key) {
            const pm = gang.match(/previously\s+(.+)/i);
            if (pm) { const pf = pm[1].trim().split(/\s+/)[0].toLowerCase(); if (pf.length >= 4) key = perfKeys.find(k => k.toLowerCase().startsWith(pf)); }
        }
        if (key) { addBlocks(monthPerf[key]); return out; }
        // 3. block-level aggregation via gangAssignments
        const assignments = monthPerf.gangAssignments || {};
        const owned = new Set(Object.entries(assignments).filter(([, g]) => g === gang).map(([id]) => id));
        if (owned.size > 0) {
            Object.entries(monthPerf).forEach(([k, gData]) => {
                if (k === 'gangAssignments' || !gData || !gData.blocks) return;
                Object.entries(gData.blocks).forEach(([bid, b]) => { if (owned.has(bid)) out[bid] = (out[bid] || 0) + wgSumBlock(b); });
            });
        }
        return out;
    };

    // ── The calculation engine ──────────────────────────────────────────
    const wgCompute = (yearStr, gang, month) => {
        const yd = wgEnsureYear(yearStr);
        const m = wgGangMonth(yearStr, gang, month);
        const blocksMt = wgGangBlocks(yearStr, gang, month);
        const autoGross = Object.values(blocksMt).reduce((s, v) => s + v, 0);
        const hasOverride = m.grossMtOverride != null && m.grossMtOverride !== '';
        const grossMt = hasOverride ? wgNum(m.grossMtOverride) : autoGross;

        const lines = m.dailyLines || [];
        // Subtract each unique harvesting block once. An explicit per-line
        // override wins over the auto-pulled tonnage.
        const subMap = {};
        lines.forEach(l => {
            if (l.workType === 'Harvesting' && l.block) {
                const hasOv = l.tonnageOverride != null && l.tonnageOverride !== '';
                const auto = blocksMt[l.block] || 0;
                const val = hasOv ? wgNum(l.tonnageOverride) : auto;
                if (!(l.block in subMap) || hasOv) subMap[l.block] = { val, auto, override: hasOv ? wgNum(l.tonnageOverride) : null };
            }
        });
        const subMt = Object.values(subMap).reduce((s, o) => s + o.val, 0);
        const netMt = Math.max(0, grossMt - subMt);
        const ffbRate = wgEffRate(m.ffbRate, WG_DEFAULT_FFB_RATE);
        const ffbPay = netMt * ffbRate;

        const dailyLines = lines.map(l => {
            const rate = wgEffRate(l.dailyRate, WG_DEFAULT_DAILY_RATE);
            const mp = (l.days || []).reduce((s, d) => s + wgNum(d.manpower), 0);
            const dayCount = (l.days || []).filter(d => wgNum(d.manpower) > 0).length;
            return { ref: l, rate, manpower: mp, dayCount, amount: rate * mp };
        });
        const dailyPay = dailyLines.reduce((s, l) => s + l.amount, 0);

        const penaltyPer = wgNum(yd.penaltyPerBunch != null ? yd.penaltyPerBunch : WG_DEFAULT_PENALTY);
        const penaltyBunches = wgNum(m.penaltyBunches);
        const penalty = penaltyBunches * penaltyPer;

        const total = ffbPay + dailyPay - penalty;
        return {
            blocksMt, autoGross, hasOverride, grossMt, subMap, subMt, netMt,
            ffbRate, ffbPay, dailyLines, dailyPay,
            penaltyPer, penaltyBunches, penalty, total
        };
    };
    window.wgCompute = wgCompute; // exposed for the Excel report

    // ── Firebase save (debounced for live typing) ───────────────────────
    const saveWagesData = (silent) => {
        if (!window._wagesDb) { if (!silent && window.notify) window.notify('Not connected to cloud — wages not saved.', 'error'); return Promise.resolve(); }
        return window._wagesDb.ref('shared/wages_data').set(JSON.stringify(window.state.wages))
            .then(() => { if (!silent && window.notify) window.notify('Wages saved.', 'success'); })
            .catch(e => { if (window.notify) window.notify('Save failed: ' + e.message, 'error'); });
    };
    window.saveWagesData = saveWagesData;

    let _wgSaveTimer = null;
    const wgSaveDebounced = () => {
        if (typeof window._markUnsaved === 'function') window._markUnsaved();
        clearTimeout(_wgSaveTimer);
        _wgSaveTimer = setTimeout(() => saveWagesData(true), 900);
    };

    // ── Styling constants (match the Reports panel look) ────────────────
    const SS = 'padding:0.45rem 0.6rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);font-size:0.9rem;';
    const CARD = 'border:1px solid var(--border-color,#ddd);border-radius:8px;padding:1.1rem 1.25rem;margin-bottom:1rem;background:var(--bg-card,#fff);box-shadow:0 1px 3px rgba(0,0,0,0.05);';
    const INP = 'edit-input';
    const INP_STYLE = 'padding:0.4rem 0.55rem;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--bg-card,#fff);color:var(--text-primary);font-size:0.9rem;';

    // ── Main render ─────────────────────────────────────────────────────
    window.renderWagesView = () => {
        const host = document.getElementById('wages-wrapper');
        if (!host) return;

        if (!state.wagesYear || !/^\d{4}$/.test(state.wagesYear)) state.wagesYear = wgCurrentYear();
        if (!state.wagesMonth || !WG_MONTHS.includes(state.wagesMonth)) state.wagesMonth = wgCurrentMonth();
        const year = state.wagesYear;
        const month = state.wagesMonth;

        const years = wgYearList();
        const gangs = wgGangList(year);
        if (state.wagesGang && !gangs.includes(state.wagesGang)) state.wagesGang = '';
        const gang = state.wagesGang || '';

        const yearOpts = years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('');
        const monthOpts = WG_MONTHS.map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${m}</option>`).join('');
        const gangOpts = `<option value="">— select gang —</option>` +
            wgGangGroups(year).map(grp =>
                `<optgroup label="${wgEsc(grp.label)}">` +
                grp.gangs.map(g => `<option value="${wgEsc(g)}" ${g === gang ? 'selected' : ''}>${wgEsc(g)}</option>`).join('') +
                `</optgroup>`).join('');

        host.innerHTML = `
        <div style="padding:1.25rem 1.5rem; max-width:980px;">
          <h2 style="margin:0 0 0.25rem; color:var(--text-primary);">💵 Rate of Wages</h2>
          <p style="color:var(--text-secondary); margin:0 0 1.1rem; font-size:0.85rem;">
            Calculate gang payment: FFB tonnage × rate, less daily-rate blocks and unripe-bunch penalty.
          </p>

          <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin-bottom:1.1rem;">
            <label style="font-size:0.82rem; color:var(--text-secondary);">Year
              <select id="wg-year" style="${SS} margin-left:4px;">${yearOpts}</select></label>
            <label style="font-size:0.82rem; color:var(--text-secondary);">Month
              <select id="wg-month" style="${SS} margin-left:4px;">${monthOpts}</select></label>
            <label style="font-size:0.82rem; color:var(--text-secondary);">Gang
              <select id="wg-gang" style="${SS} margin-left:4px; min-width:220px;">${gangOpts}</select></label>
            <div style="flex:1;"></div>
            <button id="wg-dl-excel" class="btn-primary" style="padding:0.45rem 1rem;" title="Download all gangs for this month">⬇ Excel report</button>
          </div>

          <div id="wg-editor"></div>
        </div>`;

        // selector handlers
        host.querySelector('#wg-year').onchange = (e) => { state.wagesYear = e.target.value; state.wagesGang = state.wagesGang; window.renderWagesView(); };
        host.querySelector('#wg-month').onchange = (e) => { state.wagesMonth = e.target.value; window.renderWagesView(); };
        host.querySelector('#wg-gang').onchange = (e) => { state.wagesGang = e.target.value; window.renderWagesView(); };
        host.querySelector('#wg-dl-excel').onclick = async () => {
            const btn = host.querySelector('#wg-dl-excel');
            btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ Generating…';
            try { await window.downloadWagesReport(year, month); }
            catch (err) { if (window.notify) window.notify('Excel failed: ' + err.message, 'error'); }
            finally { btn.disabled = false; btn.textContent = old; }
        };

        wgRenderEditor(year, month, gang);
    };

    // ── Editor pane for one gang+month ──────────────────────────────────
    const wgRenderEditor = (year, month, gang) => {
        const ed = document.getElementById('wg-editor');
        if (!ed) return;

        if (!gang) {
            ed.innerHTML = `<div style="${CARD} text-align:center; color:var(--text-secondary);">
                Select a gang above to enter and calculate wages for <strong>${wgEsc(month)} ${wgEsc(year)}</strong>.
                ${wgGangList(year).length === 0 ? '<br><br>⚠ No gangs found for this year. Add harvesting or maintenance gangs first.' : ''}
            </div>`;
            return;
        }

        wgMaybeCarry(year, gang, month);   // seed a new month from the previous one
        const yd = wgEnsureYear(year);
        const m = wgGangMonth(year, gang, month);
        const c = wgCompute(year, gang, month);
        const blocks = wgBlockList(year);
        const workTypes = wgWorkTypes(year);
        const carriedBanner = m._carriedFrom
            ? `<div style="background:var(--bg-main,#eef6ef); border:1px solid var(--accent-color,#16a34a); border-radius:6px; padding:0.5rem 0.8rem; margin-bottom:1rem; font-size:0.82rem; color:var(--text-primary);">
                 ↪ Rate &amp; daily work carried forward from <strong>${wgEsc(m._carriedFrom)}</strong>. Edit freely — earlier months are not affected; your changes carry to the next month.
               </div>`
            : '';

        const blockOpts = (sel) => `<option value="">— block —</option>` +
            blocks.map(b => `<option value="${wgEsc(b)}" ${String(b) === String(sel) ? 'selected' : ''}>Blk ${wgEsc(b)}</option>`).join('') +
            (sel && !blocks.includes(String(sel)) ? `<option value="${wgEsc(sel)}" selected>Blk ${wgEsc(sel)} (free)</option>` : '');
        const workOpts = (sel) => workTypes.map(w => `<option value="${wgEsc(w)}" ${w === sel ? 'selected' : ''}>${wgEsc(w)}</option>`).join('');

        ed.innerHTML = `
        ${carriedBanner}
        <!-- FFB payment -->
        <div style="${CARD}">
          <h3 style="margin:0 0 0.7rem; font-size:1rem; color:var(--text-primary);">1 · FFB Payment</h3>
          <div style="display:flex; gap:1rem; flex-wrap:wrap; align-items:flex-end; margin-bottom:0.6rem;">
            <label style="font-size:0.82rem; color:var(--text-secondary);">FFB rate (RM / MT)
              <br><input id="wg-ffbrate" type="number" min="0" step="0.01" class="${INP}" style="${INP_STYLE} width:120px;" value="${wgEffRate(m.ffbRate, WG_DEFAULT_FFB_RATE)}" placeholder="default 50"></label>
            <label style="font-size:0.82rem; color:var(--text-secondary);">FFB MT override <span style="opacity:.7;">(optional)</span>
              <br><input id="wg-grossov" type="number" min="0" step="0.01" class="${INP}" style="${INP_STYLE} width:130px;" value="${m.grossMtOverride}" placeholder="auto"></label>
          </div>
          <div id="wg-ffb-calc"></div>
        </div>

        <!-- Penalty -->
        <div style="${CARD}">
          <h3 style="margin:0 0 0.7rem; font-size:1rem; color:var(--text-primary);">2 · Unripe Bunch Penalty</h3>
          <div style="display:flex; gap:1rem; flex-wrap:wrap; align-items:flex-end;">
            <label style="font-size:0.82rem; color:var(--text-secondary);">Unripe bunches
              <br><input id="wg-bunches" type="number" min="0" step="1" class="${INP}" style="${INP_STYLE} width:120px;" value="${m.penaltyBunches}" placeholder="0"></label>
            <label style="font-size:0.82rem; color:var(--text-secondary);">RM / bunch <span style="opacity:.7;">(year-wide)</span>
              <br><input id="wg-penper" type="number" min="0" step="0.01" class="${INP}" style="${INP_STYLE} width:110px;" value="${yd.penaltyPerBunch}"></label>
            <div id="wg-pen-calc" style="font-size:0.9rem; color:var(--text-primary); padding-bottom:0.45rem;"></div>
          </div>
        </div>

        <!-- Daily rate -->
        <div style="${CARD}">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.6rem;">
            <h3 style="margin:0; font-size:1rem; color:var(--text-primary);">3 · Daily Rate Work</h3>
            <button id="wg-add-line" style="padding:0.35rem 0.8rem; font-size:0.85rem; border:1px solid var(--border-color,#ccc); border-radius:4px; background:var(--bg-card,#fff); color:var(--text-primary); cursor:pointer;">➕ Add work line</button>
          </div>
          <p style="margin:0 0 0.7rem; font-size:0.78rem; color:var(--text-secondary);">
            For <strong>Harvesting</strong> lines the block's tonnage is auto-subtracted from the FFB pool above (manpower is entered manually — harvesting-interval manpower is ignored).
          </p>
          <div id="wg-lines"></div>
        </div>

        <!-- Summary -->
        <div id="wg-summary"></div>`;

        // ---- handlers: live numeric inputs (no re-render, keep focus) ----
        const ffbRate = ed.querySelector('#wg-ffbrate');
        ffbRate.oninput = () => { m.ffbRate = ffbRate.value; delete m._carriedFrom; wgSaveDebounced(); wgRefresh(year, month, gang); };
        const grossOv = ed.querySelector('#wg-grossov');
        grossOv.oninput = () => { m.grossMtOverride = grossOv.value; wgSaveDebounced(); wgRefresh(year, month, gang); };
        const bunches = ed.querySelector('#wg-bunches');
        bunches.oninput = () => { m.penaltyBunches = bunches.value; wgSaveDebounced(); wgRefresh(year, month, gang); };
        const penPer = ed.querySelector('#wg-penper');
        penPer.oninput = () => { yd.penaltyPerBunch = penPer.value; wgSaveDebounced(); wgRefresh(year, month, gang); };

        // ---- add a work line ----
        ed.querySelector('#wg-add-line').onclick = () => {
            m.dailyLines.push({ workType: workTypes[0] || 'Harvesting', block: '', dailyRate: '', tonnageOverride: '', days: [{ date: '', manpower: '' }] });
            delete m._carriedFrom;
            saveWagesData(true);
            wgRenderEditor(year, month, gang);
        };

        wgRenderLines(year, month, gang, blockOpts, workOpts);
        wgRefresh(year, month, gang);
    };

    // ── Render the daily-rate lines ─────────────────────────────────────
    const wgRenderLines = (year, month, gang, blockOpts, workOpts) => {
        const wrap = document.getElementById('wg-lines');
        if (!wrap) return;
        const m = wgGangMonth(year, gang, month);

        if (!m.dailyLines.length) {
            wrap.innerHTML = `<div style="font-size:0.85rem; color:var(--text-secondary); padding:0.4rem 0;">No daily-rate work. Click “Add work line” for blocks paid by the day (e.g. Block 39).</div>`;
            return;
        }

        wrap.innerHTML = m.dailyLines.map((l, i) => {
            const isHarvest = l.workType === 'Harvesting';
            const dayCells = (l.days || []).map((d, di) => `
                <div style="display:flex; flex-direction:column; gap:3px; border:1px solid var(--border-color,#e3e3e3); border-radius:6px; padding:6px; min-width:140px;">
                  <span style="font-size:0.7rem; color:var(--text-secondary);">Day ${di + 1}</span>
                  <input type="date" data-li="${i}" data-di="${di}" data-f="date" class="${INP} wg-day-in" style="${INP_STYLE} font-size:0.8rem;" value="${wgEsc(d.date || '')}">
                  <input type="number" min="0" step="1" data-li="${i}" data-di="${di}" data-f="manpower" class="${INP} wg-day-in" style="${INP_STYLE} font-size:0.8rem;" value="${d.manpower}" placeholder="persons">
                  ${(l.days.length > 1) ? `<button data-li="${i}" data-di="${di}" class="wg-day-del" style="font-size:0.68rem; color:#c0392b; background:none; border:none; cursor:pointer; padding:0; text-align:left;">✕ remove</button>` : ''}
                </div>`).join('');

            return `
            <div style="border:1px solid var(--border-color,#e0e0e0); border-radius:8px; padding:0.8rem; margin-bottom:0.7rem; background:var(--bg-main,#fafafa);">
              <div style="display:flex; gap:0.8rem; flex-wrap:wrap; align-items:flex-end; margin-bottom:0.6rem;">
                <label style="font-size:0.78rem; color:var(--text-secondary);">Work type
                  <br><select data-li="${i}" data-f="workType" class="wg-line-in" style="${SS}">${workOpts(l.workType)}</select></label>
                <label style="font-size:0.78rem; color:var(--text-secondary);">Block
                  <br><select data-li="${i}" data-f="block" class="wg-line-in" style="${SS}">${blockOpts(l.block)}</select></label>
                <label style="font-size:0.78rem; color:var(--text-secondary);">Daily rate (RM / person / day)
                  <br><input type="number" min="0" step="0.01" data-li="${i}" data-f="dailyRate" class="${INP} wg-line-num" style="${INP_STYLE} width:120px;" value="${wgEffRate(l.dailyRate, WG_DEFAULT_DAILY_RATE)}" placeholder="default 30"></label>
                ${isHarvest ? `<label style="font-size:0.78rem; color:var(--text-secondary);">FFB MT to subtract <span style="opacity:.7;">(auto)</span>
                  <br><input type="number" min="0" step="0.01" data-li="${i}" data-f="tonnageOverride" class="${INP} wg-line-num" style="${INP_STYLE} width:130px;" value="${l.tonnageOverride}" placeholder="${(wgGangBlocks(year, gang, month)[l.block] || 0).toFixed(2)}"></label>` : ''}
                <div style="flex:1;"></div>
                <button data-li="${i}" class="wg-line-del" style="padding:0.3rem 0.6rem; font-size:0.78rem; color:#c0392b; background:none; border:1px solid #e3b7b1; border-radius:4px; cursor:pointer;">🗑 line</button>
              </div>
              <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:stretch;">
                ${dayCells}
                <button data-li="${i}" class="wg-day-add" style="min-width:90px; border:1px dashed var(--border-color,#bbb); border-radius:6px; background:none; color:var(--text-secondary); cursor:pointer; font-size:0.8rem;">➕ Add day</button>
              </div>
              <div id="wg-line-sub-${i}" style="margin-top:0.5rem; font-size:0.85rem; color:var(--text-primary);"></div>
            </div>`;
        }).join('');

        // line-level selects + day field changes
        wrap.querySelectorAll('.wg-line-in').forEach(el => {
            el.onchange = () => {
                const i = +el.dataset.li, f = el.dataset.f;
                m.dailyLines[i][f] = el.value;
                delete m._carriedFrom;
                saveWagesData(true);
                wgRenderEditor(year, month, gang); // workType toggles the subtract field → full re-render
            };
        });
        wrap.querySelectorAll('.wg-line-num').forEach(el => {
            el.oninput = () => { const i = +el.dataset.li, f = el.dataset.f; m.dailyLines[i][f] = el.value; delete m._carriedFrom; wgSaveDebounced(); wgRefresh(year, month, gang); };
        });
        wrap.querySelectorAll('.wg-day-in').forEach(el => {
            const i = +el.dataset.li, di = +el.dataset.di, f = el.dataset.f;
            if (f === 'date') el.onchange = () => { m.dailyLines[i].days[di][f] = el.value; saveWagesData(true); wgRefresh(year, month, gang); };
            else el.oninput = () => { m.dailyLines[i].days[di][f] = el.value; wgSaveDebounced(); wgRefresh(year, month, gang); };
        });
        wrap.querySelectorAll('.wg-day-add').forEach(el => {
            el.onclick = () => { const i = +el.dataset.li; m.dailyLines[i].days.push({ date: '', manpower: '' }); saveWagesData(true); wgRenderEditor(year, month, gang); };
        });
        wrap.querySelectorAll('.wg-day-del').forEach(el => {
            el.onclick = () => { const i = +el.dataset.li, di = +el.dataset.di; m.dailyLines[i].days.splice(di, 1); saveWagesData(true); wgRenderEditor(year, month, gang); };
        });
        wrap.querySelectorAll('.wg-line-del').forEach(el => {
            el.onclick = () => {
                const i = +el.dataset.li;
                const removed = m.dailyLines.splice(i, 1)[0];
                saveWagesData(true);
                wgRenderEditor(year, month, gang);
                if (typeof window.notifyUndo === 'function') {
                    window.notifyUndo('Removed daily-rate line.', () => { m.dailyLines.splice(i, 0, removed); saveWagesData(true); wgRenderEditor(year, month, gang); });
                }
            };
        });
    };

    // ── Live recompute of derived numbers (no DOM teardown) ─────────────
    const wgRefresh = (year, month, gang) => {
        const c = wgCompute(year, gang, month);

        // FFB calc block
        const ffb = document.getElementById('wg-ffb-calc');
        if (ffb) {
            const subRows = Object.entries(c.subMap).map(([blk, o]) =>
                `<div style="font-size:0.82rem; color:var(--text-secondary);">– Blk ${wgEsc(blk)} (daily-rate harvest): −${wgMT(o.val)}${o.override != null ? ' <em>(override)</em>' : ''}</div>`).join('');
            ffb.innerHTML = `
              <div style="font-size:0.85rem; color:var(--text-primary);">
                Gross FFB ${c.hasOverride ? '<em>(manual override)</em>' : '<span style="color:var(--text-secondary);">(auto from performance, all rounds)</span>'}: <strong>${wgMT(c.grossMt)}</strong>
                ${c.hasOverride ? `<span style="color:var(--text-secondary); font-size:0.78rem;"> · auto would be ${wgMT(c.autoGross)}</span>` : ''}
              </div>
              ${subRows}
              <div style="font-size:0.9rem; color:var(--text-primary); margin-top:4px;">Net FFB MT = <strong>${wgMT(c.netMt)}</strong> × ${wgRM(c.ffbRate)} = <strong>${wgRM(c.ffbPay)}</strong></div>
              ${c.grossMt === 0 && !c.hasOverride ? `<div style="font-size:0.78rem; color:#e67e22; margin-top:4px;">⚠ No tonnage auto-found for “${wgEsc(gang)}” in ${wgEsc(month)} — check the gang name matches Harvesting Performance, or use the FFB MT override.</div>` : ''}`;
        }

        // penalty
        const pen = document.getElementById('wg-pen-calc');
        if (pen) pen.innerHTML = `= ${c.penaltyBunches} × ${wgRM(c.penaltyPer)} = <strong>${wgRM(c.penalty)}</strong>`;

        // per-line subtotals
        c.dailyLines.forEach((l, i) => {
            const el = document.getElementById('wg-line-sub-' + i);
            if (el) el.innerHTML = `Subtotal: ${l.manpower} persons${l.dayCount ? ' (' + l.dayCount + ' day' + (l.dayCount > 1 ? 's' : '') + ')' : ''} × ${wgRM(l.rate)} = <strong>${wgRM(l.amount)}</strong>`;
        });

        // grand summary
        const sum = document.getElementById('wg-summary');
        if (sum) {
            sum.innerHTML = `
            <div style="${CARD} background:var(--bg-main,#f7f9f7); border:2px solid var(--accent-color,#16a34a);">
              <h3 style="margin:0 0 0.7rem; font-size:1rem; color:var(--text-primary);">Summary — ${wgEsc(gang)}, ${wgEsc(month)} ${wgEsc(year)}</h3>
              <table style="width:100%; border-collapse:collapse; font-size:0.9rem; color:var(--text-primary);">
                <tr><td style="padding:4px 0;">1. FFB payment — ${wgMT(c.netMt)} × ${wgRM(c.ffbRate)}/MT</td><td style="text-align:right;">${wgRM(c.ffbPay)}</td></tr>
                <tr><td style="padding:4px 0;">2. Daily-rate work</td><td style="text-align:right;">${wgRM(c.dailyPay)}</td></tr>
                <tr><td style="padding:4px 0;">3. Unripe-bunch penalty — ${c.penaltyBunches} × ${wgRM(c.penaltyPer)}</td><td style="text-align:right; color:#c0392b;">− ${wgRM(c.penalty)}</td></tr>
                <tr style="border-top:2px solid var(--border-color,#ccc); font-weight:700; font-size:1.05rem;">
                  <td style="padding:8px 0;">Total payable</td><td style="text-align:right; padding:8px 0;">${wgRM(c.total)}</td></tr>
              </table>
            </div>`;
        }
    };

    // =====================================================================
    // Excel report — all gangs for one month
    // =====================================================================
    const wgEnsureExcelJS = async () => {
        if (typeof window.ExcelJS !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
            document.head.appendChild(s);
        });
    };

    window.downloadWagesReport = async (year, month) => {
        await wgEnsureExcelJS();
        const gangs = wgGangList(year);
        // include a gang if it has any computed component for the month
        const rows = [];
        gangs.forEach(g => {
            const c = wgCompute(year, g, month);
            const hasData = c.grossMt > 0 || c.dailyPay > 0 || c.penalty > 0 || c.ffbRate > 0;
            if (hasData) rows.push({ gang: g, c });
        });

        const wb = new window.ExcelJS.Workbook();
        const ws = wb.addWorksheet(`Wages ${month} ${year}`);
        ws.columns = [
            { width: 34 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 16 }
        ];

        const HDR = { bold: true, color: { argb: 'FFFFFFFF' } };
        const DARK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A2E' } };
        const GREEN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } };
        const moneyFmt = '#,##0.00';
        const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

        const t1 = ws.addRow([`RATE OF WAGES — ${month} ${year}`]);
        ws.mergeCells(t1.number, 1, t1.number, 6);
        t1.getCell(1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
        t1.getCell(1).fill = DARK; t1.getCell(1).alignment = { horizontal: 'center' };
        t1.height = 22;
        ws.addRow([]);

        const head = ws.addRow(['Gang', 'Net FFB MT', 'RM/MT', 'FFB Payment', 'Daily Rate', 'Penalty', 'Total']);
        head.eachCell(c => { c.font = HDR; c.fill = GREEN; c.alignment = { horizontal: 'center' }; c.border = border; });
        // re-add a 7th column width
        ws.getColumn(7).width = 16;

        let gFfb = 0, gDaily = 0, gPen = 0, gTotal = 0, gMt = 0;
        rows.forEach(({ gang, c }) => {
            const r = ws.addRow([gang, c.netMt, c.ffbRate, c.ffbPay, c.dailyPay, c.penalty, c.total]);
            r.getCell(2).numFmt = '#,##0.00';
            [4, 5, 6, 7].forEach(ci => r.getCell(ci).numFmt = moneyFmt);
            r.getCell(3).numFmt = moneyFmt;
            r.getCell(6).font = { color: { argb: 'FFC0392B' } };
            r.eachCell(cell => cell.border = border);
            gMt += c.netMt; gFfb += c.ffbPay; gDaily += c.dailyPay; gPen += c.penalty; gTotal += c.total;
        });

        if (!rows.length) {
            const r = ws.addRow(['No wages data for this month.']);
            ws.mergeCells(r.number, 1, r.number, 7);
            r.getCell(1).alignment = { horizontal: 'center' }; r.getCell(1).font = { italic: true };
        } else {
            const gt = ws.addRow(['GRAND TOTAL', gMt, '', gFfb, gDaily, gPen, gTotal]);
            gt.eachCell(c => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }; c.border = border; });
            gt.getCell(2).numFmt = '#,##0.00';
            [4, 5, 6, 7].forEach(ci => gt.getCell(ci).numFmt = moneyFmt);
        }

        // Per-gang detail breakdown sheets reference (kept on one sheet for now).
        ws.addRow([]);
        const note = ws.addRow(['FFB MT uses all harvest rounds (r1–r4); daily-rate harvest blocks are excluded from the FFB pool.']);
        ws.mergeCells(note.number, 1, note.number, 7);
        note.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF666666' } };

        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `Wages_${month}_${year}.xlsx`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
        if (window.notify) window.notify('Wages report downloaded.', 'success');
    };

})();
