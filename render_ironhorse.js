// =====================================================================
// render_ironhorse.js — Iron Horse Asset Numbers & Expenses
// =====================================================================

const IH_MONTHS     = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const IH_CATS       = ['DC','FUEL','LUBE','PART','SR1','TOOL'];
const IH_CAT_LABELS = { DC:'D.C/', FUEL:'FUEL', LUBE:'LUBE', PART:'PART', SR1:'SR/1', TOOL:'TOOL' };

const IH_DEFAULT_ASSET_NOS = ['GT06','GT07','GT08','GT09','GT10','GT12','GT13','GT16','GT17','GT20','GT22'];

// HTML-escape for user/DB free text (gang names, asset no, description, remark,
// extra category names, filter input) before it goes into innerHTML.
const ihEsc = (s) => window.escapeHtml(s);

const getDefaultIronHorseAssets = () => IH_DEFAULT_ASSET_NOS.map(no => ({
    assetNo: no, description: 'IRON HORSE', gangAssignments: []
}));

// ─────────────────────────────────────────────────────────────────────
// Expense category helpers (base + per-year extras like "PET")
// Year structure: { extraCategories: [...], months: { JAN: {...} } }
// ─────────────────────────────────────────────────────────────────────
const ihNormalizeHeader = h => String(h || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

// Map a normalized Excel header to a canonical category key (base or extra),
// or 'TOTAL' to skip, or null to flag as unknown.
const ihMatchHeaderToCategory = (norm, existingExtras) => {
    if (!norm) return { kind: 'skip' };
    if (norm === 'TOTAL' || norm === 'GRANDTOTAL') return { kind: 'skip' };
    if (norm === 'ASSETNO' || norm === 'ASSET' || norm === 'ROWLABELS') return { kind: 'asset' };
    if (IH_CATS.includes(norm))           return { kind: 'base',  key: norm };
    if (norm === 'PARTS')                 return { kind: 'base',  key: 'PART' };
    if (norm === 'TOOLS')                 return { kind: 'base',  key: 'TOOL' };
    if (existingExtras.includes(norm))    return { kind: 'extra', key: norm };
    return { kind: 'unknown', key: norm };
};

// Ensure year has nested {extraCategories, months} structure, migrating old flat data
const ihEnsureExpenseYear = (yearStr) => {
    if (!window.state.ironHorse) window.state.ironHorse = {};
    if (!window.state.ironHorse.expenses) window.state.ironHorse.expenses = {};
    let yd = window.state.ironHorse.expenses[yearStr];
    if (!yd) {
        window.state.ironHorse.expenses[yearStr] = { extraCategories: [], months: {} };
        return window.state.ironHorse.expenses[yearStr];
    }
    if (yd.months !== undefined) {
        if (!yd.extraCategories) yd.extraCategories = [];
        return yd;
    }
    // Old flat structure — migrate
    const migrated = { extraCategories: [], months: {} };
    Object.keys(yd).forEach(k => { if (IH_MONTHS.includes(k)) migrated.months[k] = yd[k]; });
    window.state.ironHorse.expenses[yearStr] = migrated;
    return migrated;
};

const ihGetYearCategories = (yearStr) => {
    const yd = ihEnsureExpenseYear(yearStr);
    return yd.extraCategories || [];
};

const ihGetAllCategories = (yearStr) => [...IH_CATS, ...ihGetYearCategories(yearStr)];

const ihGetCatLabel = (cat) => IH_CAT_LABELS[cat] || cat;

// ─────────────────────────────────────────────────────────────────────
// Gang assignment modal — shows gangs from gangsByYear for the year
// ─────────────────────────────────────────────────────────────────────
// prefill = { gang, from, to, remark } for edit mode, null for new
const ihShowGangAssignModal = (assetNo, yearStr, onConfirm, prefill = null) => {
    const existing = document.getElementById('ih-gang-modal');
    if (existing) existing.remove();

    const gangs = (window.state.gangsByYear && window.state.gangsByYear[yearStr]) || [];

    const overlay = document.createElement('div');
    overlay.id = 'ih-gang-modal';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.55); z-index:9999; display:flex; justify-content:center; align-items:center;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg-card); border-radius:8px; padding:1.5rem; width:400px; box-shadow:0 4px 24px rgba(0,0,0,0.35); border:1px solid var(--border-color);';

    const gangOptions = gangs.length > 0
        ? gangs.map(g => `<option value="${ihEsc(g)}">${ihEsc(g)}</option>`).join('')
        : '<option value="" disabled>No gangs found for ' + yearStr + '</option>';

    const isEdit = !!prefill;
    const defaultFrom = prefill ? prefill.from : `${yearStr}-01-01`;
    const defaultTo   = prefill ? (prefill.to || '') : '';
    const defaultRemark = prefill ? (prefill.remark || '') : '';

    modal.innerHTML = `
        <h3 style="margin:0 0 1.25rem; font-size:1rem; color:var(--text-primary); border-bottom:1px solid var(--border-color); padding-bottom:0.75rem;">
            ${isEdit ? 'Edit Assignment' : 'Assign Gang'} — <span style="color:var(--accent);">${ihEsc(assetNo)}</span>
        </h3>
        <div style="margin-bottom:0.85rem;">
            <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">Gang *</label>
            <select id="ih-gang-select" class="edit-input" style="width:100%; padding:0.5rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card); font-size:0.9rem;">
                <option value="">— Select gang —</option>
                ${gangOptions}
            </select>
        </div>
        <div style="margin-bottom:0.85rem;">
            <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">From Date *</label>
            <input id="ih-gang-from" type="date" class="edit-input" value="${defaultFrom}"
                style="width:100%; padding:0.5rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; font-size:0.9rem;" />
        </div>
        <div style="margin-bottom:0.85rem;">
            <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">To Date <span style="font-weight:400;">(leave blank if ongoing)</span></label>
            <input id="ih-gang-to" type="date" class="edit-input" value="${defaultTo}"
                style="width:100%; padding:0.5rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; font-size:0.9rem;" />
        </div>
        <div style="margin-bottom:1.25rem;">
            <label style="display:block; font-size:0.82rem; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">Remark <span style="font-weight:400;">(optional)</span></label>
            <input id="ih-gang-remark" type="text" class="edit-input" value="${ihEsc(defaultRemark)}" placeholder="e.g. transferred after breakdown"
                style="width:100%; padding:0.5rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; font-size:0.9rem;" />
        </div>
        <div style="display:flex; gap:0.75rem; justify-content:flex-end;">
            <button id="ih-gang-cancel" class="btn-secondary" style="padding:0.4rem 1.25rem;">Cancel</button>
            <button id="ih-gang-confirm" class="btn-primary" style="padding:0.4rem 1.25rem; background:#10b981; border-color:#10b981;">${isEdit ? 'Save Changes' : 'Confirm'}</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Pre-select gang when editing
    if (prefill && prefill.gang) {
        const sel = document.getElementById('ih-gang-select');
        if (sel) sel.value = prefill.gang;
    }

    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    document.getElementById('ih-gang-cancel').onclick = () => overlay.remove();
    document.getElementById('ih-gang-confirm').onclick = () => {
        const gang   = document.getElementById('ih-gang-select').value.trim();
        const from   = document.getElementById('ih-gang-from').value.trim();
        const to     = document.getElementById('ih-gang-to').value.trim() || null;
        const remark = document.getElementById('ih-gang-remark').value.trim();
        if (!gang) { window.notify('Please select a gang.', 'warn'); return; }
        if (!from) { window.notify('Please enter a from date.', 'warn'); return; }
        overlay.remove();
        onConfirm({ gang, from, to, remark });
    };
};

// Resolve which gang an asset belongs to for a given month (0-indexed)
const resolveGangForMonth = (gangAssignments, yearStr, monthIdx) => {
    if (!gangAssignments || gangAssignments.length === 0) return null;
    const midMonth = new Date(parseInt(yearStr), monthIdx, 15);
    const firstOfMonth = new Date(parseInt(yearStr), monthIdx, 1);
    const active = gangAssignments.filter(g => {
        if (!g.from) return false;
        if (new Date(g.from) > midMonth) return false;
        if (g.to && new Date(g.to) < firstOfMonth) return false;
        return true;
    });
    if (active.length === 0) return null;
    return active.sort((a, b) => new Date(b.from) - new Date(a.from))[0];
};

// ─────────────────────────────────────────────────────────────────────
// Shared helper: build a label + <select> row
// ─────────────────────────────────────────────────────────────────────
const ihMakeSelector = (labelText, options, currentVal, onChange) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; align-items:center; gap:0.5rem;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:0.85rem; color:var(--text-secondary);';
    lbl.textContent = labelText;
    const sel = document.createElement('select');
    sel.className = 'edit-input';
    sel.style.cssText = 'padding:0.4rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card); font-size:0.9rem; width:auto;';
    options.forEach(({ value, label }) => {
        const opt = document.createElement('option');
        opt.value = value; opt.textContent = label;
        if (value === currentVal) opt.selected = true;
        sel.appendChild(opt);
    });
    sel.onchange = e => onChange(e.target.value);
    wrap.appendChild(lbl);
    wrap.appendChild(sel);
    return wrap;
};

// Sort/filter state for assets table (persists across re-renders)
let _ihAssetsSort = { col: 'assetNo', dir: 'asc' };
let _ihAssetsFilter = '';

// ─────────────────────────────────────────────────────────────────────
// Section tabs (Assets / Expenses / Cost) — delegate to the existing
// sidebar nav handlers so all navigation logic stays in one place.
// ─────────────────────────────────────────────────────────────────────
function ihRenderTabs(activeKey) {
    const tabs = [
        { key: 'assets',   label: '🔧 Asset Numbers',  sidebarId: 'sidebar-ironhorse-assets' },
        { key: 'expenses', label: '💰 Expenses',        sidebarId: 'sidebar-ironhorse-expenses' },
        { key: 'cost',     label: '📊 Cost per FFB MT', sidebarId: 'sidebar-ironhorse-costperha' },
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
            const el = document.getElementById(t.sidebarId);
            if (el) el.click();
        };
        strip.appendChild(b);
    });
    return strip;
}

// ─────────────────────────────────────────────────────────────────────
// Asset Numbers View
// ─────────────────────────────────────────────────────────────────────
const renderIronHorseAssets = () => {
    const wrapper = document.getElementById('ironhorse-assets-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';
    wrapper.appendChild(ihRenderTabs('assets'));

    if (!window.state.ironHorse)          window.state.ironHorse = {};
    if (!window.state.ironHorse.assets)   window.state.ironHorse.assets = {};
    if (!window.state.ironHorse.expenses) window.state.ironHorse.expenses = {};

    const assetYears = Object.keys(window.state.ironHorse.assets).filter(k => /^\d{4}$/.test(k)).sort();
    const yearStr    = window.state.ihAssetsYear || assetYears[0] || String(new Date().getFullYear());
    const monthStr   = window.state.ihAssetsMonth || 'JAN';

    if (!window.state.ironHorse.assets[yearStr]) {
        window.state.ironHorse.assets[yearStr] = getDefaultIronHorseAssets();
    }
    const assets   = window.state.ironHorse.assets[yearStr];
    const monthIdx = IH_MONTHS.indexOf(monthStr);

    // ── Toolbar ──────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1.5rem; flex-wrap:wrap;';

    const leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex; align-items:center; gap:1rem; flex-wrap:wrap;';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:1.1rem; font-weight:700; color:var(--text-primary); text-transform:uppercase;';
    titleEl.textContent = 'Iron Horse — Asset Numbers';
    leftGroup.appendChild(titleEl);

    const yearOpts = Object.keys(window.state.ironHorse.assets).filter(k => /^\d{4}$/.test(k)).sort().map(y => ({ value: y, label: y }));
    if (yearOpts.length === 0) yearOpts.push({ value: yearStr, label: yearStr });
    leftGroup.appendChild(ihMakeSelector('Year:', yearOpts, yearStr, v => {
        window.state.ihAssetsYear = v; renderIronHorseAssets();
    }));

    const btnAddYear = document.createElement('button');
    btnAddYear.className = 'btn-secondary';
    btnAddYear.style.cssText = 'padding:0.35rem 0.85rem; font-size:0.85rem;';
    btnAddYear.innerHTML = '➕ Add Year';
    btnAddYear.onclick = () => {
        const latest = Object.keys(window.state.ironHorse.assets).filter(k => /^\d{4}$/.test(k)).sort().pop() || yearStr;
        const newY = prompt('Enter year (e.g. 2027):', String(parseInt(latest) + 1));
        if (!newY || !newY.trim()) return;
        const ny = newY.trim();
        if (window.state.ironHorse.assets[ny]) { window.notify(`Year ${ny} already exists.`, 'warn'); return; }
        window.state.ironHorse.assets[ny] = getDefaultIronHorseAssets();
        window.state.ihAssetsYear = ny;
        saveIronHorseData(); renderIronHorseAssets();
    };
    leftGroup.appendChild(btnAddYear);

    leftGroup.appendChild(ihMakeSelector('Month:', IH_MONTHS.map(m => ({ value: m, label: m })), monthStr, v => {
        window.state.ihAssetsMonth = v; renderIronHorseAssets();
    }));

    toolbar.appendChild(leftGroup);

    const rightGroup = document.createElement('div');
    rightGroup.style.cssText = 'display:flex; gap:0.5rem;';

    const btnAddAsset = document.createElement('button');
    btnAddAsset.className = 'btn-secondary';
    btnAddAsset.style.cssText = 'padding:0.4rem 1rem; font-size:0.85rem;';
    btnAddAsset.innerHTML = '➕ Add Asset';
    btnAddAsset.onclick = () => {
        const no = prompt('Asset number (e.g. GT25):');
        if (!no || !no.trim()) return;
        const desc = prompt('Description:', 'IRON HORSE') || 'IRON HORSE';
        const newAssetNo = no.trim().toUpperCase();
        assets.push({ assetNo: newAssetNo, description: desc.trim(), gangAssignments: [] });
        if (typeof window.logAudit === 'function') window.logAudit('add', 'ironhorse', `Asset ${newAssetNo} — Year ${yearStr}`, desc.trim());
        saveIronHorseData(); renderIronHorseAssets();
    };
    rightGroup.appendChild(btnAddAsset);

    const btnSave = document.createElement('button');
    btnSave.className = 'btn-primary';
    btnSave.style.cssText = 'background:#10b981; border-color:#10b981; padding:0.4rem 1rem; font-size:0.85rem;';
    btnSave.innerHTML = '💾 Save';
    btnSave.onclick = () => saveIronHorseData(false);
    rightGroup.appendChild(btnSave);

    toolbar.appendChild(rightGroup);
    wrapper.appendChild(toolbar);

    // ── Filter bar ───────────────────────────────────────────────────
    const filterBar = document.createElement('div');
    filterBar.style.cssText = 'display:flex; align-items:center; gap:0.75rem; margin-bottom:0.75rem; flex-wrap:wrap;';

    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.placeholder = 'Filter by asset no or gang…';
    filterInput.value = _ihAssetsFilter;
    filterInput.style.cssText = 'padding:0.4rem 0.7rem; border:1px solid var(--border-color); border-radius:6px; font-size:0.85rem; background:var(--bg-card); min-width:220px;';
    filterInput.oninput = () => { _ihAssetsFilter = filterInput.value; renderIronHorseAssets(); };
    filterBar.appendChild(filterInput);

    if (_ihAssetsFilter) {
        const clearBtn = document.createElement('button');
        clearBtn.textContent = '✕ Clear';
        clearBtn.style.cssText = 'padding:0.35rem 0.7rem; border:1px solid var(--border-color); border-radius:6px; font-size:0.82rem; background:var(--bg-secondary); cursor:pointer;';
        clearBtn.onclick = () => { _ihAssetsFilter = ''; renderIronHorseAssets(); };
        filterBar.appendChild(clearBtn);
    }

    const filterNote = document.createElement('span');
    filterNote.style.cssText = 'font-size:0.78rem; color:var(--text-secondary);';
    filterNote.textContent = 'Click a column header to sort';
    filterBar.appendChild(filterNote);

    wrapper.appendChild(filterBar);

    // ── Asset Table ──────────────────────────────────────────────────
    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; overflow:hidden;';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; font-size:0.85rem;';

    const hS = 'background:#1e293b; color:#f8fafc; padding:8px 12px; border:1px solid #334155; font-weight:600; font-size:0.78rem; text-transform:uppercase; white-space:nowrap;';
    const sortArrow = (col) => {
        if (_ihAssetsSort.col !== col) return ' <span style="opacity:0.35;">⇅</span>';
        return _ihAssetsSort.dir === 'asc' ? ' <span>▲</span>' : ' <span>▼</span>';
    };
    const sortStyle = 'cursor:pointer; user-select:none;';

    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>
        <th style="${hS}${sortStyle}text-align:center;" data-sort="assetNo">Asset No${sortArrow('assetNo')}</th>
        <th style="${hS}${sortStyle}text-align:left;" data-sort="description">Description${sortArrow('description')}</th>
        <th style="${hS}${sortStyle}text-align:center;" data-sort="gang">Gang — ${monthStr} ${yearStr}${sortArrow('gang')}</th>
        <th style="${hS}text-align:left;">Assignment History</th>
        <th style="${hS}text-align:center;">Actions</th>
    </tr>`;
    thead.querySelectorAll('th[data-sort]').forEach(th => {
        th.onclick = () => {
            const col = th.dataset.sort;
            if (_ihAssetsSort.col === col) {
                _ihAssetsSort.dir = _ihAssetsSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                _ihAssetsSort = { col, dir: 'asc' };
            }
            renderIronHorseAssets();
        };
    });
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const cS = 'border:1px solid var(--border-color); padding:8px 12px; vertical-align:top;';

    // Apply filter
    const filterLow = _ihAssetsFilter.trim().toLowerCase();
    let displayAssets = assets.filter(asset => {
        if (!filterLow) return true;
        const gang = resolveGangForMonth(asset.gangAssignments || [], yearStr, monthIdx);
        const gangName = (gang && gang.gang) ? gang.gang.toLowerCase() : '';
        return asset.assetNo.toLowerCase().includes(filterLow) ||
               (asset.description || '').toLowerCase().includes(filterLow) ||
               gangName.includes(filterLow);
    });

    // Apply sort
    displayAssets = displayAssets.slice().sort((a, b) => {
        let av, bv;
        if (_ihAssetsSort.col === 'gang') {
            const ag = resolveGangForMonth(a.gangAssignments || [], yearStr, monthIdx);
            const bg = resolveGangForMonth(b.gangAssignments || [], yearStr, monthIdx);
            av = (ag && ag.gang) ? ag.gang : 'zzz';
            bv = (bg && bg.gang) ? bg.gang : 'zzz';
        } else {
            av = (a[_ihAssetsSort.col] || '').toLowerCase();
            bv = (b[_ihAssetsSort.col] || '').toLowerCase();
        }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return _ihAssetsSort.dir === 'asc' ? cmp : -cmp;
    });

    if (displayAssets.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="5" style="${cS}text-align:center; color:var(--text-secondary); padding:2rem;">
            ${filterLow ? `No assets match "<strong>${ihEsc(_ihAssetsFilter)}</strong>"` : `No assets for ${yearStr}. Click <strong>Add Asset</strong> to begin.`}</td>`;
        tbody.appendChild(tr);
    }

    displayAssets.forEach((asset, ai) => {
        const active = resolveGangForMonth(asset.gangAssignments || [], yearStr, monthIdx);
        const tr = document.createElement('tr');
        tr.style.background = ai % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-main)';

        // Asset No
        const tdNo = document.createElement('td');
        tdNo.style.cssText = cS + 'font-weight:700; color:var(--accent); text-align:center;';
        tdNo.textContent = asset.assetNo;
        tr.appendChild(tdNo);

        // Description
        const tdDesc = document.createElement('td');
        tdDesc.style.cssText = cS;
        tdDesc.textContent = asset.description || 'IRON HORSE';
        tr.appendChild(tdDesc);

        // Active Gang this month
        const tdGang = document.createElement('td');
        tdGang.style.cssText = cS + 'text-align:center;';
        if (active) {
            const badge = document.createElement('div');
            badge.style.cssText = 'display:inline-block; background:#1d4ed8; color:#fff; padding:3px 12px; border-radius:12px; font-size:0.78rem; font-weight:600;';
            badge.textContent = active.gang;
            tdGang.appendChild(badge);
            if (active.remark) {
                const rem = document.createElement('div');
                rem.style.cssText = 'font-size:0.72rem; color:var(--text-secondary); margin-top:4px; font-style:italic;';
                rem.textContent = active.remark;
                tdGang.appendChild(rem);
            }
        } else {
            tdGang.innerHTML = '<span style="color:#94a3b8; font-size:0.78rem;">— Unassigned —</span>';
        }
        tr.appendChild(tdGang);

        // Assignment History
        const tdHist = document.createElement('td');
        tdHist.style.cssText = cS + 'min-width:260px;';
        const assignments = (asset.gangAssignments || []).slice().sort((a, b) => new Date(a.from) - new Date(b.from));
        if (assignments.length === 0) {
            tdHist.innerHTML = '<span style="color:#94a3b8; font-size:0.78rem;">No assignments yet</span>';
        } else {
            assignments.forEach(g => {
                const row = document.createElement('div');
                row.style.cssText = 'font-size:0.75rem; margin-bottom:6px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;';

                const badge = document.createElement('span');
                badge.style.cssText = 'background:#0f172a; color:#94a3b8; padding:2px 8px; border-radius:10px; font-weight:600;';
                badge.textContent = g.gang;
                row.appendChild(badge);

                const dates = document.createElement('span');
                dates.style.cssText = 'color:var(--text-secondary);';
                dates.textContent = `${g.from} → ${g.to || 'present'}`;
                row.appendChild(dates);

                if (g.remark) {
                    const rem = document.createElement('span');
                    rem.style.cssText = 'color:#64748b; font-style:italic;';
                    rem.textContent = `(${g.remark})`;
                    row.appendChild(rem);
                }

                // Edit button
                const btnEditAssign = document.createElement('button');
                btnEditAssign.style.cssText = 'background:none; border:none; cursor:pointer; color:#3b82f6; font-size:0.72rem; padding:1px 4px; line-height:1;';
                btnEditAssign.textContent = '✏';
                btnEditAssign.title = 'Edit this assignment';
                btnEditAssign.onclick = () => {
                    ihShowGangAssignModal(asset.assetNo, yearStr, ({ gang, from, to, remark }) => {
                        const orig = asset.gangAssignments.find(a => a.gang === g.gang && a.from === g.from);
                        if (orig) {
                            if (typeof window.logAudit === 'function') window.logAudit('edit', 'ironhorse', `${asset.assetNo} gang assignment`, `Before: ${orig.gang} (${orig.from}→${orig.to}), After: ${gang} (${from}→${to})`);
                            orig.gang = gang; orig.from = from; orig.to = to; orig.remark = remark;
                        }
                        saveIronHorseData(); renderIronHorseAssets();
                    }, g);
                };
                row.appendChild(btnEditAssign);

                // Delete button
                const btnDelAssign = document.createElement('button');
                btnDelAssign.style.cssText = 'background:none; border:none; cursor:pointer; color:#dc2626; font-size:0.75rem; padding:1px 4px; line-height:1;';
                btnDelAssign.textContent = '✕';
                btnDelAssign.title = 'Remove this assignment';
                btnDelAssign.onclick = () => {
                    const origIdx = asset.gangAssignments.findIndex(a => a.gang === g.gang && a.from === g.from);
                    if (origIdx === -1) return;
                    const snapshot = asset.gangAssignments[origIdx];
                    if (typeof window.logAudit === 'function') window.logAudit('delete', 'ironhorse', `${asset.assetNo} gang assignment`, `Removed: ${g.gang} (${g.from}→${g.to})`);
                    asset.gangAssignments.splice(origIdx, 1);
                    saveIronHorseData(); renderIronHorseAssets();
                    window.notifyUndo(`Removed assignment "${g.gang}" from ${asset.assetNo}.`, () => {
                        asset.gangAssignments.splice(Math.min(origIdx, asset.gangAssignments.length), 0, snapshot);
                        saveIronHorseData(); renderIronHorseAssets();
                    });
                };
                row.appendChild(btnDelAssign);
                tdHist.appendChild(row);
            });
        }
        tr.appendChild(tdHist);

        // Actions
        const tdAct = document.createElement('td');
        tdAct.style.cssText = cS + 'text-align:center; white-space:nowrap;';

        const btnAssign = document.createElement('button');
        btnAssign.className = 'btn-secondary';
        btnAssign.style.cssText = 'padding:3px 10px; font-size:0.78rem; display:block; width:100%; margin-bottom:4px;';
        btnAssign.textContent = '+ Assign Gang';
        btnAssign.onclick = () => {
            ihShowGangAssignModal(asset.assetNo, yearStr, ({ gang, from, to, remark }) => {
                if (!asset.gangAssignments) asset.gangAssignments = [];
                asset.gangAssignments.push({ gang, from, to, remark });
                if (typeof window.logAudit === 'function') window.logAudit('add', 'ironhorse', `${asset.assetNo} gang assignment`, `${gang} (${from}→${to})`);
                saveIronHorseData(); renderIronHorseAssets();
            });
        };
        tdAct.appendChild(btnAssign);

        const btnDel = document.createElement('button');
        btnDel.className = 'btn-secondary';
        btnDel.style.cssText = 'padding:3px 10px; font-size:0.78rem; background:#dc2626; border-color:#dc2626; color:#fff; display:block; width:100%;';
        btnDel.textContent = '✕ Remove Asset';
        btnDel.onclick = () => {
            const currentList = window.state.ironHorse.assets[yearStr];
            const idx = currentList.findIndex(a => a.assetNo === asset.assetNo);
            if (idx === -1) return;
            const snapshot = currentList[idx];
            if (typeof window.logAudit === 'function') window.logAudit('delete', 'ironhorse', `Asset ${asset.assetNo} — Year ${yearStr}`, 'Asset removed with all gang assignments');
            currentList.splice(idx, 1);
            saveIronHorseData(); renderIronHorseAssets();
            window.notifyUndo(`Removed ${asset.assetNo} from ${yearStr} (incl. its gang assignments).`, () => {
                const list = window.state.ironHorse.assets[yearStr];
                list.splice(Math.min(idx, list.length), 0, snapshot);
                saveIronHorseData(); renderIronHorseAssets();
            });
        };
        tdAct.appendChild(btnDel);
        tr.appendChild(tdAct);
        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    wrapper.appendChild(tableWrap);
};

// ─────────────────────────────────────────────────────────────────────
// Expenses View
// ─────────────────────────────────────────────────────────────────────
const renderIronHorseExpenses = () => {
    const wrapper = document.getElementById('ironhorse-expenses-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';
    wrapper.appendChild(ihRenderTabs('expenses'));

    if (!window.state.ironHorse)          window.state.ironHorse = {};
    if (!window.state.ironHorse.expenses) window.state.ironHorse.expenses = {};
    if (!window.state.ironHorse.assets)   window.state.ironHorse.assets = {};

    const expYears = Object.keys(window.state.ironHorse.expenses).filter(k => /^\d{4}$/.test(k)).sort();
    const yearStr  = window.state.ihExpensesYear || expYears[0] || String(new Date().getFullYear());
    const monthStr = window.state.ihExpensesMonth || 'JAN';

    // ── Toolbar ──────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1.5rem; flex-wrap:wrap;';

    const leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex; align-items:center; gap:1rem; flex-wrap:wrap;';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:1.1rem; font-weight:700; color:var(--text-primary); text-transform:uppercase;';
    titleEl.textContent = 'Iron Horse — Expenses';
    leftGroup.appendChild(titleEl);

    // Year selector
    const yearSel = document.createElement('div');
    yearSel.style.cssText = 'display:flex; align-items:center; gap:0.5rem;';
    const yearLbl = document.createElement('span');
    yearLbl.style.cssText = 'font-size:0.85rem; color:var(--text-secondary);';
    yearLbl.textContent = 'Year:';
    const yearSelect = document.createElement('select');
    yearSelect.className = 'edit-input';
    yearSelect.style.cssText = 'padding:0.4rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card); font-size:0.9rem; width:auto;';
    if (expYears.length === 0) {
        const opt = document.createElement('option'); opt.textContent = 'No data yet'; yearSelect.appendChild(opt); yearSelect.disabled = true;
    } else {
        expYears.forEach(y => {
            const opt = document.createElement('option'); opt.value = y; opt.textContent = y;
            if (y === yearStr) opt.selected = true; yearSelect.appendChild(opt);
        });
        yearSelect.onchange = () => { window.state.ihExpensesYear = yearSelect.value; renderIronHorseExpenses(); };
    }
    yearSel.appendChild(yearLbl); yearSel.appendChild(yearSelect);
    leftGroup.appendChild(yearSel);

    const btnAddYear = document.createElement('button');
    btnAddYear.className = 'btn-secondary';
    btnAddYear.style.cssText = 'padding:0.35rem 0.85rem; font-size:0.85rem;';
    btnAddYear.innerHTML = '➕ Add Year';
    btnAddYear.onclick = () => {
        const latest = expYears.length > 0 ? expYears[expYears.length - 1] : String(new Date().getFullYear() - 1);
        const newY = prompt('Enter year:', String(parseInt(latest) + 1));
        if (!newY || !newY.trim()) return;
        const ny = newY.trim();
        if (window.state.ironHorse.expenses[ny]) { window.notify(`Year ${ny} already exists.`, 'warn'); return; }
        window.state.ironHorse.expenses[ny] = { extraCategories: [], months: {} };
        window.state.ihExpensesYear = ny;
        saveIronHorseData(); renderIronHorseExpenses();
    };
    leftGroup.appendChild(btnAddYear);

    leftGroup.appendChild(ihMakeSelector('Month:', IH_MONTHS.map(m => ({ value: m, label: m })), monthStr, v => {
        window.state.ihExpensesMonth = v; renderIronHorseExpenses();
    }));

    toolbar.appendChild(leftGroup);

    // Right: action buttons
    const rightGroup = document.createElement('div');
    rightGroup.style.cssText = 'display:flex; gap:0.5rem; flex-wrap:wrap;';

    // Add Category
    const btnAddCat = document.createElement('button');
    btnAddCat.className = 'btn-secondary';
    btnAddCat.style.cssText = 'padding:0.4rem 1rem; font-size:0.85rem;';
    btnAddCat.innerHTML = '➕ Add Category';
    btnAddCat.onclick = () => {
        const name = prompt('New category name (e.g. PET):');
        if (!name || !name.trim()) return;
        const norm = ihNormalizeHeader(name);
        if (!norm) return;
        if (IH_CATS.includes(norm)) { window.notify(`"${norm}" is already a base category.`, 'warn'); return; }
        const yd = ihEnsureExpenseYear(yearStr);
        if (yd.extraCategories.includes(norm)) { window.notify(`"${norm}" already exists for ${yearStr}.`, 'warn'); return; }
        yd.extraCategories.push(norm);
        saveIronHorseData(); renderIronHorseExpenses();
    };
    rightGroup.appendChild(btnAddCat);

    // Remove Category (only show when extras exist)
    const yearExtras = ihGetYearCategories(yearStr);
    if (yearExtras.length > 0) {
        const btnRemCat = document.createElement('button');
        btnRemCat.className = 'btn-secondary';
        btnRemCat.style.cssText = 'padding:0.4rem 1rem; font-size:0.85rem; background:#dc2626; border-color:#dc2626; color:#fff;';
        btnRemCat.innerHTML = '✕ Remove Category';
        btnRemCat.onclick = () => {
            const list = yearExtras.map((c, i) => `${i + 1}. ${c}`).join('\n');
            const choice = prompt(`Remove which category from ${yearStr}?\n\n${list}\n\nEnter number:`);
            if (!choice) return;
            const idx = parseInt(choice) - 1;
            if (isNaN(idx) || idx < 0 || idx >= yearExtras.length) { window.notify('Invalid selection.', 'error'); return; }
            const removed = yearExtras[idx];
            if (!confirm(`Remove "${removed}" from year ${yearStr}?\nAll data for this category will be deleted.`)) return;
            const yd = ihEnsureExpenseYear(yearStr);
            yd.extraCategories.splice(idx, 1);
            // Strip the removed key from every asset/month
            Object.values(yd.months || {}).forEach(monthMap => {
                Object.values(monthMap || {}).forEach(assetRow => { delete assetRow[removed]; });
            });
            saveIronHorseData(); renderIronHorseExpenses();
        };
        rightGroup.appendChild(btnRemCat);
    }

    // Download Template button
    const btnDlTpl = document.createElement('button');
    btnDlTpl.className = 'btn-secondary';
    btnDlTpl.style.cssText = 'padding:0.4rem 1rem; font-size:0.85rem;';
    btnDlTpl.innerHTML = '📄 Download Template';
    btnDlTpl.onclick = () => downloadIronHorseTemplate(yearStr, monthStr);
    rightGroup.appendChild(btnDlTpl);

    // Import button
    const btnImport = document.createElement('button');
    btnImport.className = 'btn-secondary';
    btnImport.style.cssText = 'padding:0.4rem 1rem; font-size:0.85rem; background:#1d4ed8; border-color:#1d4ed8; color:#fff;';
    btnImport.innerHTML = '📥 Import Excel';
    const importFileInput = document.createElement('input');
    importFileInput.type = 'file'; importFileInput.accept = '.xlsx,.xls'; importFileInput.style.display = 'none';
    importFileInput.onchange = async () => {
        if (!importFileInput.files[0]) return;
        const yr = prompt('Import to year:', yearStr);
        if (!yr || !yr.trim()) return;
        const mn = prompt('Import to month (e.g. JAN):', monthStr);
        if (!mn || !mn.trim()) return;
        await importIronHorseExpenses(importFileInput.files[0], yr.trim(), mn.trim().toUpperCase());
        importFileInput.value = '';
    };
    btnImport.onclick = () => importFileInput.click();
    rightGroup.appendChild(btnImport);
    rightGroup.appendChild(importFileInput);
    toolbar.appendChild(rightGroup);
    wrapper.appendChild(toolbar);

    // ── Expense Table ────────────────────────────────────────────────
    const activeYearStr = window.state.ihExpensesYear || yearStr;
    const yd = ihEnsureExpenseYear(activeYearStr);
    const monthData = (yd.months || {})[monthStr] || {};
    const allCats = ihGetAllCategories(activeYearStr);
    const baseCount = IH_CATS.length;

    const assetNosInData = Object.keys(monthData);
    const assetsForYear  = (window.state.ironHorse.assets[activeYearStr] || []).map(a => a.assetNo);
    const allAssetNos = [...new Set([...assetNosInData, ...assetsForYear])].sort((a, b) => {
        const na = parseInt(a.replace(/\D/g,'')) || 0;
        const nb = parseInt(b.replace(/\D/g,'')) || 0;
        return na - nb;
    });

    if (allAssetNos.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:3rem; text-align:center; color:var(--text-secondary);';
        empty.innerHTML = `<div style="font-size:2.5rem; margin-bottom:1rem;">📭</div>
            <div style="font-size:1rem; font-weight:600; margin-bottom:0.5rem;">No expense data for ${monthStr} ${activeYearStr}</div>
            <div style="font-size:0.85rem;">Use <strong>Import Excel</strong> above to upload data,<br>or add assets under <strong>Asset Numbers</strong> first.</div>`;
        wrapper.appendChild(empty);
        return;
    }

    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; overflow:hidden;';
    const scrollWrap = document.createElement('div');
    scrollWrap.style.cssText = 'overflow-x:auto;';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; font-size:0.82rem;';

    const hS         = 'background:#1e293b; color:#f8fafc; padding:7px 12px; border:1px solid #334155; font-weight:600; font-size:0.78rem; text-transform:uppercase; text-align:right; min-width:90px;';
    const hExtraS    = 'background:#1e3a5f; color:#dbeafe; padding:7px 12px; border:1px solid #2d4f7c; font-weight:600; font-size:0.78rem; text-transform:uppercase; text-align:right; min-width:90px;';
    const headerCells = allCats.map((c, i) =>
        `<th style="${i < baseCount ? hS : hExtraS}">${ihEsc(ihGetCatLabel(c))}</th>`
    ).join('');

    table.innerHTML = `<thead><tr>
        <th style="${hS}text-align:left; min-width:110px;">Asset No</th>
        ${headerCells}
        <th style="${hS}background:#14532d; color:#dcfce7; min-width:110px;">Total</th>
    </tr></thead>`;

    const tbody = document.createElement('tbody');
    const cS = 'border:1px solid var(--border-color); padding:6px 12px; text-align:right;';
    const cExtraS = cS + 'background:#eff6ff;';

    const grandTotals = {}; allCats.forEach(c => { grandTotals[c] = 0; });
    let grandTotal = 0;

    allAssetNos.forEach((assetNo, ai) => {
        const row = monthData[assetNo] || {};
        const tr = document.createElement('tr');
        tr.style.background = ai % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-main)';

        const tdNo = document.createElement('td');
        tdNo.style.cssText = cS + 'font-weight:700; color:var(--accent); text-align:left;';
        tdNo.textContent = assetNo;
        tr.appendChild(tdNo);

        let rowTotal = 0;
        allCats.forEach((c, i) => {
            const val = parseFloat(row[c]) || 0;
            grandTotals[c] += val; rowTotal += val;
            const td = document.createElement('td');
            td.style.cssText = i < baseCount ? cS : cExtraS;
            td.textContent = val > 0 ? val.toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2}) : '';
            tr.appendChild(td);
        });
        grandTotal += rowTotal;

        const tdTot = document.createElement('td');
        tdTot.style.cssText = cS + 'background:#f0fdf4; font-weight:700; color:#166534;';
        tdTot.textContent = rowTotal > 0 ? rowTotal.toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2}) : '';
        tr.appendChild(tdTot);
        tbody.appendChild(tr);
    });

    // Grand total row
    const trGrand = document.createElement('tr');
    trGrand.style.cssText = 'background:#1e293b; color:#f8fafc;';
    const tdGLbl = document.createElement('td');
    tdGLbl.style.cssText = 'border:1px solid #334155; padding:7px 12px; font-weight:700; text-align:left;';
    tdGLbl.textContent = 'Grand Total';
    trGrand.appendChild(tdGLbl);
    allCats.forEach((c, i) => {
        const td = document.createElement('td');
        const baseStyle = 'border:1px solid #334155; padding:7px 12px; text-align:right; font-weight:700;';
        td.style.cssText = baseStyle + (i < baseCount ? 'color:#86efac;' : 'color:#93c5fd; background:#1e3a5f;');
        td.textContent = grandTotals[c] > 0 ? grandTotals[c].toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—';
        trGrand.appendChild(td);
    });
    const tdGTotal = document.createElement('td');
    tdGTotal.style.cssText = 'border:1px solid #334155; padding:7px 12px; text-align:right; font-weight:700; color:#4ade80; background:#14532d;';
    tdGTotal.textContent = grandTotal > 0 ? grandTotal.toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—';
    trGrand.appendChild(tdGTotal);
    tbody.appendChild(trGrand);

    table.appendChild(tbody);
    scrollWrap.appendChild(table);
    tableWrap.appendChild(scrollWrap);
    wrapper.appendChild(tableWrap);
};

// ─────────────────────────────────────────────────────────────────────
// Firebase Save
// ─────────────────────────────────────────────────────────────────────
const saveIronHorseData = (silent = true) => {
    if (!window._ironHorseDb) {
        if (!silent) window.notify('Not connected. Please login first.', 'warn');
        return;
    }
    window._ironHorseDb.ref('shared/ironhorse_data').set(JSON.stringify(window.state.ironHorse))
        .then(() => {
            if (!silent) {
                window.notify('Iron Horse data saved!', 'success');
                if (typeof window.logAudit === 'function') window.logAudit('save', 'ironhorse', 'Iron Horse data', '');
            }
        })
        .catch(e => { console.error('Iron Horse save error:', e); if (!silent) window.notify('Error: ' + e.message, 'error'); });
};

// ─────────────────────────────────────────────────────────────────────
// Download Expenses Template
//   - Pre-fills asset numbers from the year's asset list
//   - Includes any extra categories the year has (e.g. PET)
//   - Total column has a SUM formula for user reference (system ignores it on import)
// ─────────────────────────────────────────────────────────────────────
async function downloadIronHorseTemplate(yearStr, monthStr) {
    try {
        if (typeof window.ExcelJS === 'undefined') {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
                s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
                document.head.appendChild(s);
            });
        }

        const cats = ihGetAllCategories(yearStr);
        const baseCount = IH_CATS.length;

        // Build asset list — prefer year's asset list, fall back to defaults
        const assetsForYear = (window.state.ironHorse?.assets?.[yearStr] || []);
        const assetNos = assetsForYear.length > 0
            ? assetsForYear.map(a => a.assetNo)
            : IH_DEFAULT_ASSET_NOS;

        const wb = new window.ExcelJS.Workbook();
        const ws = wb.addWorksheet(`IH ${monthStr || ''} ${yearStr}`.trim());

        // Title
        ws.mergeCells(1, 1, 1, 2 + cats.length);
        const titleCell = ws.getCell(1, 1);
        titleCell.value = `IRON HORSE — EXPENSES${monthStr ? ' (' + monthStr + ' ' + yearStr + ')' : ' (' + yearStr + ')'}`;
        titleCell.font = { bold: true, size: 12, color: { argb: 'FF1E293B' } };
        titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
        ws.getRow(1).height = 22;

        // Headers (row 3)
        const headerRowIdx = 3;
        const headers = ['Asset No', ...cats.map(c => ihGetCatLabel(c)), 'Total'];
        const hdrRow = ws.getRow(headerRowIdx);
        hdrRow.values = headers;
        hdrRow.height = 20;
        hdrRow.eachCell((cell, col) => {
            cell.font = { bold: true, color: { argb: 'FFF8FAFC' } };
            cell.alignment = { horizontal: col === 1 ? 'left' : 'right', vertical: 'middle' };
            const isExtra = col > 1 + baseCount && col < headers.length;
            const isTotal = col === headers.length;
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: isTotal ? 'FF14532D' : (isExtra ? 'FF1E3A5F' : 'FF1E293B') }
            };
            cell.border = {
                top:    { style: 'thin', color: { argb: 'FF334155' } },
                bottom: { style: 'thin', color: { argb: 'FF334155' } },
                left:   { style: 'thin', color: { argb: 'FF334155' } },
                right:  { style: 'thin', color: { argb: 'FF334155' } }
            };
        });

        // Column widths
        ws.getColumn(1).width = 14;
        for (let c = 2; c < headers.length; c++) ws.getColumn(c).width = 12;
        ws.getColumn(headers.length).width = 14;

        // Data rows (one per asset)
        assetNos.forEach((assetNo, i) => {
            const r = headerRowIdx + 1 + i;
            const row = ws.getRow(r);
            row.getCell(1).value = assetNo;
            row.getCell(1).font = { bold: true, color: { argb: 'FF1D4ED8' } };
            row.getCell(1).alignment = { horizontal: 'left' };
            // Empty value cells for each category
            for (let c = 0; c < cats.length; c++) {
                const cell = row.getCell(2 + c);
                cell.value = null;
                cell.numFmt = '#,##0.00;-#,##0.00;"-"';
                cell.alignment = { horizontal: 'right' };
            }
            // Total cell (static 0 — user fills in values, Excel will show sum)
            const totalCell = row.getCell(headers.length);
            totalCell.value = 0;
            totalCell.numFmt = '#,##0.00;-#,##0.00;"-"';
            totalCell.alignment = { horizontal: 'right' };
            totalCell.font = { bold: true, color: { argb: 'FF166534' } };
            totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
            // Borders for all data cells
            for (let c = 1; c <= headers.length; c++) {
                row.getCell(c).border = {
                    top:    { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    left:   { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    right:  { style: 'thin', color: { argb: 'FFE2E8F0' } }
                };
            }
        });

        // Grand Total row
        const gtRowIdx = headerRowIdx + 1 + assetNos.length;
        const gtRow = ws.getRow(gtRowIdx);
        gtRow.getCell(1).value = 'Grand Total';
        gtRow.getCell(1).font = { bold: true, color: { argb: 'FFF8FAFC' } };
        gtRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        gtRow.getCell(1).alignment = { horizontal: 'left' };
        for (let c = 0; c < cats.length; c++) {
            const cell = gtRow.getCell(2 + c);
            cell.value = 0;
            cell.numFmt = '#,##0.00;-#,##0.00;"-"';
            cell.font = { bold: true, color: { argb: 'FF86EFAC' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            cell.alignment = { horizontal: 'right' };
        }
        const gtTotalCell = gtRow.getCell(headers.length);
        gtTotalCell.value = 0;
        gtTotalCell.numFmt = '#,##0.00;-#,##0.00;"-"';
        gtTotalCell.font = { bold: true, color: { argb: 'FF4ADE80' } };
        gtTotalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14532D' } };
        gtTotalCell.alignment = { horizontal: 'right' };

        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Iron_Horse_Expenses${monthStr ? '_' + monthStr : ''}_${yearStr}.xlsx`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch (err) {
        console.error('Iron Horse template error:', err);
        window.notify('Template error: ' + err.message, 'error');
    }
}

// ─────────────────────────────────────────────────────────────────────
// Import Expenses from Excel
//   - Detects header row by scanning for "Asset No" / "Row Labels"
//   - Maps each column to a known base/extra category, skips TOTAL
//   - Auto-prompts to add unknown categories (e.g. PET) as a year extra
//   - Skips Grand Total row, treats "-" / blanks as 0
// ─────────────────────────────────────────────────────────────────────
async function importIronHorseExpenses(file, yearStr, monthStr) {
    if (!file) return;
    try {
        if (typeof window.ExcelJS === 'undefined') {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
                s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
                document.head.appendChild(s);
            });
        }
        const wb = new window.ExcelJS.Workbook();
        await wb.xlsx.load(await file.arrayBuffer());
        const ws = wb.worksheets[0];
        if (!ws) { window.notify('No worksheet found.', 'error'); return; }

        // Locate the header row: first row whose first cell contains ASSET/ROW/LABEL
        let headerRowIdx = 0;
        let headerVals = [];
        ws.eachRow((row, i) => {
            if (headerRowIdx !== 0) return;
            const norm = ihNormalizeHeader(row.values[1]);
            if (norm === 'ASSETNO' || norm === 'ASSET' || norm === 'ROWLABELS' || norm.startsWith('ASSET')) {
                headerRowIdx = i;
                headerVals = row.values;
            }
        });

        if (headerRowIdx === 0) { window.notify('Could not find header row. The first column must be "Asset No" or "Row Labels".', 'error'); return; }

        // Ensure year structure exists
        const yd = ihEnsureExpenseYear(yearStr);

        // Build column map: index → { kind, key }
        const colMap = {};         // colIdx -> category key (e.g. "DC", "PET")
        const unknownCols = [];    // [{ colIdx, name }]
        const seenKnown = new Set();
        for (let c = 2; c < headerVals.length; c++) {
            const norm = ihNormalizeHeader(headerVals[c]);
            if (!norm) continue;
            const match = ihMatchHeaderToCategory(norm, yd.extraCategories);
            if (match.kind === 'skip' || match.kind === 'asset') continue;
            if (match.kind === 'base' || match.kind === 'extra') {
                colMap[c] = match.key;
                seenKnown.add(match.key);
            } else if (match.kind === 'unknown') {
                unknownCols.push({ colIdx: c, name: norm });
            }
        }

        // Prompt user for each unknown column
        for (const u of unknownCols) {
            const add = confirm(`Found new category "${u.name}" in the file.\n\nAdd it as a category for year ${yearStr}?\n(Cancel to skip this column.)`);
            if (add) {
                if (!yd.extraCategories.includes(u.name)) yd.extraCategories.push(u.name);
                colMap[u.colIdx] = u.name;
            }
        }

        // Parse data rows
        const parseV = v => {
            if (v == null || v === '') return 0;
            // ExcelJS returns formula cells as { formula: '...', result: value }
            if (typeof v === 'object' && v !== null && 'result' in v) v = v.result;
            if (v == null || v === '') return 0;
            const s = String(v).trim();
            if (s === '-' || s === '—') return 0;
            const n = parseFloat(s.replace(/,/g, ''));
            return isNaN(n) ? 0 : n;
        };

        const monthData = {};
        ws.eachRow((row, i) => {
            if (i <= headerRowIdx) return;
            const vals = row.values;
            const assetNo = String(vals[1] || '').trim().toUpperCase();
            if (!assetNo) return;
            if (assetNo.includes('TOTAL') || assetNo.includes('BLANK') || assetNo === 'GRAND TOTAL') return;
            if (!assetNo.match(/^GT\d+/)) return;

            const entry = {};
            // Initialize all known cats to 0
            ihGetAllCategories(yearStr).forEach(c => { entry[c] = 0; });
            // Fill from columns
            Object.keys(colMap).forEach(colIdx => {
                const key = colMap[colIdx];
                entry[key] = parseV(vals[colIdx]);
            });
            monthData[assetNo] = entry;
        });

        const count = Object.keys(monthData).length;
        if (count === 0) { window.notify('No valid asset rows found (rows must start with GT…). Check file format.', 'error'); return; }

        yd.months[monthStr] = monthData;
        window.state.ihExpensesYear = yearStr;
        window.state.ihExpensesMonth = monthStr;
        saveIronHorseData(false);
        renderIronHorseExpenses();

        const addedExtras = unknownCols.filter(u => yd.extraCategories.includes(u.name)).map(u => u.name);
        const skippedExtras = unknownCols.filter(u => !yd.extraCategories.includes(u.name)).map(u => u.name);
        let msg = `Imported ${count} asset rows for ${monthStr} ${yearStr}.`;
        if (addedExtras.length) msg += `\nNew categories added: ${addedExtras.join(', ')}.`;
        if (skippedExtras.length) msg += `\nSkipped columns: ${skippedExtras.join(', ')}.`;
        window.notify(msg, 'success');
    } catch (err) {
        console.error('Iron Horse import error:', err);
        window.notify('Import error: ' + err.message, 'error');
    }
}

// ─────────────────────────────────────────────────────────────────────
// Iron Horse expenses mini-table injected under each gang's perf chart
// Called from script.js renderPerformanceTable() after chart is built.
// perfMonth = "Jan"/"Feb" (perf format); converted to "JAN"/"FEB" internally.
// ─────────────────────────────────────────────────────────────────────
const renderIHExpensesForGang = (gangWrapper, gangName, yearStr, perfMonth) => {
    const monthStr = perfMonth.toUpperCase();
    const monthIdx = IH_MONTHS.indexOf(monthStr);
    if (monthIdx === -1) return;

    if (!window.state.ironHorse) return;

    // Normalize: strip "- previously ..." suffix and trailing GANG word
    const normGang = s => (s || '').trim().toUpperCase()
        .replace(/\s*-\s*PREVIOUSLY\b.*/i, '')
        .replace(/\bGANG\b\s*$/i, '')
        .trim();

    // Fuzzy match: equal, prefix, or first-word typo (≤1 char diff)
    const gangMatch = (a, b) => {
        const n1 = normGang(a), n2 = normGang(b);
        if (!n1 || !n2) return false;
        if (n1 === n2) return true;
        if (n1.startsWith(n2) || n2.startsWith(n1)) return true;
        // Single-word fuzzy match for typos (e.g. WENDELINUS vs WENDERLINUS)
        const w1 = n1.split(/\s+/)[0], w2 = n2.split(/\s+/)[0];
        if (w1.length >= 5 && w2.length >= 5 && Math.abs(w1.length - w2.length) <= 2) {
            const [lng, sht] = w1.length >= w2.length ? [w1, w2] : [w2, w1];
            let m = 0, si = 0;
            for (let li = 0; li < lng.length && si < sht.length; li++) {
                if (lng[li] === sht[si]) { m++; si++; }
            }
            if (m >= sht.length - 1 && m >= 5) return true;
        }
        return false;
    };

    const assets = (window.state.ironHorse.assets || {})[yearStr] || [];
    const assignedAssets = assets.filter(asset => {
        const active = resolveGangForMonth(asset.gangAssignments || [], yearStr, monthIdx);
        return active && gangMatch(active.gang, gangName);
    });

    const yd        = ihEnsureExpenseYear(yearStr);
    const monthData = ((yd.months || {})[monthStr]) || {};
    const allCats   = ihGetAllCategories(yearStr);
    const baseCount = IH_CATS.length;

    // ── Section wrapper ───────────────────────────────────────────────
    const section = document.createElement('div');
    section.style.cssText = 'margin-top:2rem;';

    const secTitle = document.createElement('div');
    secTitle.style.cssText = 'font-size:0.9rem; font-weight:700; color:var(--text-primary); margin-bottom:0.75rem; padding-bottom:0.5rem; border-bottom:2px solid #1d4ed8; text-transform:uppercase; letter-spacing:0.03em;';
    secTitle.textContent = `🐴 Iron Horse Expenses — ${gangName} (${monthStr} ${yearStr})`;
    section.appendChild(secTitle);

    if (assignedAssets.length === 0) {
        const ph = document.createElement('div');
        ph.style.cssText = 'padding:1rem 1.25rem; background:var(--bg-card); border:1px solid var(--border-color); border-radius:6px; color:var(--text-secondary); font-size:0.85rem; text-align:center;';
        ph.textContent = `No Iron Horse machines assigned to ${gangName} for ${monthStr} ${yearStr}.`;
        section.appendChild(ph);
        gangWrapper.appendChild(section);
        return;
    }

    // ── Expense table ─────────────────────────────────────────────────
    const scrollWrap = document.createElement('div');
    scrollWrap.style.cssText = 'overflow-x:auto; background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px;';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; font-size:0.82rem;';

    const hS     = 'background:#1e293b; color:#f8fafc; padding:7px 12px; border:1px solid #334155; font-weight:600; font-size:0.78rem; text-transform:uppercase; text-align:right;';
    const hXtraS = 'background:#1e3a5f; color:#dbeafe; padding:7px 12px; border:1px solid #2d4f7c; font-weight:600; font-size:0.78rem; text-transform:uppercase; text-align:right;';

    const headerCells = allCats.map((c, i) =>
        `<th style="${i < baseCount ? hS : hXtraS}">${ihEsc(ihGetCatLabel(c))}</th>`
    ).join('');

    table.innerHTML = `<thead><tr>
        <th style="${hS}text-align:left; min-width:110px;">Asset No</th>
        ${headerCells}
        <th style="${hS}background:#14532d; color:#dcfce7; min-width:100px;">Total</th>
    </tr></thead>`;

    const tbody  = document.createElement('tbody');
    const cS     = 'border:1px solid var(--border-color); padding:6px 12px; text-align:right;';
    const cXtraS = cS + 'background:#eff6ff;';

    const grandTotals = {};
    allCats.forEach(c => { grandTotals[c] = 0; });
    let grandTotal = 0;

    assignedAssets.forEach((asset, ai) => {
        const row = monthData[asset.assetNo] || {};
        const tr  = document.createElement('tr');
        tr.style.background = ai % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-main)';

        const tdNo = document.createElement('td');
        tdNo.style.cssText = cS + 'font-weight:700; color:var(--accent); text-align:left;';
        tdNo.textContent = asset.assetNo;
        tr.appendChild(tdNo);

        let rowTotal = 0;
        allCats.forEach((c, i) => {
            const val = parseFloat(row[c]) || 0;
            grandTotals[c] += val;
            rowTotal += val;
            const td = document.createElement('td');
            td.style.cssText = i < baseCount ? cS : cXtraS;
            td.textContent = val > 0
                ? val.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : '—';
            tr.appendChild(td);
        });
        grandTotal += rowTotal;

        const tdTot = document.createElement('td');
        tdTot.style.cssText = cS + 'background:#f0fdf4; font-weight:700; color:#166534;';
        tdTot.textContent = rowTotal > 0
            ? rowTotal.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '—';
        tr.appendChild(tdTot);
        tbody.appendChild(tr);
    });

    // Grand total row
    const trGrand = document.createElement('tr');
    trGrand.style.cssText = 'background:#1e293b; color:#f8fafc;';
    const tdGLbl = document.createElement('td');
    tdGLbl.style.cssText = 'border:1px solid #334155; padding:7px 12px; font-weight:700; text-align:left;';
    tdGLbl.textContent = 'Grand Total';
    trGrand.appendChild(tdGLbl);

    allCats.forEach((c, i) => {
        const td = document.createElement('td');
        td.style.cssText = 'border:1px solid #334155; padding:7px 12px; text-align:right; font-weight:700;'
            + (i < baseCount ? 'color:#86efac;' : 'color:#93c5fd; background:#1e3a5f;');
        td.textContent = grandTotals[c] > 0
            ? grandTotals[c].toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '—';
        trGrand.appendChild(td);
    });

    const tdGTotal = document.createElement('td');
    tdGTotal.style.cssText = 'border:1px solid #334155; padding:7px 12px; text-align:right; font-weight:700; color:#4ade80; background:#14532d;';
    tdGTotal.textContent = grandTotal > 0
        ? grandTotal.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '—';
    trGrand.appendChild(tdGTotal);
    tbody.appendChild(trGrand);

    table.appendChild(tbody);
    scrollWrap.appendChild(table);
    section.appendChild(scrollWrap);
    gangWrapper.appendChild(section);
};

// ─────────────────────────────────────────────────────────────────────
// Shared data computation for the Cost per FFB MT report.
// Used by both the on-screen tables (renderIronHorseCostPerHa) and the
// standalone Excel download (window.downloadIronHorseCostPerFFBMt, surfaced
// under Reports). Computes everything from window.state for the given year.
// ─────────────────────────────────────────────────────────────────────
const ihComputeCostPerFFBMtData = (yearStr) => {
    if (!window.state.ironHorse) window.state.ironHorse = {};

    const assets   = (window.state.ironHorse.assets || {})[yearStr] || [];
    const yd       = ihEnsureExpenseYear(yearStr);
    const allCats  = ihGetAllCategories(yearStr);

    // Gang Ha: sum block.ha per gang from state.reports[year]
    const reports  = (window.state.reports || {})[yearStr] || [];
    const gangHaMap = {};
    reports.forEach(b => {
        if (b.gang && typeof b.ha === 'number' && b.ha > 0) {
            gangHaMap[b.gang] = (gangHaMap[b.gang] || 0) + b.ha;
        }
    });
    const noHaData = Object.keys(gangHaMap).length === 0;

    // Resolve each asset's gang per month; group by July (mid-year) for display order
    const assetMonthGang = {};
    assets.forEach(asset => {
        assetMonthGang[asset.assetNo] = {};
        IH_MONTHS.forEach((m, i) => {
            const a = resolveGangForMonth(asset.gangAssignments || [], yearStr, i);
            assetMonthGang[asset.assetNo][m] = a ? a.gang : null;
        });
    });

    const gangOrder   = [];
    const gangToAssets = {};
    assets.forEach(asset => {
        const julyGang = assetMonthGang[asset.assetNo]['JUL'];
        const primary  = julyGang
            || IH_MONTHS.map(m => assetMonthGang[asset.assetNo][m]).find(g => g)
            || '__UNASSIGNED__';
        if (!gangToAssets[primary]) {
            gangToAssets[primary] = [];
            gangOrder.push(primary);
        }
        gangToAssets[primary].push(asset.assetNo);
    });

    // Monthly expense per asset (sum of all categories)
    const assetMonthExp = {};
    assets.forEach(asset => {
        assetMonthExp[asset.assetNo] = {};
        let yr = 0;
        IH_MONTHS.forEach(m => {
            const row = ((yd.months || {})[m] || {})[asset.assetNo] || {};
            const v   = allCats.reduce((s, c) => s + (parseFloat(row[c]) || 0), 0);
            assetMonthExp[asset.assetNo][m] = v;
            yr += v;
        });
        assetMonthExp[asset.assetNo]['YEAR'] = yr;
    });

    // Gang monthly totals
    const gangMonthExp = {};
    gangOrder.forEach(gangName => {
        gangMonthExp[gangName] = {};
        let yr = 0;
        IH_MONTHS.forEach(m => {
            const v = (gangToAssets[gangName] || []).reduce((s, a) => s + (assetMonthExp[a]?.[m] || 0), 0);
            gangMonthExp[gangName][m] = v;
            yr += v;
        });
        gangMonthExp[gangName]['YEAR'] = yr;
    });

    // Grand totals
    const grandMonthExp = {};
    let grandYearExp = 0;
    IH_MONTHS.forEach(m => {
        const v = gangOrder.reduce((s, g) => s + (gangMonthExp[g]?.[m] || 0), 0);
        grandMonthExp[m] = v;
        grandYearExp += v;
    });
    const totalHa = Object.values(gangHaMap).reduce((s, h) => s + h, 0);

    // FFB MT per gang per month — from performance data (r1+r2+r3 per block)
    // 3-tier lookup to handle gang name variations between iron horse and performance sections:
    //   1. Exact key match
    //   2. Case-insensitive / partial-prefix match
    //   3. Block-level aggregation via gangAssignments (handles name mismatches entirely)
    const sumBlocksMt = gPerf => {
        if (!gPerf || !gPerf.blocks) return 0;
        return Object.values(gPerf.blocks).reduce((s, b) => s + (b.r1 || 0) + (b.r2 || 0) + (b.r3 || 0), 0);
    };

    const getGangMonthMt = (monthPerf, gangName) => {
        if (!monthPerf) return 0;

        // 1. Exact match
        if (monthPerf[gangName]) return sumBlocksMt(monthPerf[gangName]);

        // 2a. Case-insensitive exact match
        const lowerG = gangName.toLowerCase();
        const ciKey = Object.keys(monthPerf).find(k => k !== 'gangAssignments' && k.toLowerCase() === lowerG);
        if (ciKey) return sumBlocksMt(monthPerf[ciKey]);

        // 2b. Performance key is a prefix of the iron horse gang name (e.g. "YUDI" ⊂ "YUDI GANG -previously ERDI GANG")
        const perfKeys = Object.keys(monthPerf).filter(k => k !== 'gangAssignments');
        const prefixKey = perfKeys.find(k => {
            const kl = k.toLowerCase();
            return kl.length >= 4 && lowerG.startsWith(kl);
        });
        if (prefixKey) return sumBlocksMt(monthPerf[prefixKey]);

        // 2c. First word of iron horse name matches start of performance key
        const firstWord = gangName.split(' ')[0].toLowerCase();
        if (firstWord.length >= 4) {
            const fwKey = perfKeys.find(k => k.toLowerCase().startsWith(firstWord));
            if (fwKey) return sumBlocksMt(monthPerf[fwKey]);
        }

        // 2d. First 5 letters match (handles spelling differences, e.g. WENDERLINUS vs WENDELINUS)
        const strip = s => s.toLowerCase().replace(/[^a-z]/g, '');
        const fiveG = strip(gangName).substring(0, 5);
        if (fiveG.length >= 5) {
            const f5Key = perfKeys.find(k => strip(k).startsWith(fiveG));
            if (f5Key) return sumBlocksMt(monthPerf[f5Key]);
        }

        // 2e. Try the name that appears after "previously" in the iron horse gang name
        //     (e.g. "YUDI GANG -previously ERDI GANG" → try matching "ERDI GANG")
        const prevMatch = gangName.match(/previously\s+(.+)/i);
        if (prevMatch) {
            const prevFirst = prevMatch[1].trim().split(/\s+/)[0].toLowerCase();
            if (prevFirst.length >= 4) {
                const pvKey = perfKeys.find(k => k.toLowerCase().startsWith(prevFirst));
                if (pvKey) return sumBlocksMt(monthPerf[pvKey]);
            }
        }

        // 3. Block-level aggregation: find blocks owned by this gang via gangAssignments,
        //    then sum r1+r2+r3 across all performance entries for those block IDs.
        const assignments = monthPerf.gangAssignments || {};
        const ownedBlocks = new Set(
            Object.entries(assignments).filter(([, g]) => g === gangName).map(([id]) => id)
        );
        if (ownedBlocks.size > 0) {
            let total = 0;
            Object.entries(monthPerf).forEach(([key, gData]) => {
                if (key === 'gangAssignments' || !gData?.blocks) return;
                Object.entries(gData.blocks).forEach(([blockId, b]) => {
                    if (ownedBlocks.has(blockId)) total += (b.r1 || 0) + (b.r2 || 0) + (b.r3 || 0);
                });
            });
            return total;
        }

        return 0;
    };

    const gangMonthMt = {};
    const grandMonthMt = {};
    let grandYearMt = 0;
    const gangYearMt = {};
    IH_MONTHS.forEach(m => {
        const perfKey = m.charAt(0) + m.slice(1).toLowerCase(); // "JAN" → "Jan"
        const monthPerf = (window.state.performance?.[yearStr]?.[perfKey]) || {};
        let grandMt = 0;
        gangOrder.forEach(gangName => {
            if (!gangMonthMt[gangName]) gangMonthMt[gangName] = {};
            const gMt = getGangMonthMt(monthPerf, gangName);
            gangMonthMt[gangName][m] = gMt;
            grandMt += gMt;
        });
        grandMonthMt[m] = grandMt;
        grandYearMt += grandMt;
    });
    gangOrder.forEach(g => {
        gangYearMt[g] = IH_MONTHS.reduce((s, m) => s + (gangMonthMt[g]?.[m] || 0), 0);
    });
    const noMtData = grandYearMt === 0;

    return {
        gangHaMap, noHaData, gangOrder, gangToAssets, assetMonthExp,
        gangMonthExp, grandMonthExp, grandYearExp, totalHa,
        gangMonthMt, grandMonthMt, grandYearMt, gangYearMt, noMtData
    };
};

// ─────────────────────────────────────────────────────────────────────
// Standalone Excel download for the Cost per FFB MT report.
// Surfaced under Reports (render_reports.js); also reused via the helper above.
// ─────────────────────────────────────────────────────────────────────
window.downloadIronHorseCostPerFFBMt = async (yearStr) => {
    const {
        gangHaMap, gangOrder, gangToAssets, assetMonthExp,
        gangMonthExp, grandMonthExp, grandYearExp, totalHa,
        gangMonthMt, grandMonthMt, grandYearMt, gangYearMt
    } = ihComputeCostPerFFBMtData(yearStr);

    if (typeof window.ExcelJS === 'undefined') {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s.onload = res; s.onerror = () => rej(new Error('Failed to load ExcelJS'));
            document.head.appendChild(s);
        });
    }
    const wb = new window.ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Cost per FFB MT ${yearStr}`);
    const COLS = 15; // GANG/ASSET + HA + 12 months + TOTAL

    ws.getColumn(1).width = 38;
    ws.getColumn(2).width = 10;
    IH_MONTHS.forEach((_, i) => { ws.getColumn(3 + i).width = 9; });
    ws.getColumn(15).width = 10;

    const BORDER_NORMAL = { style: 'thin',   color: { argb: 'FFB0B8C4' } };
    const BORDER_DARK   = { style: 'thin',   color: { argb: 'FF6B7280' } };
    const BORDER_MEDIUM = { style: 'medium', color: { argb: 'FF374151' } };
    const applyBorder = (cell, type = 'normal') => {
        const s = type === 'dark' ? BORDER_DARK : type === 'medium' ? BORDER_MEDIUM : BORDER_NORMAL;
        cell.border = { top: s, bottom: s, left: s, right: s };
    };
    const numFmt = '#,##0.00';
    const n = v => (v > 0 ? v : null);

    // Title
    const r1 = ws.addRow(['IRON HORSE — EXPENSES BY COST PER FFB MT']);
    ws.mergeCells(r1.number, 1, r1.number, COLS);
    Object.assign(r1.getCell(1), {
        font: { bold: true, size: 14, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } },
        alignment: { horizontal: 'center', vertical: 'middle' }
    });
    r1.height = 24;

    const r2 = ws.addRow([`Cost / FFB MT (RM/MT) — ${yearStr}`]);
    ws.mergeCells(r2.number, 1, r2.number, COLS);
    Object.assign(r2.getCell(1), {
        font: { bold: true, size: 11, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } },
        alignment: { horizontal: 'center', vertical: 'middle' }
    });
    r2.height = 18;

    ws.addRow([]);

    // Header
    const hRow = ws.addRow(['GANG / ASSET', 'HA', ...IH_MONTHS, 'TOTAL']);
    hRow.height = 18;
    hRow.eachCell({ includeEmpty: true }, (cell, c) => {
        cell.font = { bold: true, size: 9, color: { argb: 'FFF8FAFC' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c === COLS ? 'FF14532D' : 'FF1E293B' } };
        cell.alignment = { horizontal: c === 1 ? 'left' : 'right', vertical: 'middle' };
        applyBorder(cell, 'dark');
    });
    hRow.getCell(COLS).font = { bold: true, size: 9, color: { argb: 'FFDCFCE7' } };

    const styleRow = (row, fg, fontArgb, bold, size = 9, italic = false) => {
        row.eachCell({ includeEmpty: true }, (cell, c) => {
            cell.font = { bold, italic, size, color: { argb: fontArgb } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fg } };
            cell.alignment = { horizontal: c === 1 ? 'left' : 'right', vertical: 'middle' };
            applyBorder(cell, 'normal');
            if (c > 1 && typeof cell.value === 'number') cell.numFmt = numFmt;
        });
    };

    // Data rows
    gangOrder.forEach(gangName => {
        const gangLabel = gangName === '__UNASSIGNED__' ? '— Unassigned —' : gangName;

        // Gang Cost/MT row
        const cpmtVals = IH_MONTHS.map(m => {
            const mt = gangMonthMt[gangName]?.[m] || 0;
            return mt > 0 ? (gangMonthExp[gangName]?.[m] || 0) / mt : null;
        });
        const cpmtTotal = gangYearMt[gangName] > 0 ? (gangMonthExp[gangName]?.['YEAR'] || 0) / gangYearMt[gangName] : null;
        const gRow = ws.addRow([gangLabel, n(gangHaMap[gangName] || 0), ...cpmtVals, cpmtTotal]);
        styleRow(gRow, 'FF0F172A', 'FFE2E8F0', true);
        gRow.eachCell({ includeEmpty: true }, cell => applyBorder(cell, 'medium'));
        gRow.getCell(COLS).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14532D' } };
        gRow.getCell(COLS).font = { bold: true, size: 9, color: { argb: 'FFDCFCE7' } };
        gRow.height = 16;

        // Asset rows sit directly under the gang/total header, above the
        // FFB MT / Total Expenses summary sub-rows.
        (gangToAssets[gangName] || []).forEach((assetNo, ai) => {
            const aVals = IH_MONTHS.map(m => {
                const mt = gangMonthMt[gangName]?.[m] || 0;
                return mt > 0 ? (assetMonthExp[assetNo]?.[m] || 0) / mt : null;
            });
            const aTotalMt = gangYearMt[gangName] || 0;
            const aTotal = aTotalMt > 0 ? (assetMonthExp[assetNo]?.['YEAR'] || 0) / aTotalMt : null;
            const aRow = ws.addRow([`  ↳ ${assetNo}`, null, ...aVals, aTotal]);
            styleRow(aRow, ai % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC', 'FF334155', false, 8);
            aRow.getCell(COLS).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
            aRow.getCell(COLS).font = { bold: true, size: 8, color: { argb: 'FF166534' } };
            aRow.height = 14;
        });

        // FFB MT sub-row
        const mtVals = IH_MONTHS.map(m => n(gangMonthMt[gangName]?.[m] || 0));
        const mtRow = ws.addRow(['  FFB MT of Month', null, ...mtVals, n(gangYearMt[gangName] || 0)]);
        styleRow(mtRow, 'FFDBEAFE', 'FF1E40AF', false, 8, true);
        mtRow.getCell(COLS).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFbfdbfe' } };
        mtRow.height = 14;

        // Expenses sub-row
        const expVals = IH_MONTHS.map(m => n(gangMonthExp[gangName]?.[m] || 0));
        const expRow = ws.addRow(['  Total Expenses (RM)', null, ...expVals, n(gangMonthExp[gangName]?.['YEAR'] || 0)]);
        styleRow(expRow, 'FFFEE2E2', 'FF991B1B', false, 8, true);
        expRow.getCell(COLS).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFECACA' } };
        expRow.height = 14;
    });

    // Grand Total — Cost/MT (first)
    const gtCpmtVals = IH_MONTHS.map(m => {
        const mt = grandMonthMt[m] || 0;
        return mt > 0 ? (grandMonthExp[m] || 0) / mt : null;
    });
    const gtCpmtTotal = grandYearMt > 0 ? grandYearExp / grandYearMt : null;
    const gtCpmtRow = ws.addRow(['Cost / FFB MT of the month', null, ...gtCpmtVals, gtCpmtTotal]);
    styleRow(gtCpmtRow, 'FF1E293B', 'FFF8FAFC', true);
    gtCpmtRow.eachCell({ includeEmpty: true }, cell => applyBorder(cell, 'medium'));
    gtCpmtRow.getCell(COLS).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14532D' } };
    gtCpmtRow.getCell(COLS).font = { bold: true, size: 9, color: { argb: 'FF4ADE80' } };
    gtCpmtRow.height = 18;

    // Grand Total — FFB MT (second)
    const gtMtVals = IH_MONTHS.map(m => n(grandMonthMt[m] || 0));
    const gtMtRow = ws.addRow(['Grand Total FFB MT of the month', n(totalHa), ...gtMtVals, n(grandYearMt)]);
    styleRow(gtMtRow, 'FFDBEAFE', 'FF1E40AF', true);
    gtMtRow.eachCell({ includeEmpty: true }, cell => applyBorder(cell, 'medium'));
    gtMtRow.height = 16;

    // Grand Total — Expenses (third)
    const gtExpVals = IH_MONTHS.map(m => n(grandMonthExp[m] || 0));
    const gtExpRow = ws.addRow(['Grand Total Expenses (RM)', null, ...gtExpVals, n(grandYearExp)]);
    styleRow(gtExpRow, 'FFFEE2E2', 'FF991B1B', true);
    gtExpRow.eachCell({ includeEmpty: true }, cell => applyBorder(cell, 'medium'));
    gtExpRow.height = 16;

    // Download
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Iron_Horse_Cost_per_FFB_MT_${yearStr}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
};

// ─────────────────────────────────────────────────────────────────────
// Cost per Ha Report
// Two tables:
//   1. Cost / Ha — monthly expense per asset ÷ gang's total Ha
//   2. Issued Cost — raw RM per asset per month
// Ha per gang is derived from state.reports[year] block data.
// ─────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// Visual layer for the Cost per FFB MT tab: KPI strip + two charts
// (monthly expenses vs production combo; cost-per-MT by gang). Reads
// the same computed data as the tables below it. Chart.js is loaded
// globally from index.html.
// ─────────────────────────────────────────────────────────────────────
const ihRenderCostCharts = (host, d, yearStr) => {
    if (typeof Chart === 'undefined') return;
    const { grandMonthExp, grandYearExp, grandMonthMt, grandYearMt, gangMonthExp, gangMonthMt, gangYearMt, gangOrder, noMtData } = d;
    if (grandYearExp === 0 && noMtData) return; // nothing to draw yet

    window._ihCostCharts = window._ihCostCharts || {};
    const destroy = (id) => { if (window._ihCostCharts[id]) { try { window._ihCostCharts[id].destroy(); } catch (e) { } window._ihCostCharts[id] = null; } };

    const fmtRM = v => 'RM ' + (Number(v) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // KPI values
    const avgCpmt = grandYearMt > 0 ? grandYearExp / grandYearMt : 0;
    let worstM = null, worstV = 0;
    IH_MONTHS.forEach(m => {
        const mt = grandMonthMt[m] || 0;
        if (mt > 0) {
            const c = (grandMonthExp[m] || 0) / mt;
            if (c > worstV) { worstV = c; worstM = m; }
        }
    });

    const sec = document.createElement('div');
    sec.style.cssText = 'margin-bottom:2.5rem;';

    const kpi = (label, value) => `
        <div style="background:var(--bg-secondary); border-radius:10px; padding:0.85rem 1rem; flex:1; min-width:150px;">
            <div style="font-size:0.72rem; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.03em;">${label}</div>
            <div style="font-size:1.25rem; font-weight:700; color:var(--text-primary); margin-top:2px;">${value}</div>
        </div>`;
    const strip = document.createElement('div');
    strip.style.cssText = 'display:flex; gap:0.75rem; flex-wrap:wrap; margin-bottom:1.25rem;';
    strip.innerHTML =
        kpi(`Total expenses ${yearStr}`, fmtRM(grandYearExp)) +
        kpi('Total FFB', grandYearMt > 0 ? grandYearMt.toFixed(2) + ' MT' : '—') +
        kpi('Average cost / MT', grandYearMt > 0 ? fmtRM(avgCpmt) : '—') +
        kpi('Highest cost / MT', worstM ? `${worstM} · ${fmtRM(worstV)}/MT` : '—');
    sec.appendChild(strip);

    const chartCard = (title, canvasId, height) => {
        const card = document.createElement('div');
        card.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:10px; padding:1rem 1.25rem; margin-bottom:1.25rem;';
        card.innerHTML = `
            <div style="font-size:0.9rem; font-weight:700; color:var(--text-primary); margin-bottom:0.6rem;">${title}</div>
            <div style="position:relative; height:${height}px;"><canvas id="${canvasId}"></canvas></div>`;
        return card;
    };

    // ── Chart A: monthly expenses (bars) vs FFB MT + cost/MT (lines) ──
    sec.appendChild(chartCard(`Monthly expenses vs production — ${yearStr}`, 'ihCostCombo', 300));

    // ── Chart B: cost per MT by gang (only gangs with tonnage) ──
    const gangRows = gangOrder
        .filter(g => g !== '__UNASSIGNED__' && (gangYearMt[g] || 0) > 0 && ((gangMonthExp[g] || {}).YEAR || 0) > 0)
        .map(g => ({ g, v: gangMonthExp[g].YEAR / gangYearMt[g] }))
        .sort((a, b) => b.v - a.v);
    if (gangRows.length) {
        sec.appendChild(chartCard(`Cost per MT by gang — ${yearStr}`, 'ihCostGangs', gangRows.length * 42 + 80));
    }

    // ── Per-gang section: one mini combo chart per gang ──
    const perGangs = gangOrder.filter(g =>
        g !== '__UNASSIGNED__' && (((gangMonthExp[g] || {}).YEAR || 0) > 0 || (gangYearMt[g] || 0) > 0));
    if (perGangs.length) {
        const head = document.createElement('div');
        head.style.cssText = 'font-size:0.95rem; font-weight:700; color:var(--text-primary); margin:0.25rem 0 0.75rem;';
        head.textContent = `Per-gang monthly breakdown — ${yearStr}`;
        sec.appendChild(head);

        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fit, minmax(420px, 1fr)); gap:1.25rem;';
        perGangs.forEach((g, i) => {
            const exp = (gangMonthExp[g] || {}).YEAR || 0;
            const mt  = gangYearMt[g] || 0;
            const card = document.createElement('div');
            card.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:10px; padding:1rem 1.25rem;';
            card.innerHTML = `
                <div style="font-size:0.9rem; font-weight:700; color:var(--text-primary);">${g}</div>
                <div style="font-size:0.74rem; color:var(--text-secondary); margin:2px 0 0.6rem;">
                    ${fmtRM(exp)} &nbsp;·&nbsp; ${mt > 0 ? mt.toFixed(2) + ' MT' : '— MT'} &nbsp;·&nbsp; avg ${mt > 0 ? fmtRM(exp / mt) + '/MT' : '—'}
                </div>
                <div style="position:relative; height:230px;"><canvas id="ihCostGangCombo_${i}"></canvas></div>`;
            grid.appendChild(card);
        });
        sec.appendChild(grid);
    }

    host.appendChild(sec);

    const mtArr = IH_MONTHS.map(m => (grandMonthMt[m] || 0) > 0 ? grandMonthMt[m] : null);
    const cpmtArr = IH_MONTHS.map(m => (grandMonthMt[m] || 0) > 0 ? +(((grandMonthExp[m] || 0)) / grandMonthMt[m]).toFixed(2) : null);
    destroy('ihCostCombo');
    window._ihCostCharts['ihCostCombo'] = new Chart(document.getElementById('ihCostCombo').getContext('2d'), {
        data: {
            labels: IH_MONTHS,
            datasets: [
                { type: 'bar', label: 'Expenses (RM)', data: IH_MONTHS.map(m => grandMonthExp[m] || 0), backgroundColor: 'rgba(127,119,221,0.75)', borderRadius: 4, yAxisID: 'y' },
                { type: 'line', label: 'FFB (MT)', data: mtArr, borderColor: '#10b981', backgroundColor: 'transparent', borderWidth: 2.5, tension: 0.3, pointRadius: 3, yAxisID: 'y1' },
                { type: 'line', label: 'Cost / MT (RM)', data: cpmtArr, borderColor: '#f59e0b', backgroundColor: 'transparent', borderWidth: 2, borderDash: [6, 4], tension: 0.3, pointRadius: 2, yAxisID: 'y2' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top' },
                tooltip: { callbacks: { label: (c) => {
                    if (c.dataset.yAxisID === 'y') return ' Expenses: ' + fmtRM(c.parsed.y);
                    if (c.dataset.yAxisID === 'y1') return ' FFB: ' + c.parsed.y.toFixed(2) + ' MT';
                    return ' Cost/MT: ' + fmtRM(c.parsed.y);
                } } }
            },
            scales: {
                y:  { position: 'left', beginAtZero: true, title: { display: true, text: 'RM' } },
                y1: { position: 'right', beginAtZero: true, title: { display: true, text: 'MT' }, grid: { drawOnChartArea: false } },
                y2: { display: false, beginAtZero: true }
            }
        }
    });

    if (gangRows.length) {
        // rank-based traffic light: most expensive third red, middle amber, rest green
        const n = gangRows.length;
        const colorFor = (i) => i < n / 3 ? '#ef4444' : (i < 2 * n / 3 ? '#f59e0b' : '#10b981');
        destroy('ihCostGangs');
        window._ihCostCharts['ihCostGangs'] = new Chart(document.getElementById('ihCostGangs').getContext('2d'), {
            type: 'bar',
            data: {
                labels: gangRows.map(r => r.g),
                datasets: [{ label: 'RM / MT', data: gangRows.map(r => +r.v.toFixed(2)), backgroundColor: gangRows.map((r, i) => colorFor(i)), borderRadius: 4 }]
            },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmtRM(c.parsed.x) + ' / MT' } } },
                scales: { x: { beginAtZero: true, title: { display: true, text: 'RM per MT' } } }
            }
        });
    }

    // destroy any per-gang charts left over from a previous render (gang count may shrink)
    Object.keys(window._ihCostCharts)
        .filter(k => k.startsWith('ihCostGangCombo_'))
        .forEach(destroy);
    perGangs.forEach((g, i) => {
        const gExp  = gangMonthExp[g] || {};
        const gMt   = gangMonthMt[g] || {};
        const mtArr2   = IH_MONTHS.map(m => (gMt[m] || 0) > 0 ? gMt[m] : null);
        const cpmtArr2 = IH_MONTHS.map(m => (gMt[m] || 0) > 0 ? +(((gExp[m] || 0)) / gMt[m]).toFixed(2) : null);
        window._ihCostCharts['ihCostGangCombo_' + i] = new Chart(document.getElementById('ihCostGangCombo_' + i).getContext('2d'), {
            data: {
                labels: IH_MONTHS,
                datasets: [
                    { type: 'bar', label: 'Expenses (RM)', data: IH_MONTHS.map(m => gExp[m] || 0), backgroundColor: 'rgba(127,119,221,0.75)', borderRadius: 4, yAxisID: 'y' },
                    { type: 'line', label: 'FFB (MT)', data: mtArr2, borderColor: '#10b981', backgroundColor: 'transparent', borderWidth: 2.5, tension: 0.3, pointRadius: 3, yAxisID: 'y1' },
                    { type: 'line', label: 'Cost / MT (RM)', data: cpmtArr2, borderColor: '#f59e0b', backgroundColor: 'transparent', borderWidth: 2, borderDash: [6, 4], tension: 0.3, pointRadius: 2, yAxisID: 'y2' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top', labels: { boxWidth: 18, font: { size: 10 } } },
                    tooltip: { callbacks: { label: (c) => {
                        if (c.dataset.yAxisID === 'y') return ' Expenses: ' + fmtRM(c.parsed.y);
                        if (c.dataset.yAxisID === 'y1') return ' FFB: ' + c.parsed.y.toFixed(2) + ' MT';
                        return ' Cost/MT: ' + fmtRM(c.parsed.y);
                    } } }
                },
                scales: {
                    y:  { position: 'left', beginAtZero: true, ticks: { font: { size: 10 } } },
                    y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { font: { size: 10 } } },
                    y2: { display: false, beginAtZero: true }
                }
            }
        });
    });
};

const renderIronHorseCostPerHa = () => {
    const wrapper = document.getElementById('ironhorse-costperha-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';
    wrapper.appendChild(ihRenderTabs('cost'));

    if (!window.state.ironHorse) window.state.ironHorse = {};

    const availYears = Object.keys(window.state.ironHorse.assets || {})
        .filter(k => /^\d{4}$/.test(k)).sort();
    const yearStr = window.state.ihCostPerHaYear
        || availYears[availYears.length - 1]
        || String(new Date().getFullYear());

    // ── Toolbar ──────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex; align-items:center; gap:1rem; margin-bottom:1.5rem; flex-wrap:wrap;';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:1.1rem; font-weight:700; color:var(--text-primary); text-transform:uppercase; flex:1;';
    titleEl.textContent = `Iron Horse — Expenses by Cost per FFB MT`;
    toolbar.appendChild(titleEl);

    if (availYears.length > 0) {
        toolbar.appendChild(ihMakeSelector(
            'Year:',
            availYears.map(y => ({ value: y, label: y })),
            yearStr,
            v => { window.state.ihCostPerHaYear = v; renderIronHorseCostPerHa(); }
        ));
    }
    wrapper.appendChild(toolbar);

    // ── Data preparation (shared with the Reports Excel download) ─────────
    const {
        gangHaMap, noHaData, gangOrder, gangToAssets, assetMonthExp,
        gangMonthExp, grandMonthExp, grandYearExp, totalHa,
        gangMonthMt, grandMonthMt, grandYearMt, gangYearMt, noMtData
    } = ihComputeCostPerFFBMtData(yearStr);

    // Formatters
    const fmtRm = v => v !== 0
        ? v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '—';
    const fmtHa = h => h > 0 ? h.toFixed(2) : '—';
    const fmtMt = v => v > 0 ? v.toFixed(2) : '—';
    const fmtCpmt = (cost, mt) => {
        if (!mt || mt <= 0) return '—';
        return (cost / mt).toFixed(2);
    };

    // The Excel download for this report now lives under Reports
    // (window.downloadIronHorseCostPerFFBMt, defined above).

    // ── Charts above the detail tables ────────────────────────────────
    ihRenderCostCharts(wrapper, {
        grandMonthExp, grandYearExp, grandMonthMt, grandYearMt,
        gangMonthExp, gangMonthMt, gangYearMt, gangOrder, noMtData
    }, yearStr);

    // Shared CSS
    const hS    = 'background:#1e293b;color:#f8fafc;padding:7px 10px;border:1px solid #334155;font-weight:600;font-size:0.75rem;text-transform:uppercase;text-align:right;white-space:nowrap;';
    const hLS   = hS + 'text-align:left;min-width:155px;';
    const hTotS = hS + 'background:#14532d;color:#dcfce7;min-width:95px;';
    const gS    = 'background:#14532d;color:#e2e8f0;padding:7px 10px;border:1px solid #1e293b;font-weight:700;font-size:0.78rem;text-align:right;';
    const gLS   = gS + 'text-align:left;padding-left:10px;';
    const gTotS = gS + 'background:#14532d;color:#dcfce7;';
    const aS    = 'border:1px solid var(--border-color);padding:6px 10px;font-size:0.78rem;text-align:right;';
    const aLS   = aS + 'text-align:left;padding-left:26px;color:var(--accent);font-weight:600;';
    const aTotS = aS + 'background:#f0fdf4;font-weight:700;color:#166534;';
    const grS   = 'border:1px solid #334155;padding:7px 10px;font-weight:700;text-align:right;';
    const grLS  = grS + 'text-align:left;';
    const grTotS = grS + 'background:#14532d;color:#4ade80;';

    // ── Generic table builder ─────────────────────────────────────────
    // colHeader: string for the secondary column ("Ha")
    // gangColVal(gangName): value shown in secondary column for gang rows
    // grandColVal(): value shown in secondary column for grand total row
    // warn: optional warning string shown below title
    // gangLabelSuffix(gangName): optional extra HTML appended inside the gang name cell
    // gangSubRow(gangName): optional fn returning {label, colVal, getMonthVal(m), yearVal} for a sub-row after the gang header
    // gangExtraCell.monthVal(cost, gangName, m), gangExtraCell.yearVal(cost, gangName)
    // assetExtraCell.monthVal(cost, gangName, m), assetExtraCell.yearVal(cost, gangName)
    // grandExtraCell.monthVal(cost, m), grandExtraCell.yearVal(cost)
    const buildTable = (title, colHeader, gangColVal, grandColVal, warn, gangLabelSuffix, gangSubRow, gangExtraCell, assetExtraCell, grandExtraCell, grandRows) => {
        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom:2.5rem;';

        const secTitle = document.createElement('div');
        secTitle.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:1rem;font-size:0.95rem;font-weight:700;color:var(--text-primary);margin-bottom:0.75rem;padding-bottom:0.5rem;border-bottom:2px solid var(--accent);';
        const titleSpan = document.createElement('span');
        titleSpan.textContent = title;
        secTitle.appendChild(titleSpan);
        // Expand/Collapse-all controls for the asset rows (populated below if any)
        const ctrlWrap = document.createElement('div');
        ctrlWrap.style.cssText = 'display:flex;gap:0.4rem;';
        secTitle.appendChild(ctrlWrap);
        section.appendChild(secTitle);

        // Per-gang collapse controllers, wired after the rows are built
        const assetGroups = [];

        if (warn) {
            const warnEl = document.createElement('div');
            warnEl.style.cssText = 'padding:1rem;background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;font-size:0.85rem;color:#92400e;margin-bottom:0.75rem;';
            warnEl.textContent = warn;
            section.appendChild(warnEl);
        }

        const scrollWrap = document.createElement('div');
        scrollWrap.style.cssText = 'overflow-x:auto;background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;';

        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.78rem;';

        const monthHdrs = IH_MONTHS.map(m => `<th style="${hS}">${m}</th>`).join('');
        table.innerHTML = `<thead><tr>
            <th style="${hLS}">Gang / Asset</th>
            <th style="${hS}min-width:75px;">${colHeader}</th>
            ${monthHdrs}
            <th style="${hTotS}">Total</th>
        </tr></thead>`;

        const tbody = document.createElement('tbody');

        gangOrder.forEach(gangName => {
            const label    = gangName === '__UNASSIGNED__' ? '— Unassigned —' : gangName;
            const suffix   = gangLabelSuffix ? gangLabelSuffix(gangName) : '';
            const monthTds = IH_MONTHS.map(m =>
                `<td style="${gS}">${gangExtraCell.monthVal(gangMonthExp[gangName][m], gangName, m)}</td>`
            ).join('');
            const assetNos = gangToAssets[gangName] || [];
            const hasAssets = assetNos.length > 0;
            const caret = hasAssets
                ? `<span class="ih-caret" style="display:inline-block;width:0.9em;margin-right:0.35rem;transition:transform 0.15s;">▾</span>`
                : '';
            const trGang = document.createElement('tr');
            if (hasAssets) trGang.style.cursor = 'pointer';
            trGang.innerHTML = `
                <td style="${gLS}">${caret}${ihEsc(label)}${suffix}</td>
                <td style="${gS}">${gangColVal(gangName)}</td>
                ${monthTds}
                <td style="${gTotS}">${gangExtraCell.yearVal(gangMonthExp[gangName]['YEAR'], gangName)}</td>`;
            tbody.appendChild(trGang);

            // Asset rows sit directly under the gang/total header, above the
            // FFB MT / Total Expenses summary sub-rows.
            const assetRows = [];
            assetNos.forEach((assetNo, ai) => {
                const monthAssetTds = IH_MONTHS.map(m =>
                    `<td style="${aS}">${assetExtraCell.monthVal(assetMonthExp[assetNo][m], gangName, m)}</td>`
                ).join('');
                const tr = document.createElement('tr');
                tr.style.background = ai % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-main)';
                tr.innerHTML = `
                    <td style="${aLS}">↳ ${ihEsc(assetNo)}</td>
                    <td style="${aS}">—</td>
                    ${monthAssetTds}
                    <td style="${aTotS}">${assetExtraCell.yearVal(assetMonthExp[assetNo]['YEAR'], gangName)}</td>`;
                tbody.appendChild(tr);
                assetRows.push(tr);
            });

            // Collapse toggle: click the gang header to hide/show its assets
            if (hasAssets) {
                const caretEl = trGang.querySelector('.ih-caret');
                let collapsed = true; // assets hidden by default
                const apply = () => {
                    assetRows.forEach(r => { r.style.display = collapsed ? 'none' : ''; });
                    if (caretEl) caretEl.style.transform = collapsed ? 'rotate(-90deg)' : '';
                };
                apply(); // start collapsed
                trGang.onclick = () => { collapsed = !collapsed; apply(); };
                assetGroups.push({ set: c => { collapsed = c; apply(); } });
            }

            // Optional sub-row(s) — gangSubRow may return a single object or an array
            if (gangSubRow) {
                const subResult = gangSubRow(gangName);
                const subs = subResult ? (Array.isArray(subResult) ? subResult : [subResult]) : [];
                subs.forEach(sub => {
                    const color   = sub.color || '#7dd3fc';
                    const totColor= sub.color || '#38bdf8';
                    const subS  = `background:#162032;color:${color};padding:5px 10px;border:1px solid #1e3a52;font-size:0.72rem;font-style:italic;text-align:right;`;
                    const subLS = subS + 'text-align:left;padding-left:22px;font-weight:600;min-width:155px;';
                    const subTotS = `background:#0f2d45;color:${totColor};font-weight:700;padding:5px 10px;border:1px solid #1e3a52;font-size:0.72rem;font-style:italic;text-align:right;`;
                    const subMonthTds = IH_MONTHS.map(m =>
                        `<td style="${subS}">${sub.getMonthVal(m)}</td>`
                    ).join('');
                    const trSub = document.createElement('tr');
                    trSub.innerHTML = `
                        <td style="${subLS}">${sub.label}</td>
                        <td style="${subS}">${sub.colVal}</td>
                        ${subMonthTds}
                        <td style="${subTotS}">${sub.yearVal}</td>`;
                    tbody.appendChild(trSub);
                });
            }
        });

        // Populate Expand/Collapse-all controls (only when there are assets)
        if (assetGroups.length) {
            const ctrlBtnStyle = 'padding:0.25rem 0.6rem;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;font-size:0.72rem;font-weight:600;color:var(--text-primary);';
            const expandBtn = document.createElement('button');
            expandBtn.type = 'button';
            expandBtn.style.cssText = ctrlBtnStyle;
            expandBtn.innerHTML = '＋ Expand all';
            expandBtn.onclick = () => assetGroups.forEach(g => g.set(false));
            const collapseBtn = document.createElement('button');
            collapseBtn.type = 'button';
            collapseBtn.style.cssText = ctrlBtnStyle;
            collapseBtn.innerHTML = '－ Collapse all';
            collapseBtn.onclick = () => assetGroups.forEach(g => g.set(true));
            ctrlWrap.appendChild(expandBtn);
            ctrlWrap.appendChild(collapseBtn);
        }

        // Grand total row(s)
        if (grandRows && grandRows.length) {
            grandRows.forEach(gr => {
                const isPrimary = !!gr.primary;
                const c = gr.color;
                const rowS   = isPrimary ? grS   : `background:#162032;color:${c || '#7dd3fc'};padding:5px 10px;border:1px solid #1e3a52;font-size:0.72rem;text-align:right;`;
                const rowLS  = isPrimary ? grLS  : rowS + 'text-align:left;';
                const rowTotS= isPrimary ? grTotS: `background:#0f2d45;color:${c || '#38bdf8'};font-weight:700;padding:5px 10px;border:1px solid #1e3a52;font-size:0.72rem;text-align:right;`;
                const monthTds = IH_MONTHS.map(m =>
                    `<td style="${rowS}">${gr.monthVal(m)}</td>`
                ).join('');
                const tr = document.createElement('tr');
                if (isPrimary) tr.style.cssText = 'background:#14532d;color:#f8fafc;';
                tr.innerHTML = `
                    <td style="${rowLS}">${gr.label}</td>
                    <td style="${rowS}">${gr.colVal}</td>
                    ${monthTds}
                    <td style="${rowTotS}">${gr.yearVal}</td>`;
                tbody.appendChild(tr);
            });
        } else {
            const monthGrandTds = IH_MONTHS.map(m =>
                `<td style="${grS}color:#86efac;">${grandExtraCell.monthVal(grandMonthExp[m], m)}</td>`
            ).join('');
            const trGrand = document.createElement('tr');
            trGrand.style.cssText = 'background:#1e293b;color:#f8fafc;';
            trGrand.innerHTML = `
                <td style="${grLS}">Grand Total</td>
                <td style="${grS}">${grandColVal()}</td>
                ${monthGrandTds}
                <td style="${grTotS}">${grandExtraCell.yearVal(grandYearExp)}</td>`;
            tbody.appendChild(trGrand);
        }

        table.appendChild(tbody);
        scrollWrap.appendChild(table);
        section.appendChild(scrollWrap);
        return section;
    };

    if (gangOrder.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:3rem;text-align:center;color:var(--text-secondary);';
        empty.innerHTML = `<div style="font-size:2.5rem;margin-bottom:1rem;">📊</div>
            <div style="font-size:1rem;font-weight:600;margin-bottom:0.5rem;">No data for ${yearStr}</div>
            <div style="font-size:0.85rem;">Add assets under <strong>Asset Numbers</strong> and record expenses under <strong>Expenses</strong> first.</div>`;
        wrapper.appendChild(empty);
        return;
    }

    // Table 1: Cost / FFB MT — Ha column, FFB MT shown as subtitle in gang name cell
    const mtWarn = noMtData
        ? `⚠ No harvesting performance data found for ${yearStr}. FFB MT values will show as "—". Please ensure performance data is entered for this year.`
        : null;
    const ffbMtSubtitle = gangName => {
        const mt = gangYearMt[gangName] || 0;
        return mt > 0
            ? `<div style="font-size:0.68rem;color:#94a3b8;font-weight:400;margin-top:2px;">FFB: ${mt.toLocaleString('en-MY', {minimumFractionDigits:2,maximumFractionDigits:2})} MT</div>`
            : '';
    };
    const ffbMtSubRow = gangName => [
        {
            label: 'FFB MT of Month',
            colVal: '—',
            getMonthVal: m => fmtMt(gangMonthMt[gangName]?.[m] || 0),
            yearVal: fmtMt(gangYearMt[gangName] || 0)
        },
        {
            label: 'Total Expenses (RM)',
            colVal: '—',
            getMonthVal: m => fmtRm(gangMonthExp[gangName]?.[m] || 0),
            yearVal: fmtRm(gangMonthExp[gangName]?.['YEAR'] || 0),
            color: '#f87171'
        }
    ];
    wrapper.appendChild(buildTable(
        `Cost / FFB MT (RM/MT) — ${yearStr}`,
        'Ha',
        gangName => fmtHa(gangHaMap[gangName] || 0),
        () => fmtHa(totalHa),
        mtWarn,
        ffbMtSubtitle,
        ffbMtSubRow,
        { monthVal: (cost, gangName, m) => fmtCpmt(cost, gangMonthMt[gangName]?.[m]),
          yearVal:  (cost, gangName)     => fmtCpmt(cost, gangYearMt[gangName]) },
        { monthVal: (cost, gangName, m) => fmtCpmt(cost, gangMonthMt[gangName]?.[m]),
          yearVal:  (cost, gangName)     => fmtCpmt(cost, gangYearMt[gangName]) },
        null,
        [
            {
                label:    'Cost / FFB MT of the month',
                colVal:   '—',
                monthVal: m => fmtCpmt(grandMonthExp[m], grandMonthMt[m]),
                yearVal:  fmtCpmt(grandYearExp, grandYearMt),
                primary:  true
            },
            {
                label:    'Grand Total FFB MT of the month',
                colVal:   fmtHa(totalHa),
                monthVal: m => fmtMt(grandMonthMt[m] || 0),
                yearVal:  fmtMt(grandYearMt),
                color:    '#7dd3fc'
            },
            {
                label:    'Grand Total Expenses (RM)',
                colVal:   '—',
                monthVal: m => fmtRm(grandMonthExp[m] || 0),
                yearVal:  fmtRm(grandYearExp),
                color:    '#f87171'
            }
        ]
    ));

    // Table 2: Issued Cost
    wrapper.appendChild(buildTable(
        `Issued Cost (RM) — ${yearStr}`,
        'Ha',
        gangName => fmtHa(gangHaMap[gangName] || 0),
        () => fmtHa(totalHa),
        noHaData ? `⚠ No hectarage data found for ${yearStr}. Ha values will show as "—". Please ensure harvesting block data is imported for this year.` : null,
        null,
        null,
        { monthVal: (cost) => fmtRm(cost), yearVal: (cost) => fmtRm(cost) },
        { monthVal: (cost) => fmtRm(cost), yearVal: (cost) => fmtRm(cost) },
        { monthVal: (cost) => fmtRm(cost), yearVal: (cost) => fmtRm(cost) }
    ));
};
