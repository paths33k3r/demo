// =====================================================================
// render_maintenance.js — Maintenance Gangs, Work Log & Gantt Chart
// ---------------------------------------------------------------------
// Digitises the hand-written "Maintenance work" Gantt sheets.
//   • Gangs      — per-month roster + headcount (history never collides)
//   • Work Log   — daily work entries (block + activity + date range)
//                  with supervisor verification (– unverified / ✓ verified)
//   • Gantt      — bars laid out across the days of the selected month,
//                  grouped by block + gang + activity. Striped = unverified,
//                  solid = verified. Bottom row = daily manpower.
//
// Storage: Firebase  shared/maintenance_data   (window._maintenanceDb)
// Blocks come from state.reports[year] (Planting Phase Record).
// Access control reuses the 'maintenance' menu key (window._canEdit).
// =====================================================================

const MNT_MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// HTML-escape for user/DB free text (gang, activity, block, round, method,
// members) before it goes into innerHTML — shared data, so treat as untrusted.
const mEsc = (s) => window.escapeHtml(s);

// Default configurable activity list (per year, editable in the UI)
const MNT_DEFAULT_ACTIVITIES = ['Spraying', 'Slashing', 'Manuring', 'Pruning'];

// Per-activity colour + short label for the Gantt bars / chips
const MNT_ACTIVITY_STYLE = {
    'Spraying': { color: '#16a34a', abbr: 'S'  },
    'Slashing': { color: '#ea580c', abbr: 'Sl' },
    'Manuring': { color: '#2563eb', abbr: 'M'  },
    'Pruning':  { color: '#7c3aed', abbr: 'P'  },
};
const MNT_FALLBACK_COLORS = ['#0891b2', '#db2777', '#65a30d', '#9333ea', '#c2410c', '#0d9488'];

const mntActivityStyle = (activity) => {
    if (MNT_ACTIVITY_STYLE[activity]) return MNT_ACTIVITY_STYLE[activity];
    // Stable fallback colour derived from the name
    let h = 0;
    for (let i = 0; i < activity.length; i++) h = (h * 31 + activity.charCodeAt(i)) >>> 0;
    return { color: MNT_FALLBACK_COLORS[h % MNT_FALLBACK_COLORS.length], abbr: activity.slice(0, 2).toUpperCase() };
};

// ─────────────────────────────────────────────────────────────────────
// State helpers
// ─────────────────────────────────────────────────────────────────────
const mntCanEdit = () => (typeof window._canEdit === 'function' ? window._canEdit('maintenance') : true);

const mntCurrentYear  = () => String(new Date().getFullYear());
const mntCurrentMonth = () => MNT_MONTHS[new Date().getMonth()];

const mntEnsureYear = (yearStr) => {
    if (!window.state.maintenance) window.state.maintenance = {};
    let yd = window.state.maintenance[yearStr];
    if (!yd) {
        yd = window.state.maintenance[yearStr] = {
            activityTypes: [...MNT_DEFAULT_ACTIVITIES],
            gangs: {},
            entries: [],
        };
    }
    if (!Array.isArray(yd.activityTypes) || yd.activityTypes.length === 0) yd.activityTypes = [...MNT_DEFAULT_ACTIVITIES];
    if (!yd.gangs || typeof yd.gangs !== 'object') yd.gangs = {};
    if (!Array.isArray(yd.entries)) yd.entries = [];
    return yd;
};

const mntActiveYear  = () => window.state.maintYear  || (window.state.maintYear  = mntCurrentYear());
const mntActiveMonth = () => window.state.maintMonth || (window.state.maintMonth = mntCurrentMonth());

// Available years: union of maintenance years, report years, current year
const mntAvailableYears = () => {
    const set = new Set();
    Object.keys(window.state.maintenance || {}).forEach(y => { if (/^\d{4}$/.test(y)) set.add(y); });
    Object.keys(window.state.reports || {}).forEach(y => { if (/^\d{4}$/.test(y)) set.add(y); });
    set.add(mntCurrentYear());
    set.add(mntActiveYear());
    return [...set].sort();
};

// Authoritative block list for a year, from the Planting Phase Record
const mntBlocksForYear = (yearStr) => {
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

const mntGangNames = (yearStr) => Object.keys(mntEnsureYear(yearStr).gangs).sort();

// Roster (headcount + members) for a gang in a given month
const mntGangMonth = (yearStr, gang, month) => {
    const g = mntEnsureYear(yearStr).gangs[gang];
    if (!g || !g.months || !g.months[month]) return null;
    return g.months[month];
};

// ─────────────────────────────────────────────────────────────────────
// Date helpers (work on plain 'YYYY-MM-DD' strings — no timezone drift)
// ─────────────────────────────────────────────────────────────────────
const mntMonthIndex = (month) => MNT_MONTHS.indexOf(month);
const mntDaysInMonth = (yearStr, month) => new Date(Number(yearStr), mntMonthIndex(month) + 1, 0).getDate();
const mntPad = (n) => String(n).padStart(2, '0');
const mntDayStr = (yearStr, month, day) => `${yearStr}-${mntPad(mntMonthIndex(month) + 1)}-${mntPad(day)}`;

// Inclusive day span between two ISO date strings
const mntDaySpan = (start, end) => {
    if (!start) return 0;
    const s = new Date(start + 'T00:00:00');
    const e = new Date((end || start) + 'T00:00:00');
    const diff = Math.round((e - s) / 86400000);
    return diff >= 0 ? diff + 1 : 0;
};

// Does an entry's date range touch the selected month?
const mntEntryInMonth = (entry, yearStr, month) => {
    const dim = mntDaysInMonth(yearStr, month);
    const mStart = mntDayStr(yearStr, month, 1);
    const mEnd = mntDayStr(yearStr, month, dim);
    const eStart = entry.dateStart;
    const eEnd = entry.dateEnd || entry.dateStart;
    return eStart <= mEnd && eEnd >= mStart;
};

const mntUid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ─────────────────────────────────────────────────────────────────────
// Firebase save
// ─────────────────────────────────────────────────────────────────────
const saveMaintenanceData = (silent = true) => {
    if (!window._maintenanceDb) {
        if (!silent) window.notify('Not connected. Please login first.', 'warn');
        return Promise.resolve();
    }
    return window._maintenanceDb.ref('shared/maintenance_data').set(JSON.stringify(window.state.maintenance))
        .then(() => {
            if (!silent) {
                window.notify('Maintenance data saved!', 'success');
                if (typeof window.logAudit === 'function') window.logAudit('save', 'maintenance', 'Maintenance data', '');
            }
        })
        .catch(e => { console.error('Maintenance save error:', e); if (!silent) window.notify('Error: ' + e.message, 'error'); });
};
window.saveMaintenanceData = saveMaintenanceData;

// ─────────────────────────────────────────────────────────────────────
// Shared year/month selector bar
//   view: 'gangs' | 'worklog' | 'gantt'  — controls which re-render runs
// ─────────────────────────────────────────────────────────────────────
const mntBuildToolbar = (title, view, { showMonth = true, extraHtml = '' } = {}) => {
    const year = mntActiveYear();
    const month = mntActiveMonth();
    const years = mntAvailableYears();

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex; flex-wrap:wrap; align-items:center; gap:0.75rem; margin-bottom:1.25rem;';

    const yearOpts = years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('');
    const monthOpts = MNT_MONTHS.map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${m}</option>`).join('');

    bar.innerHTML = `
        <h2 style="margin:0; font-size:1.2rem; color:var(--text-primary); flex:1 1 auto;">${title}</h2>
        <label style="font-size:0.85rem; color:var(--text-secondary);">Year</label>
        <select id="mnt-year-sel" class="edit-input" style="padding:0.4rem 0.6rem;">${yearOpts}</select>
        ${showMonth ? `<label style="font-size:0.85rem; color:var(--text-secondary);">Month</label>
        <select id="mnt-month-sel" class="edit-input" style="padding:0.4rem 0.6rem;">${monthOpts}</select>` : ''}
        ${extraHtml}
    `;

    const rerender = () => {
        if (view === 'gangs') renderMaintenanceGangs();
        else if (view === 'worklog') renderMaintenanceWorkLog();
        else if (view === 'gantt') renderMaintenanceGantt();
    };

    setTimeout(() => {
        const ys = document.getElementById('mnt-year-sel');
        if (ys) ys.onchange = () => { window.state.maintYear = ys.value; rerender(); };
        const ms = document.getElementById('mnt-month-sel');
        if (ms) ms.onchange = () => { window.state.maintMonth = ms.value; rerender(); };
    }, 0);

    return bar;
};

// =====================================================================
// VIEW 1 — Maintenance Gangs
// =====================================================================
function renderMaintenanceGangs() {
    const wrapper = document.getElementById('maintenance-gangs-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    const year = mntActiveYear();
    const month = mntActiveMonth();
    mntEnsureYear(year);
    const canEdit = mntCanEdit();

    const addBtn = canEdit
        ? `<button id="mnt-add-gang" class="btn-primary" style="padding:0.45rem 0.9rem;"><span>➕</span> Add Gang</button>`
        : '';
    wrapper.appendChild(mntBuildToolbar('Maintenance Gangs', 'gangs', { extraHtml: addBtn }));

    const note = document.createElement('p');
    note.style.cssText = 'font-size:0.82rem; color:var(--text-secondary); margin:-0.5rem 0 1rem;';
    note.innerHTML = `Headcount &amp; members are stored <strong>per month</strong>. Editing <strong>${month} ${year}</strong> never changes earlier months.`;
    wrapper.appendChild(note);

    const gangs = mntGangNames(year);
    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-x:auto;';

    if (gangs.length === 0) {
        tableWrap.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--text-secondary); border:1px dashed var(--border-color); border-radius:8px;">No maintenance gangs yet for ${year}.${canEdit ? ' Click <strong>➕ Add Gang</strong> to create one.' : ''}</div>`;
    } else {
        let rows = '';
        gangs.forEach(gang => {
            const rm = mntGangMonth(year, gang, month);
            const headcount = rm ? (rm.headcount ?? '') : '';
            const members = rm && Array.isArray(rm.members) ? rm.members.join(', ') : '';
            const isSet = rm != null;
            rows += `
                <tr data-gang="${encodeURIComponent(gang)}">
                    <td style="font-weight:600;">${mEsc(gang)}</td>
                    <td style="text-align:center;">${isSet ? mEsc(headcount) : '<span style="color:var(--text-secondary);">– not set –</span>'}</td>
                    <td>${members ? mEsc(members) : '<span style="color:var(--text-secondary);">—</span>'}</td>
                    <td style="text-align:right; white-space:nowrap;">
                        ${canEdit ? `<button class="mnt-edit-roster" data-gang="${encodeURIComponent(gang)}" style="cursor:pointer; border:none; background:none; font-size:1rem;" title="Edit ${month} roster">✏️</button>
                        <button class="mnt-del-gang" data-gang="${encodeURIComponent(gang)}" style="cursor:pointer; border:none; background:none; font-size:1rem; color:var(--danger);" title="Delete gang">🗑️</button>` : ''}
                    </td>
                </tr>`;
        });
        tableWrap.innerHTML = `
            <table class="grouped-table" style="width:100%; border-collapse:collapse;">
                <thead><tr>
                    <th style="text-align:left;">Gang</th>
                    <th style="text-align:center;">Headcount (${month})</th>
                    <th style="text-align:left;">Members (${month})</th>
                    <th></th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    }
    wrapper.appendChild(tableWrap);

    if (canEdit) {
        const addG = document.getElementById('mnt-add-gang');
        if (addG) addG.onclick = () => {
            const name = (prompt('New maintenance gang name (e.g. "Anwar gang"):') || '').trim();
            if (!name) return;
            const yd = mntEnsureYear(year);
            if (yd.gangs[name]) { window.notify('That gang already exists.', 'warn'); return; }
            yd.gangs[name] = { months: {} };
            saveMaintenanceData(true);
            // Immediately open roster editor for the active month
            mntShowRosterModal(year, month, name, () => { saveMaintenanceData(true); renderMaintenanceGangs(); });
        };
        wrapper.querySelectorAll('.mnt-edit-roster').forEach(btn => {
            btn.onclick = () => {
                const gang = decodeURIComponent(btn.dataset.gang);
                mntShowRosterModal(year, month, gang, () => { saveMaintenanceData(true); renderMaintenanceGangs(); });
            };
        });
        wrapper.querySelectorAll('.mnt-del-gang').forEach(btn => {
            btn.onclick = () => {
                const gang = decodeURIComponent(btn.dataset.gang);
                const yd = mntEnsureYear(year);
                const snapshot = yd.gangs[gang];
                delete yd.gangs[gang];
                saveMaintenanceData(true);
                renderMaintenanceGangs();
                window.notifyUndo(`Deleted gang "${gang}" (${year}).`, () => {
                    mntEnsureYear(year).gangs[gang] = snapshot;
                    saveMaintenanceData(true);
                    renderMaintenanceGangs();
                });
            };
        });
    }

    if (typeof window._applyReadOnly === 'function') window._applyReadOnly(wrapper, 'maintenance');
}
window.renderMaintenanceGangs = renderMaintenanceGangs;

// Roster modal — edit headcount + members for ONE month only
function mntShowRosterModal(yearStr, month, gang, onSave) {
    const existing = document.getElementById('mnt-roster-modal');
    if (existing) existing.remove();

    const yd = mntEnsureYear(yearStr);
    const g = yd.gangs[gang] || (yd.gangs[gang] = { months: {} });
    const current = g.months[month] || {};

    // Find previous month's roster (this year) for a quick "copy from" option
    const mi = mntMonthIndex(month);
    let prevRoster = null, prevMonthName = '';
    for (let i = mi - 1; i >= 0; i--) {
        if (g.months[MNT_MONTHS[i]]) { prevRoster = g.months[MNT_MONTHS[i]]; prevMonthName = MNT_MONTHS[i]; break; }
    }

    const overlay = document.createElement('div');
    overlay.id = 'mnt-roster-modal';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.55); z-index:9999; display:flex; justify-content:center; align-items:center;';
    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg-card); border-radius:8px; padding:1.5rem; width:420px; max-width:92vw; box-shadow:0 4px 24px rgba(0,0,0,0.35); border:1px solid var(--border-color);';
    modal.innerHTML = `
        <h3 style="margin:0 0 1rem; font-size:1rem; color:var(--text-primary); border-bottom:1px solid var(--border-color); padding-bottom:0.75rem;">
            ${mEsc(gang)} — Roster for ${month} ${yearStr}</h3>
        <label style="display:block; font-size:0.85rem; color:var(--text-secondary); margin-bottom:4px;">Headcount</label>
        <input type="number" id="mnt-r-headcount" class="edit-input" min="0" step="1" value="${current.headcount ?? ''}" style="width:100%; padding:0.5rem; margin-bottom:1rem;" />
        <label style="display:block; font-size:0.85rem; color:var(--text-secondary); margin-bottom:4px;">Members (one per line, or comma-separated)</label>
        <textarea id="mnt-r-members" class="edit-input" rows="5" style="width:100%; padding:0.5rem; margin-bottom:0.5rem; resize:vertical;">${mEsc(Array.isArray(current.members) ? current.members.join('\n') : '')}</textarea>
        ${prevRoster ? `<button id="mnt-r-copy" type="button" style="background:none; border:1px dashed var(--border-color); border-radius:6px; padding:0.35rem 0.6rem; cursor:pointer; font-size:0.8rem; color:var(--text-secondary); margin-bottom:1rem;">⤵ Copy from ${prevMonthName}</button>` : ''}
        <div style="display:flex; justify-content:flex-end; gap:0.6rem; margin-top:0.5rem;">
            <button id="mnt-r-cancel" class="btn-secondary" style="padding:0.45rem 1rem;">Cancel</button>
            <button id="mnt-r-save" class="btn-primary" style="padding:0.45rem 1rem;">Save</button>
        </div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.getElementById('mnt-r-cancel').onclick = close;

    const copyBtn = document.getElementById('mnt-r-copy');
    if (copyBtn) copyBtn.onclick = () => {
        document.getElementById('mnt-r-headcount').value = prevRoster.headcount ?? '';
        document.getElementById('mnt-r-members').value = (Array.isArray(prevRoster.members) ? prevRoster.members.join('\n') : '');
    };

    document.getElementById('mnt-r-save').onclick = () => {
        const hcRaw = document.getElementById('mnt-r-headcount').value.trim();
        const membersRaw = document.getElementById('mnt-r-members').value.trim();
        const members = membersRaw ? membersRaw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : [];
        const headcount = hcRaw === '' ? (members.length || 0) : Number(hcRaw);
        g.months[month] = { headcount, members };   // writes ONLY this month
        close();
        if (typeof onSave === 'function') onSave();
    };
}

// =====================================================================
// Section tabs (Work Log / Gantt) — navigate via the global helper so
// the two sibling maintenance views switch with one click.
// =====================================================================
function mntRenderTabs(activeKey) {
    const tabs = [
        { key: 'worklog', label: '📝 Work Log',    view: 'maintenance_worklog' },
        { key: 'gantt',   label: '📊 Gantt Chart', view: 'maintenance_gantt' },
    ];
    const strip = document.createElement('div');
    strip.className = 'section-tabs';
    tabs.forEach(t => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'section-tab' + (t.key === activeKey ? ' active' : '');
        b.textContent = t.label;
        b.onclick = () => {
            if (t.key === activeKey) return;
            if (typeof window._navTo === 'function') window._navTo(t.view);
        };
        strip.appendChild(b);
    });
    return strip;
}

// =====================================================================
// VIEW 2 — Work Log
// =====================================================================
function renderMaintenanceWorkLog() {
    const wrapper = document.getElementById('maintenance-worklog-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';
    wrapper.appendChild(mntRenderTabs('worklog'));

    const year = mntActiveYear();
    const month = mntActiveMonth();
    const yd = mntEnsureYear(year);
    const canEdit = mntCanEdit();

    let extra = `<button id="mnt-dl-template" class="btn-secondary" style="padding:0.45rem 0.9rem;" title="Download an Excel template for this year">⬇️ Template</button>`;
    if (canEdit) {
        extra = `<button id="mnt-add-entry" class="btn-primary" style="padding:0.45rem 0.9rem;"><span>➕</span> Add Entry</button>
                 <button id="mnt-import" class="btn-secondary" style="padding:0.45rem 0.9rem;" title="Import work entries from Excel">📥 Import</button>
                 <button id="mnt-dl-template" class="btn-secondary" style="padding:0.45rem 0.9rem;" title="Download an Excel template for this year">⬇️ Template</button>
                 <button id="mnt-manage-acts" class="btn-secondary" style="padding:0.45rem 0.9rem;" title="Add or remove activity types">⚙️ Activities</button>
                 <input type="file" id="mnt-import-input" accept=".xlsx,.xls" style="display:none;" />`;
    }
    wrapper.appendChild(mntBuildToolbar('Maintenance Work Log', 'worklog', { extraHtml: extra }));

    // Entries that touch the selected month, sorted by start date
    const entries = yd.entries
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => mntEntryInMonth(e, year, month))
        .sort((a, b) => (a.e.dateStart || '').localeCompare(b.e.dateStart || ''));

    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-x:auto;';

    if (entries.length === 0) {
        tableWrap.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--text-secondary); border:1px dashed var(--border-color); border-radius:8px;">No work entries touching ${month} ${year}.${canEdit ? ' Click <strong>➕ Add Entry</strong>.' : ''}</div>`;
    } else {
        let rows = '';
        entries.forEach(({ e, i }) => {
            const st = mntActivityStyle(e.activity);
            const days = mntDaySpan(e.dateStart, e.dateEnd);
            const verMark = e.verified
                ? `<span title="Verified${e.verifiedBy ? ' by ' + mEsc(e.verifiedBy) : ''}" style="color:#16a34a; font-weight:700; font-size:1.05rem;">✓</span>`
                : `<span title="Not yet verified" style="color:var(--text-secondary); font-weight:700; font-size:1.05rem;">–</span>`;
            rows += `
                <tr data-idx="${i}">
                    <td style="text-align:center; ${canEdit ? 'cursor:pointer;' : ''}" class="mnt-verify-cell" data-idx="${i}">${verMark}</td>
                    <td>${e.gang ? mEsc(e.gang) : '<span style="color:var(--text-secondary);">—</span>'}</td>
                    <td><span style="display:inline-block; padding:1px 7px; border-radius:10px; font-size:0.72rem; color:#fff; background:${st.color};">${mEsc(e.activity || '?')}</span></td>
                    <td style="font-weight:600;">${e.block ? 'Blk ' + mEsc(e.block) : '—'}</td>
                    <td style="white-space:nowrap;">${mEsc(e.dateStart || '')}</td>
                    <td style="white-space:nowrap;">${mEsc(e.dateEnd || e.dateStart || '')}</td>
                    <td style="text-align:center;">${days}</td>
                    <td style="text-align:center;">${mEsc(e.persons ?? '')}</td>
                    <td style="font-size:0.8rem; color:var(--text-secondary);">${mEsc([e.round, e.method].filter(Boolean).join(' · '))}</td>
                    <td style="text-align:right; white-space:nowrap;">
                        ${canEdit ? `<button class="mnt-edit-entry" data-idx="${i}" style="cursor:pointer; border:none; background:none; font-size:1rem;" title="Edit">✏️</button>
                        <button class="mnt-del-entry" data-idx="${i}" style="cursor:pointer; border:none; background:none; font-size:1rem; color:var(--danger);" title="Delete">🗑️</button>` : ''}
                    </td>
                </tr>`;
        });
        tableWrap.innerHTML = `
            <table class="grouped-table" style="width:100%; border-collapse:collapse;">
                <thead><tr>
                    <th style="text-align:center;" title="– not verified / ✓ verified">✓</th>
                    <th style="text-align:left;">Gang</th>
                    <th style="text-align:left;">Activity</th>
                    <th style="text-align:left;">Block</th>
                    <th style="text-align:left;">Start</th>
                    <th style="text-align:left;">End</th>
                    <th style="text-align:center;">Days</th>
                    <th style="text-align:center;">Persons</th>
                    <th style="text-align:left;">Round / Method</th>
                    <th></th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    }
    wrapper.appendChild(tableWrap);

    // Template download is available to everyone (read-only too)
    const dlBtn = document.getElementById('mnt-dl-template');
    if (dlBtn) dlBtn.onclick = () => downloadMaintenanceTemplate(year);

    if (canEdit) {
        const addBtn = document.getElementById('mnt-add-entry');
        if (addBtn) addBtn.onclick = () => mntShowEntryModal(year, month, null, () => { saveMaintenanceData(true); renderMaintenanceWorkLog(); });

        const actBtn = document.getElementById('mnt-manage-acts');
        if (actBtn) actBtn.onclick = () => mntManageActivities(year, () => { saveMaintenanceData(true); renderMaintenanceWorkLog(); });

        const impBtn = document.getElementById('mnt-import');
        const impInput = document.getElementById('mnt-import-input');
        if (impBtn && impInput) {
            impBtn.onclick = () => impInput.click();
            impInput.onchange = async () => {
                const file = impInput.files[0];
                if (file) await importMaintenanceWorkLog(file, year);
                impInput.value = '';
            };
        }

        wrapper.querySelectorAll('.mnt-verify-cell').forEach(cell => {
            cell.onclick = () => {
                const idx = Number(cell.dataset.idx);
                const e = yd.entries[idx];
                if (!e) return;
                e.verified = !e.verified;
                e.verifiedBy = e.verified ? (window.currentUserEmail || (window.auth && window.auth.currentUser && window.auth.currentUser.email) || 'supervisor') : null;
                saveMaintenanceData(true);
                renderMaintenanceWorkLog();
            };
        });
        wrapper.querySelectorAll('.mnt-edit-entry').forEach(btn => {
            btn.onclick = () => {
                const idx = Number(btn.dataset.idx);
                mntShowEntryModal(year, month, idx, () => { saveMaintenanceData(true); renderMaintenanceWorkLog(); });
            };
        });
        wrapper.querySelectorAll('.mnt-del-entry').forEach(btn => {
            btn.onclick = () => {
                const idx = Number(btn.dataset.idx);
                const e = yd.entries[idx];
                if (!e) return;
                yd.entries.splice(idx, 1);
                saveMaintenanceData(true);
                renderMaintenanceWorkLog();
                window.notifyUndo(`Deleted entry (${e.gang} · ${e.activity} · Blk ${e.block}).`, () => {
                    yd.entries.splice(Math.min(idx, yd.entries.length), 0, e);
                    saveMaintenanceData(true);
                    renderMaintenanceWorkLog();
                });
            };
        });
    }

    if (typeof window._applyReadOnly === 'function') window._applyReadOnly(wrapper, 'maintenance');
}
window.renderMaintenanceWorkLog = renderMaintenanceWorkLog;

// Add/Edit a work entry. idx = null for new.
function mntShowEntryModal(yearStr, month, idx, onSave) {
    const existing = document.getElementById('mnt-entry-modal');
    if (existing) existing.remove();

    const yd = mntEnsureYear(yearStr);
    const editing = idx != null && yd.entries[idx];
    const e = editing ? yd.entries[idx] : {};

    const gangs = mntGangNames(yearStr);
    const blocks = mntBlocksForYear(yearStr);
    const activities = yd.activityTypes;

    const defStart = e.dateStart || mntDayStr(yearStr, month, 1);
    const defEnd = e.dateEnd || e.dateStart || defStart;

    const gangOpts = gangs.length
        ? gangs.map(g => `<option value="${mEsc(g)}" ${g === e.gang ? 'selected' : ''}>${mEsc(g)}</option>`).join('')
        : '<option value="">(no gangs — add one first)</option>';
    const actOpts = activities.map(a => `<option value="${mEsc(a)}" ${a === e.activity ? 'selected' : ''}>${mEsc(a)}</option>`).join('');
    const blockOpts = blocks.length
        ? `<option value="">— select block —</option>` + blocks.map(b => `<option value="${mEsc(b)}" ${String(b) === String(e.block) ? 'selected' : ''}>Blk ${mEsc(b)}</option>`).join('')
        : '';

    const overlay = document.createElement('div');
    overlay.id = 'mnt-entry-modal';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.55); z-index:9999; display:flex; justify-content:center; align-items:center;';
    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg-card); border-radius:8px; padding:1.5rem; width:460px; max-width:94vw; max-height:90vh; overflow-y:auto; box-shadow:0 4px 24px rgba(0,0,0,0.35); border:1px solid var(--border-color);';

    // Block field: dropdown if we have a block list, else free text
    const blockField = blocks.length
        ? `<select id="mnt-e-block" class="edit-input" style="width:100%; padding:0.5rem;">${blockOpts}</select>`
        : `<input type="text" id="mnt-e-block" class="edit-input" value="${mEsc(e.block || '')}" placeholder="Block number" style="width:100%; padding:0.5rem;" />`;

    modal.innerHTML = `
        <h3 style="margin:0 0 1rem; font-size:1rem; color:var(--text-primary); border-bottom:1px solid var(--border-color); padding-bottom:0.75rem;">
            ${editing ? 'Edit' : 'Add'} Work Entry</h3>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
            <div style="grid-column:1 / -1;">
                <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:3px;">Gang</label>
                <select id="mnt-e-gang" class="edit-input" style="width:100%; padding:0.5rem;">${gangOpts}</select>
            </div>
            <div>
                <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:3px;">Activity</label>
                <select id="mnt-e-activity" class="edit-input" style="width:100%; padding:0.5rem;">${actOpts}</select>
            </div>
            <div>
                <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:3px;">Block</label>
                ${blockField}
            </div>
            <div>
                <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:3px;">Date Start</label>
                <input type="date" id="mnt-e-start" class="edit-input" value="${defStart}" style="width:100%; padding:0.5rem;" />
            </div>
            <div>
                <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:3px;">Date End</label>
                <input type="date" id="mnt-e-end" class="edit-input" value="${defEnd}" style="width:100%; padding:0.5rem;" />
            </div>
            <div>
                <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:3px;">Persons (actual)</label>
                <input type="number" id="mnt-e-persons" class="edit-input" min="0" step="1" value="${e.persons ?? ''}" style="width:100%; padding:0.5rem;" />
            </div>
            <div>
                <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:3px;">Round (optional)</label>
                <input type="text" id="mnt-e-round" class="edit-input" value="${mEsc(e.round || '')}" placeholder="e.g. Round 1" style="width:100%; padding:0.5rem;" />
            </div>
            <div style="grid-column:1 / -1;">
                <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:3px;">Method / Remark (optional)</label>
                <input type="text" id="mnt-e-method" class="edit-input" value="${mEsc(e.method || '')}" placeholder="e.g. Selective spraying" style="width:100%; padding:0.5rem;" />
            </div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:0.6rem; margin-top:1.25rem;">
            <button id="mnt-e-cancel" class="btn-secondary" style="padding:0.45rem 1rem;">Cancel</button>
            <button id="mnt-e-save" class="btn-primary" style="padding:0.45rem 1rem;">${editing ? 'Update' : 'Add'}</button>
        </div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', ev => { if (ev.target === overlay) close(); });
    document.getElementById('mnt-e-cancel').onclick = close;

    document.getElementById('mnt-e-save').onclick = () => {
        const gang = document.getElementById('mnt-e-gang').value;
        const activity = document.getElementById('mnt-e-activity').value;
        const block = String(document.getElementById('mnt-e-block').value || '').trim();
        const dateStart = document.getElementById('mnt-e-start').value;
        const dateEnd = document.getElementById('mnt-e-end').value || dateStart;
        const personsRaw = document.getElementById('mnt-e-persons').value.trim();
        const round = document.getElementById('mnt-e-round').value.trim();
        const methodVal = document.getElementById('mnt-e-method').value.trim();

        if (!dateStart) { window.notify('Date Start is required.', 'warn'); return; }
        if (dateEnd < dateStart) { window.notify('Date End cannot be before Date Start.', 'error'); return; }
        if (!block) { window.notify('Block is required.', 'warn'); return; }

        const rec = {
            id: editing ? (e.id || mntUid()) : mntUid(),
            gang, activity, block, dateStart, dateEnd,
            persons: personsRaw === '' ? null : Number(personsRaw),
            round, method: methodVal,
            verified: editing ? !!e.verified : false,
            verifiedBy: editing ? (e.verifiedBy || null) : null,
            createdBy: editing ? (e.createdBy || null) : (window.currentUserEmail || (window.auth && window.auth.currentUser && window.auth.currentUser.email) || null),
        };
        // Editing an entry invalidates a prior verification
        if (editing && e.verified) { rec.verified = false; rec.verifiedBy = null; }

        if (editing) yd.entries[idx] = rec;
        else yd.entries.push(rec);
        close();
        if (typeof onSave === 'function') onSave();
    };
}

// Manage the per-year configurable activity list
function mntManageActivities(yearStr, onSave) {
    const yd = mntEnsureYear(yearStr);
    const choice = prompt(
        `Activity types for ${yearStr}:\n  ${yd.activityTypes.join(', ')}\n\n` +
        `• To ADD: type a new name\n• To REMOVE: type "-Name" (e.g. -Pruning)\n\nLeave blank to cancel.`
    );
    if (!choice) return;
    const trimmed = choice.trim();
    if (trimmed.startsWith('-')) {
        const target = trimmed.slice(1).trim();
        const found = yd.activityTypes.find(a => a.toLowerCase() === target.toLowerCase());
        if (!found) { window.notify(`"${target}" is not in the list.`, 'warn'); return; }
        const inUse = yd.entries.some(e => e.activity === found);
        if (inUse && !confirm(`"${found}" is used by existing entries. Remove it from the list anyway? (Entries keep their activity.)`)) return;
        yd.activityTypes = yd.activityTypes.filter(a => a !== found);
    } else {
        if (yd.activityTypes.some(a => a.toLowerCase() === trimmed.toLowerCase())) { window.notify('That activity already exists.', 'warn'); return; }
        yd.activityTypes.push(trimmed);
    }
    if (typeof onSave === 'function') onSave();
}

// =====================================================================
// VIEW 3 — Gantt Chart
// =====================================================================
function renderMaintenanceGantt() {
    const wrapper = document.getElementById('maintenance-gantt-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';
    wrapper.appendChild(mntRenderTabs('gantt'));

    const year = mntActiveYear();
    const month = mntActiveMonth();
    const yd = mntEnsureYear(year);

    // Activity / gang / block filters
    const activeFilter = window.state.maintGanttFilter || '__all__';
    const gangFilter   = window.state.maintGanttGang   || '__all__';
    const blockFilter  = window.state.maintGanttBlock  || '__all__';

    // options come from what was actually logged this year (plus the gang roster)
    const gangSet = {};
    Object.keys(yd.gangs || {}).forEach(g => gangSet[g] = 1);
    const blockSet = {};
    yd.entries.forEach(e => {
        if (e.gang) gangSet[e.gang] = 1;
        if (e.block !== undefined && e.block !== '') blockSet[e.block] = 1;
    });
    const gangOpts = Object.keys(gangSet).sort((a, b) => a.localeCompare(b));
    const blockOpts = Object.keys(blockSet).sort((a, b) => {
        const na = parseFloat(a), nb = parseFloat(b);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return a.localeCompare(b);
    });

    const optHtml = (list, selected, allLabel) => ['__all__', ...list]
        .map(v => `<option value="${mEsc(v)}" ${v === selected ? 'selected' : ''}>${v === '__all__' ? mEsc(allLabel) : (allLabel === 'All blocks' ? 'Blk ' + mEsc(v) : mEsc(v))}</option>`).join('');

    const canEdit = mntCanEdit();
    const fillBtn = canEdit
        ? `<button id="mnt-gantt-fill-jc" class="btn-secondary" style="padding:0.4rem 0.7rem;" title="Generate Gantt bars from this month's Job Card actuals (Rate of Wages → Wage Ledger)">🧾 Fill from Job Card</button>`
        : '';
    const extra = `<label style="font-size:0.85rem; color:var(--text-secondary);">Show</label>
                   <select id="mnt-gantt-filter" class="edit-input" style="padding:0.4rem 0.6rem;">${optHtml(yd.activityTypes, activeFilter, 'All activities')}</select>
                   <label style="font-size:0.85rem; color:var(--text-secondary);">Gang</label>
                   <select id="mnt-gantt-gang" class="edit-input" style="padding:0.4rem 0.6rem;">${optHtml(gangOpts, gangFilter, 'All gangs')}</select>
                   <label style="font-size:0.85rem; color:var(--text-secondary);">Block</label>
                   <select id="mnt-gantt-block" class="edit-input" style="padding:0.4rem 0.6rem;">${optHtml(blockOpts, blockFilter, 'All blocks')}</select>
                   ${fillBtn}`;
    wrapper.appendChild(mntBuildToolbar('Maintenance Gantt', 'gantt', { extraHtml: extra }));

    setTimeout(() => {
        const f = document.getElementById('mnt-gantt-filter');
        if (f) f.onchange = () => { window.state.maintGanttFilter = f.value; renderMaintenanceGantt(); };
        const g = document.getElementById('mnt-gantt-gang');
        if (g) g.onchange = () => { window.state.maintGanttGang = g.value; renderMaintenanceGantt(); };
        const b = document.getElementById('mnt-gantt-block');
        if (b) b.onchange = () => { window.state.maintGanttBlock = b.value; renderMaintenanceGantt(); };
        const fb = document.getElementById('mnt-gantt-fill-jc');
        if (fb) fb.onclick = () => mntFillFromJobCard(year, month);
    }, 0);

    const dim = mntDaysInMonth(year, month);

    // Collect entries in month (respecting filter), group by block||gang||activity
    const groups = {};
    yd.entries.forEach(e => {
        if (!mntEntryInMonth(e, year, month)) return;
        if (activeFilter !== '__all__' && mntCanonActivity(e.activity) !== mntCanonActivity(activeFilter)) return;
        if (gangFilter !== '__all__' && String(e.gang) !== gangFilter) return;
        if (blockFilter !== '__all__' && String(e.block) !== blockFilter) return;
        const key = `${e.block}||${e.gang}||${e.activity}`;
        if (!groups[key]) groups[key] = { block: e.block, gang: e.gang, activity: e.activity, entries: [] };
        groups[key].entries.push(e);
    });

    const keys = Object.keys(groups).sort((a, b) => {
        const ga = groups[a], gb = groups[b];
        const na = parseFloat(ga.block), nb = parseFloat(gb.block);
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        if (ga.block !== gb.block) return String(ga.block).localeCompare(String(gb.block));
        if (ga.gang !== gb.gang) return String(ga.gang).localeCompare(String(gb.gang));
        return String(ga.activity).localeCompare(String(gb.activity));
    });

    if (keys.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:2rem; text-align:center; color:var(--text-secondary); border:1px dashed var(--border-color); border-radius:8px;';
        const filtered = activeFilter !== '__all__' || gangFilter !== '__all__' || blockFilter !== '__all__';
        empty.innerHTML = filtered
            ? `No maintenance work matches the current filters for ${month} ${year}.`
            : `No maintenance work recorded for ${month} ${year}.`;
        wrapper.appendChild(empty);
        return;
    }

    const LABEL_W = 230;
    const DAY_W = 26;

    // Day header
    let headCells = '';
    for (let d = 1; d <= dim; d++) {
        const dow = new Date(Number(year), mntMonthIndex(month), d).getDay();
        const weekend = (dow === 0 || dow === 6);
        headCells += `<th style="width:${DAY_W}px; min-width:${DAY_W}px; font-size:0.65rem; padding:2px 0; text-align:center; color:${weekend ? '#b91c1c' : 'var(--text-secondary)'}; background:${weekend ? '#fef2f2' : 'transparent'};">${d}</th>`;
    }

    // Rows
    let bodyRows = '';
    const perDayManpower = new Array(dim + 1).fill(0);

    keys.forEach(key => {
        const grp = groups[key];
        const st = mntActivityStyle(grp.activity);
        // Per-day coverage: store {covered, verified, persons, label}
        const dayInfo = new Array(dim + 1).fill(null);
        grp.entries.forEach(e => {
            for (let d = 1; d <= dim; d++) {
                const ds = mntDayStr(year, month, d);
                if (e.dateStart <= ds && (e.dateEnd || e.dateStart) >= ds) {
                    if (!dayInfo[d]) dayInfo[d] = { verified: false, persons: 0, parts: [] };
                    dayInfo[d].verified = dayInfo[d].verified || !!e.verified;
                    dayInfo[d].persons += Number(e.persons) || 0;
                    dayInfo[d].parts.push(e);
                    perDayManpower[d] += Number(e.persons) || 0;
                }
            }
        });

        let daysSpent = 0;
        let cells = '';
        for (let d = 1; d <= dim; d++) {
            const info = dayInfo[d];
            const dow = new Date(Number(year), mntMonthIndex(month), d).getDay();
            const weekendBg = (dow === 0 || dow === 6) ? '#fafafa' : 'transparent';
            if (info) {
                daysSpent++;
                const bg = info.verified
                    ? st.color
                    : `repeating-linear-gradient(45deg, ${st.color}, ${st.color} 4px, ${st.color}99 4px, ${st.color}99 8px)`;
                const tip = `${grp.activity} · Blk ${grp.block} · ${grp.gang}\n${mntDayStr(year, month, d)}${info.persons ? ' · ' + info.persons + ' persons' : ''}${info.verified ? ' · verified' : ' · not verified'}`;
                cells += `<td style="width:${DAY_W}px; min-width:${DAY_W}px; padding:0; text-align:center;"><div title="${mEsc(tip)}" style="height:20px; margin:2px 1px; border-radius:3px; background:${bg}; color:#fff; font-size:0.6rem; line-height:20px;">${info.persons || ''}</div></td>`;
            } else {
                cells += `<td style="width:${DAY_W}px; min-width:${DAY_W}px; padding:0; background:${weekendBg};"></td>`;
            }
        }

        const label = `Blk ${mEsc(grp.block)} – ${mEsc(grp.gang)} <span style="display:inline-block; padding:0 6px; border-radius:9px; font-size:0.65rem; color:#fff; background:${st.color};">${mEsc(st.abbr)}</span>`;
        bodyRows += `
            <tr>
                <td style="position:sticky; left:0; background:var(--bg-card); width:${LABEL_W}px; min-width:${LABEL_W}px; font-size:0.8rem; padding:4px 8px; border-right:1px solid var(--border-color);">${label}<br><span style="font-size:0.68rem; color:var(--text-secondary);">${daysSpent} day${daysSpent === 1 ? '' : 's'}</span></td>
                ${cells}
            </tr>`;
    });

    // Bottom manpower row
    let mpCells = '';
    for (let d = 1; d <= dim; d++) {
        const v = perDayManpower[d];
        mpCells += `<td style="width:${DAY_W}px; min-width:${DAY_W}px; text-align:center; font-size:0.68rem; padding:3px 0; color:${v ? 'var(--text-primary)' : 'var(--text-secondary)'}; font-weight:${v ? '600' : '400'};">${v || ''}</td>`;
    }

    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-x:auto; border:1px solid var(--border-color); border-radius:8px;';
    tableWrap.innerHTML = `
        <table style="border-collapse:collapse; width:max-content;">
            <thead><tr>
                <th style="position:sticky; left:0; background:var(--bg-card); width:${LABEL_W}px; min-width:${LABEL_W}px; text-align:left; font-size:0.78rem; padding:4px 8px; border-right:1px solid var(--border-color);">Block – Gang (Activity)</th>
                ${headCells}
            </tr></thead>
            <tbody>${bodyRows}</tbody>
            <tfoot><tr style="border-top:2px solid var(--border-color);">
                <td style="position:sticky; left:0; background:var(--bg-card); font-size:0.75rem; font-weight:600; padding:4px 8px; border-right:1px solid var(--border-color);">Manpower / day</td>
                ${mpCells}
            </tr></tfoot>
        </table>`;
    wrapper.appendChild(tableWrap);

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex; flex-wrap:wrap; gap:1rem; margin-top:1rem; font-size:0.78rem; color:var(--text-secondary); align-items:center;';
    let legendHtml = '';
    yd.activityTypes.forEach(a => {
        const st = mntActivityStyle(a);
        legendHtml += `<span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:14px; height:14px; border-radius:3px; background:${st.color}; display:inline-block;"></span>${a}</span>`;
    });
    legendHtml += `<span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:14px; height:14px; border-radius:3px; background:repeating-linear-gradient(45deg,#94a3b8,#94a3b8 4px,#cbd5e1 4px,#cbd5e1 8px); display:inline-block;"></span>Not yet verified (striped)</span>`;
    legendHtml += `<span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:14px; height:14px; border-radius:3px; background:#64748b; display:inline-block;"></span>Verified (solid)</span>`;
    legend.innerHTML = legendHtml;
    wrapper.appendChild(legend);
}
window.renderMaintenanceGantt = renderMaintenanceGantt;

// =====================================================================
// Fill the Gantt from Job Card actuals (Rate of Wages → Wage Ledger)
// ---------------------------------------------------------------------
// Converts state.wagesLedger[year][month].jobcard rows into maintenance
// Work Log entries (which the Gantt is built from). Rows are aggregated by
// gang|activity|block|dateStart|dateEnd; persons = distinct employees in
// that bucket (so the Gantt's manpower/day reads as headcount). Derived
// entries are tagged source:'jobcard' + sourceYear/sourceMonth so a re-run
// REPLACES the previous job-card fill for that month and never disturbs
// manually-entered rows.
// =====================================================================
function mntFillFromJobCard(yearStr, month) {
    const ledger = window.state.wagesLedger
        && window.state.wagesLedger[yearStr]
        && window.state.wagesLedger[yearStr][month];
    const rows = (ledger && Array.isArray(ledger.jobcard)) ? ledger.jobcard : [];
    if (!rows.length) {
        window.notify(`No Job Card data for ${month} ${yearStr}. Import it under Rate of Wages → Wage Ledger first.`, 'warn');
        return;
    }

    const yd = mntEnsureYear(yearStr);

    // Resolve a job activity to the year's activity list (add new ones so they
    // get a colour/legend/filter entry, mirroring the Excel import behaviour).
    const resolveActivity = (raw) => {
        const val = String(raw || '').trim();
        if (!val) return 'Other';
        const existing = yd.activityTypes.find(a => a.toLowerCase() === val.toLowerCase());
        if (existing) return existing;
        const canon = mntActivityFromText(val);
        if (canon) return yd.activityTypes.find(a => a.toLowerCase() === canon.toLowerCase()) || canon;
        yd.activityTypes.push(val);
        return val;
    };

    // Accept only real ISO dates; ignore anything else.
    const iso = (v) => { const s = String(v == null ? '' : v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; };

    const buckets = {};
    let skipped = 0;
    rows.forEach((r, i) => {
        const gang = String(r.gang || '').trim();
        const dateStart = iso(r.startDate) || iso(r.jobDate) || iso(r.completeDate);
        const dateEnd = iso(r.completeDate) || iso(r.startDate) || iso(r.jobDate) || dateStart;
        if (!gang || !dateStart) { skipped++; return; }
        const block = mntCleanBlock(r.block);
        const activity = resolveActivity(r.jobActivity);
        const key = `${gang}||${activity}||${block}||${dateStart}||${dateEnd}`;
        if (!buckets[key]) buckets[key] = { gang, activity, block, dateStart, dateEnd, emps: new Set(), count: 0 };
        const emp = String(r.employee || '').trim();
        buckets[key].emps.add(emp || ('#row' + i));
        buckets[key].count++;
    });

    const bucketKeys = Object.keys(buckets);
    if (!bucketKeys.length) {
        window.notify(`No usable Job Card rows for ${month} ${yearStr} (each needs at least a gang and a date).`, 'warn');
        return;
    }

    const existingDerived = yd.entries.filter(e => e.source === 'jobcard' && e.sourceYear === yearStr && e.sourceMonth === month);
    const proceed = confirm(
        `Fill the Gantt for ${month} ${yearStr} from Job Card data:\n\n` +
        `• ${rows.length} job card row(s) → ${bucketKeys.length} work bar(s)\n` +
        (skipped ? `• ${skipped} row(s) skipped (missing gang or date)\n` : '') +
        (existingDerived.length ? `\n⚠ This REPLACES ${existingDerived.length} previously job-card-filled entr${existingDerived.length === 1 ? 'y' : 'ies'} for this month. Manually-added entries are kept.` : '') +
        `\n\nProceed?`
    );
    if (!proceed) return;

    // Drop the previous job-card fill for this month, then add the fresh set.
    yd.entries = yd.entries.filter(e => !(e.source === 'jobcard' && e.sourceYear === yearStr && e.sourceMonth === month));
    bucketKeys.forEach(key => {
        const b = buckets[key];
        yd.entries.push({
            id: mntUid(),
            gang: b.gang, activity: b.activity, block: b.block,
            dateStart: b.dateStart, dateEnd: b.dateEnd,
            persons: b.emps.size || b.count,
            round: '',
            method: `From ${b.count} job card${b.count === 1 ? '' : 's'}`,
            verified: false, verifiedBy: null,
            createdBy: 'jobcard',
            source: 'jobcard', sourceYear: yearStr, sourceMonth: month,
        });
    });

    saveMaintenanceData(false);
    if (typeof window.logAudit === 'function') window.logAudit('import', 'maintenance', `Job Card → Gantt: ${bucketKeys.length} bars for ${month} ${yearStr}`, yearStr);
    renderMaintenanceGantt();
    window.notify(`Filled ${bucketKeys.length} Gantt bar(s) from ${rows.length} job card row(s).`, 'success');
}
window.mntFillFromJobCard = mntFillFromJobCard;

// =====================================================================
// Import / Template
// =====================================================================
const mntLoadExcelJS = async () => {
    if (typeof window.ExcelJS !== 'undefined') return;
    await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
        s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
        document.head.appendChild(s);
    });
};

// Normalise a header cell to compare against known column names
const mntNormHeader = h => String(h == null ? '' : h).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

// Map a normalised header to an entry field (or null)
const mntHeaderField = (norm) => {
    if (!norm) return null;
    if (norm === 'GANG' || norm === 'GANGNAME') return 'gang';
    if (norm === 'ACTIVITY' || norm === 'WORKTYPE' || norm === 'TYPE') return 'activity';
    if (norm === 'BLOCK' || norm === 'BLOCKNO' || norm === 'BLOCKSLASHED' || norm === 'BLK') return 'block';
    if (norm === 'DATESTART' || norm === 'START' || norm === 'STARTDATE' || norm === 'DATEFROM' || norm === 'FROM') return 'dateStart';
    if (norm === 'DATEEND' || norm === 'END' || norm === 'ENDDATE' || norm === 'DATETO' || norm === 'TO') return 'dateEnd';
    if (norm === 'PERSONS' || norm === 'PERSON' || norm === 'MANPOWER' || norm === 'HEADCOUNT' || norm === 'PAX') return 'persons';
    if (norm === 'ROUND') return 'round';
    if (norm === 'METHOD' || norm === 'WORKMETHOD' || norm === 'SPRAYINGMETHOD' || norm === 'REMARK' || norm === 'REMARKS') return 'method';
    return null;
};

// Derive an activity from free text (section title or sheet name)
const mntActivityFromText = (text) => {
    const t = String(text || '').toUpperCase();
    if (t.includes('SPRAY')) return 'Spraying';
    if (t.includes('SLASH')) return 'Slashing';
    if (t.includes('MANUR')) return 'Manuring';
    if (t.includes('PRUN'))  return 'Pruning';
    return null;
};

// Canonical activity name (keyword-aware): "Slash" → "Slashing", custom names pass through.
const mntCanonActivity = (name) => mntActivityFromText(name) || String(name == null ? '' : name).trim();
window.mntCanonActivity = mntCanonActivity;

// Strip "Blk"/"Block" prefix → just the id/number
const mntCleanBlock = (v) => String(v == null ? '' : v).trim().replace(/^(blk|block)\s*/i, '').trim();

// Convert an Excel cell value (Date / ISO string / serial) to 'YYYY-MM-DD'
const mntToISO = (v) => {
    if (v == null || v === '') return '';
    if (v instanceof Date) {
        return `${v.getFullYear()}-${mntPad(v.getMonth() + 1)}-${mntPad(v.getDate())}`;
    }
    if (typeof v === 'object' && v !== null && 'result' in v) return mntToISO(v.result);
    if (typeof v === 'number') {
        // Excel serial date → JS Date (account for the 1900 epoch)
        const d = new Date(Math.round((v - 25569) * 86400000));
        return `${d.getUTCFullYear()}-${mntPad(d.getUTCMonth() + 1)}-${mntPad(d.getUTCDate())}`;
    }
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);          // ISO (with or without time)
    const d = new Date(s);
    if (!isNaN(d)) return `${d.getFullYear()}-${mntPad(d.getMonth() + 1)}-${mntPad(d.getDate())}`;
    return '';
};

// ── Download an Excel import template (pre-loaded with the year's gangs/blocks) ──
async function downloadMaintenanceTemplate(yearStr) {
    try {
        await mntLoadExcelJS();
        const yd = mntEnsureYear(yearStr);
        const gangs = mntGangNames(yearStr);
        const blocks = mntBlocksForYear(yearStr);
        const activities = yd.activityTypes;

        const wb = new window.ExcelJS.Workbook();
        const ws = wb.addWorksheet(`Work Log ${yearStr}`);
        const headers = ['Gang', 'Activity', 'Block', 'Date Start', 'Date End', 'Persons', 'Round', 'Method'];

        // Title
        ws.mergeCells(1, 1, 1, headers.length);
        const title = ws.getCell(1, 1);
        title.value = `MAINTENANCE WORK LOG — ${yearStr}`;
        title.font = { bold: true, size: 13, color: { argb: 'FF14532D' } };
        title.alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getRow(1).height = 22;

        // Instructions
        ws.mergeCells(2, 1, 2, headers.length);
        const note = ws.getCell(2, 1);
        note.value = 'Fill one row per work entry. Dates as YYYY-MM-DD. Block can be "2" or "Blk 2". Date End optional (defaults to Date Start). Gang/Activity/Block have dropdowns.';
        note.font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
        note.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        ws.getRow(2).height = 28;

        // Header row (row 4)
        const HR = 4;
        const hdr = ws.getRow(HR);
        hdr.values = headers;
        hdr.height = 20;
        hdr.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFF8FAFC' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
            cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
        });
        const widths = [26, 14, 10, 14, 14, 10, 12, 26];
        widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

        // Example row
        const ex = ws.getRow(HR + 1);
        ex.values = [gangs[0] || 'Anwar gang', activities[0] || 'Spraying', blocks[0] || '2', `${yearStr}-04-14`, `${yearStr}-04-18`, 4, 'Round 1', 'Selective spraying'];
        ex.eachCell((cell) => { cell.font = { color: { argb: 'FF94A3B8' }, italic: true }; });

        // Hidden "Lists" sheet for dropdown sources
        const lists = wb.addWorksheet('Lists', { state: 'hidden' });
        lists.getCell('A1').value = 'Gangs';
        lists.getCell('B1').value = 'Activities';
        lists.getCell('C1').value = 'Blocks';
        gangs.forEach((g, i) => { lists.getCell(`A${i + 2}`).value = g; });
        activities.forEach((a, i) => { lists.getCell(`B${i + 2}`).value = a; });
        blocks.forEach((b, i) => { lists.getCell(`C${i + 2}`).value = b; });

        const dvRange = (col, count) => count > 0 ? `Lists!$${col}$2:$${col}$${count + 1}` : null;
        const gangRange = dvRange('A', gangs.length);
        const actRange  = dvRange('B', activities.length);
        const blkRange  = dvRange('C', blocks.length);

        // Apply dropdowns + date formatting to rows HR+1 .. HR+200
        for (let r = HR + 1; r <= HR + 200; r++) {
            const row = ws.getRow(r);
            if (gangRange) row.getCell(1).dataValidation = { type: 'list', allowBlank: true, formulae: [gangRange] };
            if (actRange)  row.getCell(2).dataValidation = { type: 'list', allowBlank: true, formulae: [actRange] };
            if (blkRange)  row.getCell(3).dataValidation = { type: 'list', allowBlank: true, formulae: [blkRange] };
            row.getCell(4).numFmt = 'yyyy-mm-dd';
            row.getCell(5).numFmt = 'yyyy-mm-dd';
        }

        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Maintenance_Work_Log_Template_${yearStr}.xlsx`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch (err) {
        console.error('Maintenance template error:', err);
        window.notify('Template error: ' + err.message, 'error');
    }
}
window.downloadMaintenanceTemplate = downloadMaintenanceTemplate;

// ── Import work entries from Excel ──
// Robust: scans every sheet, finds header rows (containing "Gang"), maps columns,
// and infers Activity from a column, a section title, or the sheet name.
// Also reads the user's existing multi-section "Spraying List / Slashing List" sheets.
async function importMaintenanceWorkLog(file, yearStr) {
    if (!file) return;
    try {
        await mntLoadExcelJS();
        const wb = new window.ExcelJS.Workbook();
        await wb.xlsx.load(await file.arrayBuffer());

        const yd = mntEnsureYear(yearStr);
        const added = [];
        let skipped = 0;

        // Match an imported activity to the year's list (case-insensitive); add if new
        const resolveActivity = (raw) => {
            const val = String(raw || '').trim();
            if (!val) return '';
            const existing = yd.activityTypes.find(a => a.toLowerCase() === val.toLowerCase());
            if (existing) return existing;
            yd.activityTypes.push(val);
            return val;
        };

        wb.eachSheet((ws) => {
            const sheetActivity = mntActivityFromText(ws.name);
            let colMap = null;          // { field: colIdx }
            let contextActivity = sheetActivity; // from latest section title

            ws.eachRow((row, rowIdx) => {
                const vals = row.values; // 1-based
                const nonEmpty = vals.filter(v => v != null && String(v).trim() !== '');

                // Detect a header row (some cell == GANG)
                let headerCols = null;
                for (let c = 1; c < vals.length; c++) {
                    if (mntNormHeader(vals[c]) === 'GANG') { headerCols = true; break; }
                }
                if (headerCols) {
                    colMap = {};
                    for (let c = 1; c < vals.length; c++) {
                        const f = mntHeaderField(mntNormHeader(vals[c]));
                        if (f && colMap[f] === undefined) colMap[f] = c;
                    }
                    return; // header row itself is not data
                }

                // Section title row (single text cell like "SLASHING MAINTENANCE")
                if (nonEmpty.length === 1) {
                    const a = mntActivityFromText(nonEmpty[0]);
                    if (a) contextActivity = a;
                    return;
                }

                if (!colMap || colMap.gang === undefined) return; // no header seen yet

                const gang = String(vals[colMap.gang] == null ? '' : vals[colMap.gang]).trim();
                const dateStart = mntToISO(colMap.dateStart !== undefined ? vals[colMap.dateStart] : '');
                const block = mntCleanBlock(colMap.block !== undefined ? vals[colMap.block] : '');
                if (!gang || !dateStart || !block) {
                    // ignore fully-blank rows silently; count partial rows as skipped
                    if (gang || block || dateStart) skipped++;
                    return;
                }

                const dateEnd = mntToISO(colMap.dateEnd !== undefined ? vals[colMap.dateEnd] : '') || dateStart;
                const personsRaw = colMap.persons !== undefined ? vals[colMap.persons] : '';
                const persons = (personsRaw === '' || personsRaw == null) ? null : Number(personsRaw);
                const round = colMap.round !== undefined ? String(vals[colMap.round] || '').trim() : '';
                const method = colMap.method !== undefined ? String(vals[colMap.method] || '').trim() : '';
                const activityRaw = colMap.activity !== undefined ? String(vals[colMap.activity] || '').trim() : '';
                const activity = resolveActivity(activityRaw || contextActivity || 'Spraying');

                added.push({
                    id: mntUid(), gang, activity, block, dateStart, dateEnd,
                    persons: isNaN(persons) ? null : persons,
                    round, method, verified: false, verifiedBy: null, createdBy: 'import',
                });
            });
        });

        if (added.length === 0) {
            window.notify(`No importable rows found.\nMake sure there is a header row with at least "Gang", a date, and "Block".`, 'warn');
            return;
        }

        const proceed = confirm(
            `Found ${added.length} work entr${added.length === 1 ? 'y' : 'ies'} to import into ${yearStr}` +
            (skipped ? ` (${skipped} incomplete row(s) skipped)` : '') +
            `.\n\nAdd them to the Work Log? (Existing entries are kept.)`
        );
        if (!proceed) return;

        yd.entries.push(...added);
        await saveMaintenanceData(false);
        if (typeof window.logAudit === 'function') window.logAudit('import', 'maintenance', `${added.length} work entries`, yearStr);
        renderMaintenanceWorkLog();
    } catch (err) {
        console.error('Maintenance import error:', err);
        window.notify('Import error: ' + err.message, 'error');
    }
}
window.importMaintenanceWorkLog = importMaintenanceWorkLog;
