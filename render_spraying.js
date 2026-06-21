// =====================================================================
// render_spraying.js — GLY + ALLY Spraying Maintenance Report
// Mirrors the "GLY + ALLY 20225 (2)" worksheet structure
// =====================================================================

const renderSprayingReport = () => {
    const wrapper = document.getElementById('spraying-wrapper');
    if (!wrapper) return;

    wrapper.innerHTML = '';

    // Ensure spraying data container exists on state
    if (!window.state.spraying) window.state.spraying = {};

    const yearStr = window.state.sprayingYear || Object.keys(window.state.spraying)[0] || String(new Date().getFullYear());

    if (!window.state.spraying[yearStr]) {
        window.state.spraying[yearStr] = getDefaultSprayingData();
    }

    const data = window.state.spraying[yearStr];
    if (!data.extraChemicals) data.extraChemicals = [];
    const extraChemicals = data.extraChemicals;

    // ── MONTHS ──────────────────────────────────────────────────────
    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    // ── TOP TOOLBAR ─────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1.5rem; flex-wrap:wrap;';

    // Left: Title & Year Selector
    const titleGroup = document.createElement('div');
    titleGroup.style.cssText = 'display:flex; align-items:center; gap:1rem; flex-wrap:wrap;';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:1.1rem; font-weight:700; color:var(--text-primary); text-transform:uppercase;';
    titleEl.textContent = 'Glyphosate & Ally Spraying Maintenance';
    titleGroup.appendChild(titleEl);

    // Year selector
    const yearSelectWrap = document.createElement('div');
    yearSelectWrap.style.cssText = 'display:flex; align-items:center; gap:0.5rem;';
    const yearLabel = document.createElement('span');
    yearLabel.style.cssText = 'font-size:0.85rem; color:var(--text-secondary);';
    yearLabel.textContent = 'Year:';
    const yearSelect = document.createElement('select');
    yearSelect.className = 'edit-input';
    yearSelect.style.cssText = 'padding:0.4rem 0.75rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card); font-size:0.9rem; width:auto;';

    const sprayingYears = Object.keys(window.state.spraying).filter(k => /^\d{4}$/.test(k)).sort();
    sprayingYears.forEach(y => {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        if (y === yearStr) opt.selected = true;
        yearSelect.appendChild(opt);
    });
    yearSelect.onchange = () => {
        window.state.sprayingYear = yearSelect.value;
        renderSprayingReport();
    };
    yearSelectWrap.appendChild(yearLabel);
    yearSelectWrap.appendChild(yearSelect);
    titleGroup.appendChild(yearSelectWrap);

    // Add Year button
    const btnAddYear = document.createElement('button');
    btnAddYear.className = 'btn-secondary';
    btnAddYear.style.cssText = 'padding:0.35rem 0.85rem; font-size:0.85rem;';
    btnAddYear.innerHTML = '➕ Add Year';
    btnAddYear.onclick = () => {
        const newY = prompt('Enter the new Spraying Year (e.g., 2026):', String(parseInt(yearStr) + 1));
        if (!newY || newY.trim() === '') return;
        const ny = newY.trim();
        if (window.state.spraying[ny]) { window.notify(`Year ${ny} already exists.`, 'warn'); return; }
        window.state.spraying[ny] = getBlankSprayingYear();
        window.state.sprayingYear = ny;
        saveSprayingData();
        renderSprayingReport();
    };
    titleGroup.appendChild(btnAddYear);

    toolbar.appendChild(titleGroup);

    // Right: Action Buttons
    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;';

    const btnAddPhase = document.createElement('button');
    btnAddPhase.className = 'btn-secondary';
    btnAddPhase.style.cssText = 'padding:0.4rem 1rem; font-size:0.85rem;';
    btnAddPhase.innerHTML = '➕ Add Phase';
    btnAddPhase.onclick = () => addNewPhase(yearStr);
    btnGroup.appendChild(btnAddPhase);

    const btnClear = document.createElement('button');
    btnClear.className = 'btn-secondary';
    btnClear.style.cssText = 'padding:0.4rem 1rem; font-size:0.85rem; background:#dc2626; border-color:#dc2626; color:#fff;';
    btnClear.innerHTML = '🗑 Clear Year';
    btnClear.onclick = () => {
        if (!confirm(`Clear ALL spraying application data for year ${yearStr}?\n\nThis will erase all Round, Litre/GM and Ha entries for every block, but keep the block structure.\n\nThis cannot be undone.`)) return;
        const yd = window.state.spraying[yearStr];
        if (!yd) return;
        const MONTHS_CLR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        yd.phases.forEach(phase => {
            phase.blocks.forEach(block => {
                MONTHS_CLR.forEach(m => {
                    block.months[m] = { roundGly: '', roundAly: '', litresGly: '', gmAly: '', haGly: '', haAly: '', extras: {} };
                });
            });
        });
        saveSprayingData(false);
        renderSprayingReport();
    };
    btnGroup.appendChild(btnClear);

    const btnSave = document.createElement('button');
    btnSave.className = 'btn-primary';
    btnSave.style.cssText = 'background-color:#10b981; border-color:#10b981; padding:0.4rem 1rem; font-size:0.85rem;';
    btnSave.innerHTML = '💾 Save';
    btnSave.onclick = () => saveSprayingData(false);
    btnGroup.appendChild(btnSave);

    toolbar.appendChild(btnGroup);
    wrapper.appendChild(toolbar);

    // ── COMPANY HEADER ───────────────────────────────────────────────
    const headerDiv = document.createElement('div');
    headerDiv.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:1rem 1.5rem; margin-bottom:1.5rem; text-align:center;';
    headerDiv.innerHTML = `
        <div style="font-weight:700; font-size:1rem; text-transform:uppercase;">GREENACRE PLANTATIONS SDN. BHD. (DEMO)</div>
        <div style="font-size:0.85rem; color:var(--text-secondary);">ESTATE MONTHLY REPORT — LADANG DEMO ESTATE</div>
        <div style="font-weight:600; margin-top:0.25rem; color:var(--accent);">GLYPHOSATE &amp; ALLY SPRAYING SELECT — ${yearStr}</div>
    `;
    wrapper.appendChild(headerDiv);

    // ── TABLE PER PHASE ──────────────────────────────────────────────
    data.phases.forEach((phase, phaseIdx) => {
        renderPhaseTable(wrapper, phase, phaseIdx, yearStr, MONTHS, extraChemicals);
    });

    // ── GRAND TOTAL SUMMARY ──────────────────────────────────────────
    renderGrandTotal(wrapper, data, MONTHS, yearStr, extraChemicals);
};

// ─────────────────────────────────────────────────────────────────────
// Render a single Phase table (e.g. OP2010)
// ─────────────────────────────────────────────────────────────────────
const renderPhaseTable = (wrapper, phase, phaseIdx, yearStr, MONTHS, extraChemicals) => {
    const nExtra = extraChemicals.length;
    const colsPerMonth = 2 + nExtra;

    const section = document.createElement('div');
    section.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; margin-bottom:1.5rem; overflow:hidden;';

    // ── Phase header bar ────────────────────────────────────────────
    const phaseBar = document.createElement('div');
    phaseBar.style.cssText = 'background:var(--bg-main); border-bottom:2px solid var(--border-color); padding:0.6rem 1rem; display:flex; align-items:center; justify-content:space-between;';

    const phaseNameEl = document.createElement('div');
    phaseNameEl.style.cssText = 'font-weight:700; font-size:0.95rem; color:var(--text-primary);';
    phaseNameEl.textContent = phase.phaseName || `Phase ${phaseIdx + 1}`;
    phaseBar.appendChild(phaseNameEl);

    const phaseActions = document.createElement('div');
    phaseActions.style.cssText = 'display:flex; gap:0.5rem; flex-wrap:wrap;';

    const btnAddBlock = document.createElement('button');
    btnAddBlock.className = 'btn-secondary';
    btnAddBlock.style.cssText = 'padding:0.25rem 0.65rem; font-size:0.8rem;';
    btnAddBlock.innerHTML = '➕ Add Block';
    btnAddBlock.onclick = () => addNewBlock(yearStr, phaseIdx);
    phaseActions.appendChild(btnAddBlock);

    // ── Add Chemical button (year-wide) ─────────────────────────────
    const btnAddChem = document.createElement('button');
    btnAddChem.className = 'btn-secondary';
    btnAddChem.style.cssText = 'padding:0.25rem 0.65rem; font-size:0.8rem; background:#1d4ed8; border-color:#1d4ed8; color:#fff;';
    btnAddChem.innerHTML = '⚗ Add Chemical';
    btnAddChem.onclick = () => {
        const name = prompt('Chemical name (e.g., METSULFURON):');
        if (!name || !name.trim()) return;
        const uom = prompt(`Unit of Measure for "${name.trim()}" (e.g., GM, LITRE, KG):`);
        if (!uom || !uom.trim()) return;
        const n = name.trim().toUpperCase();
        const u = uom.trim().toUpperCase();
        const yd = window.state.spraying[yearStr];
        if (!yd.extraChemicals) yd.extraChemicals = [];
        if (yd.extraChemicals.some(c => c.name === n)) { window.notify(`"${n}" already exists for ${yearStr}.`, 'warn'); return; }
        yd.extraChemicals.push({ name: n, uom: u });
        saveSprayingData();
        renderSprayingReport();
    };
    phaseActions.appendChild(btnAddChem);

    // ── Remove Chemical button (year-wide, only if chemicals exist) ─
    if (nExtra > 0) {
        const btnRemChem = document.createElement('button');
        btnRemChem.className = 'btn-secondary';
        btnRemChem.style.cssText = 'padding:0.25rem 0.65rem; font-size:0.8rem; background:#dc2626; border-color:#dc2626; color:#fff;';
        btnRemChem.innerHTML = '✕ Remove Chemical';
        btnRemChem.onclick = () => {
            const list = extraChemicals.map((c, i) => `${i + 1}. ${c.name} (${c.uom})`).join('\n');
            const choice = prompt(`Which chemical to remove from ${yearStr}?\n\n${list}\n\nEnter number:`);
            if (!choice) return;
            const idx = parseInt(choice) - 1;
            if (isNaN(idx) || idx < 0 || idx >= extraChemicals.length) { window.notify('Invalid selection.', 'error'); return; }
            const removed = extraChemicals[idx];
            if (!confirm(`Remove "${removed.name} (${removed.uom})" from year ${yearStr}?\nAll data for this chemical will be deleted.`)) return;
            const yd = window.state.spraying[yearStr];
            yd.extraChemicals.splice(idx, 1);
            const MONTHS_ALL = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
            yd.phases.forEach(ph => ph.blocks.forEach(blk => {
                MONTHS_ALL.forEach(m => { if (blk.months[m]?.extras) delete blk.months[m].extras[removed.name]; });
            }));
            saveSprayingData();
            renderSprayingReport();
        };
        phaseActions.appendChild(btnRemChem);
    }

    phaseBar.appendChild(phaseActions);
    section.appendChild(phaseBar);

    // ── Scrollable table ────────────────────────────────────────────
    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-x:auto;';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; font-size:0.8rem; min-width:1600px;';

    // ── THEAD ────────────────────────────────────────────────────────
    const thead = document.createElement('thead');
    const tr1 = document.createElement('tr');
    const headerStyle = 'background:#1e293b; color:#f8fafc; padding:6px 8px; text-align:center; border:1px solid #334155; font-weight:600; font-size:0.75rem; text-transform:uppercase; white-space:nowrap;';

    [
        { text: 'Block No',    rowspan: 3, style: 'min-width:60px;' },
        { text: 'Year',        rowspan: 3, style: 'min-width:50px;' },
        { text: 'Ha Previous', rowspan: 3, style: 'min-width:70px;' },
        { text: 'Ha Present',  rowspan: 3, style: 'min-width:70px;' },
        { text: 'Particular',  rowspan: 3, style: 'min-width:100px; text-align:left;' },
    ].forEach(h => {
        const th = document.createElement('th');
        th.rowSpan = h.rowspan;
        th.style.cssText = headerStyle + h.style;
        th.textContent = h.text;
        tr1.appendChild(th);
    });

    MONTHS.forEach(m => {
        const th = document.createElement('th');
        th.colSpan = colsPerMonth;
        th.style.cssText = headerStyle;
        th.textContent = m;
        tr1.appendChild(th);
    });

    const thTotal = document.createElement('th');
    thTotal.colSpan = colsPerMonth;
    thTotal.style.cssText = headerStyle + 'background:#166534; color:#dcfce7;';
    thTotal.textContent = 'TOTAL';
    tr1.appendChild(thTotal);
    thead.appendChild(tr1);

    // Row 2: sub-headers
    const tr2 = document.createElement('tr');
    const subHeaderStyle = 'background:#334155; color:#94a3b8; padding:4px 6px; text-align:center; border:1px solid #475569; font-size:0.7rem; font-weight:500;';
    const extraSubStyle   = 'background:#1e3a5f; color:#93c5fd; padding:4px 6px; text-align:center; border:1px solid #2d4f7c; font-size:0.7rem; font-weight:500;';

    const monthSubHeaders = ['GLY\n(LITRE)', 'ALY\n(GM)', ...extraChemicals.map(c => `${c.name}\n(${c.uom})`)];
    MONTHS.forEach(() => {
        monthSubHeaders.forEach((sub, si) => {
            const th = document.createElement('th');
            th.style.cssText = si < 2 ? subHeaderStyle : extraSubStyle;
            th.style.whiteSpace = 'pre-line';
            th.textContent = sub;
            tr2.appendChild(th);
        });
    });
    monthSubHeaders.forEach((sub, si) => {
        const th = document.createElement('th');
        th.style.cssText = si < 2
            ? subHeaderStyle + 'background:#14532d; color:#bbf7d0;'
            : extraSubStyle  + 'background:#1e3a5f; color:#93c5fd;';
        th.style.whiteSpace = 'pre-line';
        th.textContent = sub;
        tr2.appendChild(th);
    });
    thead.appendChild(tr2);
    table.appendChild(thead);

    // ── TBODY ────────────────────────────────────────────────────────
    const tbody = document.createElement('tbody');
    const SUB_ROWS = ['Round', 'No.Litre / GM', 'Ha'];
    const cellStyle = 'border:1px solid var(--border-color); padding:2px 4px; text-align:center; vertical-align:middle;';

    phase.blocks.forEach((block, blockIdx) => {
        if (!block.months) block.months = {};
        MONTHS.forEach(m => {
            if (!block.months[m]) block.months[m] = { roundGly:'', roundAly:'', litresGly:'', gmAly:'', haGly:'', haAly:'', extras:{} };
            if (!block.months[m].extras) block.months[m].extras = {};
        });

        // Per-block totals across all months
        const totalExtras = {};
        extraChemicals.forEach(c => { totalExtras[c.name] = 0; });
        let totalGly = 0, totalAly = 0;

        SUB_ROWS.forEach((subRow, subIdx) => {
            const tr = document.createElement('tr');
            tr.style.background = subIdx === 0 ? '#fff' : subIdx === 1 ? '#f8fafc' : '#f1f5f9';

            if (subIdx === 0) {
                const tdBlock = document.createElement('td');
                tdBlock.rowSpan = 3; tdBlock.style.cssText = cellStyle + 'font-weight:600; min-width:60px;';
                const bi = document.createElement('input'); bi.type='text'; bi.className='edit-input text-center';
                bi.style.cssText='width:100%; min-width:50px; text-align:center;'; bi.value=block.blockNo||'';
                bi.onchange=e=>{block.blockNo=e.target.value;}; tdBlock.appendChild(bi); tr.appendChild(tdBlock);

                const tdYear = document.createElement('td');
                tdYear.rowSpan = 3; tdYear.style.cssText = cellStyle + 'min-width:50px;';
                const yi = document.createElement('input'); yi.type='text'; yi.className='edit-input text-center';
                yi.style.cssText='width:100%; min-width:40px; text-align:center;'; yi.value=block.plantYear||'';
                yi.onchange=e=>{block.plantYear=e.target.value;}; tdYear.appendChild(yi); tr.appendChild(tdYear);

                const tdHaPrev = document.createElement('td');
                tdHaPrev.rowSpan = 3; tdHaPrev.style.cssText = cellStyle + 'min-width:70px;';
                const hpi = document.createElement('input'); hpi.type='number'; hpi.className='edit-input text-right';
                hpi.style.cssText='width:100%; min-width:55px; text-align:right;'; hpi.value=block.haPrevious!=null?block.haPrevious:'';
                hpi.onchange=e=>{block.haPrevious=parseFloat(e.target.value)||0;}; tdHaPrev.appendChild(hpi); tr.appendChild(tdHaPrev);

                const tdHaPres = document.createElement('td');
                tdHaPres.rowSpan = 3; tdHaPres.style.cssText = cellStyle + 'min-width:70px;';
                const hsi = document.createElement('input'); hsi.type='number'; hsi.className='edit-input text-right';
                hsi.style.cssText='width:100%; min-width:55px; text-align:right;'; hsi.value=block.haPresent!=null?block.haPresent:'';
                hsi.onchange=e=>{block.haPresent=parseFloat(e.target.value)||0;}; tdHaPres.appendChild(hsi); tr.appendChild(tdHaPres);
            }

            const tdPart = document.createElement('td');
            tdPart.style.cssText = cellStyle + 'text-align:left; font-size:0.78rem; color:var(--text-secondary); padding-left:8px; white-space:nowrap;';
            tdPart.textContent = subRow;
            tr.appendChild(tdPart);

            MONTHS.forEach(m => {
                const mData = block.months[m];

                if (subRow === 'Round') {
                    const tdG = document.createElement('td'); tdG.style.cssText = cellStyle;
                    tdG.appendChild(createSprayInput('number', mData.roundGly, v=>{mData.roundGly=v;})); tr.appendChild(tdG);
                    const tdA = document.createElement('td'); tdA.style.cssText = cellStyle;
                    tdA.appendChild(createSprayInput('number', mData.roundAly, v=>{mData.roundAly=v;})); tr.appendChild(tdA);
                    extraChemicals.forEach(c => {
                        const tdX = document.createElement('td'); tdX.style.cssText = cellStyle;
                        const curVal = mData.extras[c.name + '_round'] ?? '';
                        tdX.appendChild(createSprayInput('number', curVal, v => {
                            if (!mData.extras) mData.extras = {};
                            mData.extras[c.name + '_round'] = v;
                        }));
                        tr.appendChild(tdX);
                    });

                } else if (subRow === 'No.Litre / GM') {
                    const tdG = document.createElement('td'); tdG.style.cssText = cellStyle + 'background:#fefce8;';
                    tdG.appendChild(createSprayInput('number', mData.litresGly, v=>{mData.litresGly=v;}, true)); tr.appendChild(tdG);
                    totalGly += parseFloat(mData.litresGly) || 0;
                    const tdA = document.createElement('td'); tdA.style.cssText = cellStyle + 'background:#fef9c3;';
                    tdA.appendChild(createSprayInput('number', mData.gmAly, v=>{mData.gmAly=v;}, true)); tr.appendChild(tdA);
                    totalAly += parseFloat(mData.gmAly) || 0;
                    extraChemicals.forEach(c => {
                        const tdX = document.createElement('td'); tdX.style.cssText = cellStyle + 'background:#eff6ff;';
                        const curVal = mData.extras[c.name] ?? '';
                        tdX.appendChild(createSprayInput('number', curVal, v => {
                            if (!mData.extras) mData.extras = {};
                            mData.extras[c.name] = v;
                        }, true));
                        tr.appendChild(tdX);
                        totalExtras[c.name] += parseFloat(curVal) || 0;
                    });

                } else { // Ha
                    const tdG = document.createElement('td'); tdG.style.cssText = cellStyle + 'background:#f0fdf4;';
                    tdG.appendChild(createSprayInput('number', mData.haGly, v=>{mData.haGly=v;})); tr.appendChild(tdG);
                    const tdA = document.createElement('td'); tdA.style.cssText = cellStyle + 'background:#dcfce7;';
                    tdA.appendChild(createSprayInput('number', mData.haAly, v=>{mData.haAly=v;})); tr.appendChild(tdA);
                    extraChemicals.forEach(c => {
                        const tdX = document.createElement('td'); tdX.style.cssText = cellStyle + 'background:#f0f9ff;';
                        const curVal = mData.extras[c.name + '_ha'] ?? '';
                        tdX.appendChild(createSprayInput('number', curVal, v => {
                            if (!mData.extras) mData.extras = {};
                            mData.extras[c.name + '_ha'] = v;
                        }));
                        tr.appendChild(tdX);
                    });
                }
            });

            // TOTAL columns
            if (subRow === 'No.Litre / GM') {
                const tdTG = document.createElement('td');
                tdTG.style.cssText = cellStyle + 'background:#dcfce7; font-weight:700; color:#166534;';
                tdTG.textContent = totalGly > 0 ? totalGly.toLocaleString() : '';
                tr.appendChild(tdTG);
                const tdTA = document.createElement('td');
                tdTA.style.cssText = cellStyle + 'background:#bbf7d0; font-weight:700; color:#14532d;';
                tdTA.textContent = totalAly > 0 ? totalAly.toLocaleString() : '';
                tr.appendChild(tdTA);
                extraChemicals.forEach(c => {
                    const tdTX = document.createElement('td');
                    tdTX.style.cssText = cellStyle + 'background:#dbeafe; font-weight:700; color:#1d4ed8;';
                    tdTX.textContent = totalExtras[c.name] > 0 ? totalExtras[c.name].toLocaleString() : '';
                    tr.appendChild(tdTX);
                });
            } else {
                const tdT1 = document.createElement('td'); tdT1.style.cssText = cellStyle + 'background:#f0fdf4;'; tr.appendChild(tdT1);
                const tdT2 = document.createElement('td'); tdT2.style.cssText = cellStyle + 'background:#dcfce7;'; tr.appendChild(tdT2);
                extraChemicals.forEach(() => { const td=document.createElement('td'); td.style.cssText=cellStyle+'background:#eff6ff;'; tr.appendChild(td); });
            }

            // Delete block button (only on Round row)
            if (subIdx === 0) {
                const tdDel = document.createElement('td');
                tdDel.rowSpan = 3; tdDel.style.cssText = cellStyle + 'width:32px; padding:2px;';
                const btnDel = document.createElement('button');
                btnDel.className = 'btn-icon delete'; btnDel.title = 'Delete Block'; btnDel.innerHTML = '🗑';
                btnDel.onclick = () => {
                    const blocks = window.state.spraying[yearStr].phases[phaseIdx].blocks;
                    const snapshot = blocks[blockIdx];
                    blocks.splice(blockIdx, 1);
                    renderSprayingReport();
                    window.notifyUndo(`Deleted Block ${block.blockNo || blockIdx + 1}.`, () => {
                        const list = window.state.spraying[yearStr].phases[phaseIdx].blocks;
                        list.splice(Math.min(blockIdx, list.length), 0, snapshot);
                        renderSprayingReport();
                    });
                };
                tdDel.appendChild(btnDel); tr.appendChild(tdDel);
            }

            tbody.appendChild(tr);
        });

        // Spacer row between blocks
        if (blockIdx < phase.blocks.length - 1) {
            const spacer = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 6 + MONTHS.length * colsPerMonth + colsPerMonth + 1;
            td.style.cssText = 'height:4px; background:var(--bg-main); border:none;';
            spacer.appendChild(td);
            tbody.appendChild(spacer);
        }
    });

    // ── PHASE TOTALS ROW ─────────────────────────────────────────────
    const trTot = document.createElement('tr');
    trTot.style.cssText = 'background:#1e293b; color:#f8fafc;';

    const tdTotFixed = document.createElement('td');
    tdTotFixed.colSpan = 6;
    tdTotFixed.style.cssText = 'border:1px solid #334155; padding:6px 10px; font-weight:700; text-align:right; font-size:0.8rem; letter-spacing:0.05em;';
    tdTotFixed.textContent = `SUBTOTAL — ${phase.phaseName}`;
    trTot.appendChild(tdTotFixed);

    let grandGly = 0, grandAly = 0;
    const grandExtras = {};
    extraChemicals.forEach(c => { grandExtras[c.name] = 0; });

    MONTHS.forEach(m => {
        let mGly = 0, mAly = 0;
        const mExtras = {};
        extraChemicals.forEach(c => { mExtras[c.name] = 0; });
        phase.blocks.forEach(b => {
            mGly += parseFloat(b.months?.[m]?.litresGly) || 0;
            mAly += parseFloat(b.months?.[m]?.gmAly) || 0;
            extraChemicals.forEach(c => { mExtras[c.name] += parseFloat(b.months?.[m]?.extras?.[c.name]) || 0; });
        });
        grandGly += mGly; grandAly += mAly;
        extraChemicals.forEach(c => { grandExtras[c.name] += mExtras[c.name]; });

        const tdG = document.createElement('td');
        tdG.style.cssText = 'border:1px solid #334155; padding:5px 6px; text-align:center; font-weight:600; font-size:0.78rem; color:#86efac;';
        tdG.textContent = mGly > 0 ? mGly.toLocaleString() : '—';
        trTot.appendChild(tdG);
        const tdA = document.createElement('td');
        tdA.style.cssText = 'border:1px solid #334155; padding:5px 6px; text-align:center; font-weight:600; font-size:0.78rem; color:#6ee7b7;';
        tdA.textContent = mAly > 0 ? mAly.toLocaleString() : '—';
        trTot.appendChild(tdA);
        extraChemicals.forEach(c => {
            const tdX = document.createElement('td');
            tdX.style.cssText = 'border:1px solid #334155; padding:5px 6px; text-align:center; font-weight:600; font-size:0.78rem; color:#93c5fd;';
            tdX.textContent = mExtras[c.name] > 0 ? mExtras[c.name].toLocaleString() : '—';
            trTot.appendChild(tdX);
        });
    });

    const tdGGly = document.createElement('td');
    tdGGly.style.cssText = 'border:1px solid #334155; padding:5px 8px; text-align:center; font-weight:700; font-size:0.8rem; color:#4ade80; background:#14532d;';
    tdGGly.textContent = grandGly > 0 ? grandGly.toLocaleString() : '—';
    trTot.appendChild(tdGGly);
    const tdGAly = document.createElement('td');
    tdGAly.style.cssText = 'border:1px solid #334155; padding:5px 8px; text-align:center; font-weight:700; font-size:0.8rem; color:#34d399; background:#064e3b;';
    tdGAly.textContent = grandAly > 0 ? grandAly.toLocaleString() : '—';
    trTot.appendChild(tdGAly);
    extraChemicals.forEach(c => {
        const tdX = document.createElement('td');
        tdX.style.cssText = 'border:1px solid #334155; padding:5px 8px; text-align:center; font-weight:700; font-size:0.8rem; color:#60a5fa; background:#1e3a5f;';
        tdX.textContent = grandExtras[c.name] > 0 ? grandExtras[c.name].toLocaleString() : '—';
        trTot.appendChild(tdX);
    });

    const tdDelPlaceholder = document.createElement('td');
    tdDelPlaceholder.style.cssText = 'border:1px solid #334155;';
    trTot.appendChild(tdDelPlaceholder);

    tbody.appendChild(trTot);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    section.appendChild(tableWrap);
    wrapper.appendChild(section);
};

// ─────────────────────────────────────────────────────────────────────
// Grand Total Summary across all phases
// ─────────────────────────────────────────────────────────────────────
const renderGrandTotal = (wrapper, data, MONTHS, yearStr, extraChemicals) => {
    if (!data.phases || data.phases.length === 0) return;

    const div = document.createElement('div');
    div.style.cssText = 'background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; overflow:hidden; margin-bottom:1.5rem;';

    const bar = document.createElement('div');
    bar.style.cssText = 'background:#1e293b; color:#f8fafc; padding:0.6rem 1rem; font-weight:700; font-size:0.9rem; text-transform:uppercase; letter-spacing:0.05em;';
    bar.textContent = `GRAND TOTAL — ${yearStr}`;
    div.appendChild(bar);

    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-x:auto;';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; font-size:0.82rem; min-width:1200px;';

    // Build header
    const colsPerMonth = 2 + extraChemicals.length;
    let headerHtml = `<thead><tr>
        <th style="background:#334155;color:#94a3b8;padding:6px 10px;border:1px solid #475569;text-align:left;min-width:150px;">Phase</th>`;
    MONTHS.forEach(m => {
        headerHtml += `<th colspan="${colsPerMonth}" style="background:#334155;color:#94a3b8;padding:6px;border:1px solid #475569;text-align:center;">${m}</th>`;
    });
    headerHtml += `<th colspan="${colsPerMonth}" style="background:#14532d;color:#bbf7d0;padding:6px;border:1px solid #1a6b3c;text-align:center;">TOTAL</th></tr>`;

    headerHtml += `<tr><th style="background:#1e293b;color:#64748b;padding:4px 10px;border:1px solid #334155;font-size:0.7rem;"></th>`;
    MONTHS.forEach(() => {
        headerHtml += `<th style="background:#1e293b;color:#64748b;padding:4px;border:1px solid #334155;font-size:0.7rem;text-align:center;">GLY</th>`;
        headerHtml += `<th style="background:#1e293b;color:#64748b;padding:4px;border:1px solid #334155;font-size:0.7rem;text-align:center;">ALY</th>`;
        extraChemicals.forEach(c => {
            headerHtml += `<th style="background:#1e3a5f;color:#93c5fd;padding:4px;border:1px solid #2d4f7c;font-size:0.7rem;text-align:center;">${c.name}</th>`;
        });
    });
    headerHtml += `<th style="background:#0f3820;color:#6ee7b7;padding:4px;border:1px solid #14532d;font-size:0.7rem;text-align:center;">GLY</th>`;
    headerHtml += `<th style="background:#0f3820;color:#34d399;padding:4px;border:1px solid #14532d;font-size:0.7rem;text-align:center;">ALY</th>`;
    extraChemicals.forEach(c => {
        headerHtml += `<th style="background:#1e3a5f;color:#93c5fd;padding:4px;border:1px solid #2d4f7c;font-size:0.7rem;text-align:center;">${c.name}</th>`;
    });
    headerHtml += `</tr></thead>`;
    table.innerHTML = headerHtml;

    const tbody = document.createElement('tbody');

    let grandTotalGly = 0, grandTotalAly = 0;
    const grandTotalExtras = {};
    extraChemicals.forEach(c => { grandTotalExtras[c.name] = 0; });
    const grandByMonth = {};
    MONTHS.forEach(m => {
        grandByMonth[m] = { gly: 0, aly: 0, extras: {} };
        extraChemicals.forEach(c => { grandByMonth[m].extras[c.name] = 0; });
    });

    data.phases.forEach(phase => {
        const tr = document.createElement('tr');
        let phaseGly = 0, phaseAly = 0;
        const phaseExtras = {};
        extraChemicals.forEach(c => { phaseExtras[c.name] = 0; });

        let rowHtml = `<td style="border:1px solid var(--border-color);padding:5px 10px;font-weight:600;color:var(--accent);">${phase.phaseName}</td>`;

        MONTHS.forEach(m => {
            let mGly = 0, mAly = 0;
            const mExtras = {};
            extraChemicals.forEach(c => { mExtras[c.name] = 0; });
            phase.blocks.forEach(b => {
                mGly += parseFloat(b.months?.[m]?.litresGly) || 0;
                mAly += parseFloat(b.months?.[m]?.gmAly) || 0;
                extraChemicals.forEach(c => { mExtras[c.name] += parseFloat(b.months?.[m]?.extras?.[c.name]) || 0; });
            });
            phaseGly += mGly; phaseAly += mAly;
            grandByMonth[m].gly += mGly; grandByMonth[m].aly += mAly;
            extraChemicals.forEach(c => { phaseExtras[c.name] += mExtras[c.name]; grandByMonth[m].extras[c.name] += mExtras[c.name]; });

            rowHtml += `<td style="border:1px solid var(--border-color);padding:5px 6px;text-align:center;background:#fefce8;color:#854d0e;">${mGly > 0 ? mGly.toLocaleString() : '—'}</td>`;
            rowHtml += `<td style="border:1px solid var(--border-color);padding:5px 6px;text-align:center;background:#fef9c3;color:#713f12;">${mAly > 0 ? mAly.toLocaleString() : '—'}</td>`;
            extraChemicals.forEach(c => {
                rowHtml += `<td style="border:1px solid var(--border-color);padding:5px 6px;text-align:center;background:#eff6ff;color:#1d4ed8;">${mExtras[c.name] > 0 ? mExtras[c.name].toLocaleString() : '—'}</td>`;
            });
        });

        grandTotalGly += phaseGly; grandTotalAly += phaseAly;
        extraChemicals.forEach(c => { grandTotalExtras[c.name] += phaseExtras[c.name]; });

        rowHtml += `<td style="border:1px solid var(--border-color);padding:5px 8px;text-align:center;background:#dcfce7;font-weight:700;color:#166534;">${phaseGly > 0 ? phaseGly.toLocaleString() : '—'}</td>`;
        rowHtml += `<td style="border:1px solid var(--border-color);padding:5px 8px;text-align:center;background:#bbf7d0;font-weight:700;color:#14532d;">${phaseAly > 0 ? phaseAly.toLocaleString() : '—'}</td>`;
        extraChemicals.forEach(c => {
            rowHtml += `<td style="border:1px solid var(--border-color);padding:5px 8px;text-align:center;background:#dbeafe;font-weight:700;color:#1d4ed8;">${phaseExtras[c.name] > 0 ? phaseExtras[c.name].toLocaleString() : '—'}</td>`;
        });

        tr.innerHTML = rowHtml;
        tbody.appendChild(tr);
    });

    // Grand total row
    const trGrand = document.createElement('tr');
    let grandRowHtml = `<td style="border:1px solid #334155;padding:7px 10px;background:#1e293b;color:#f8fafc;font-weight:700;">GRAND TOTAL</td>`;
    MONTHS.forEach(m => {
        grandRowHtml += `<td style="border:1px solid #334155;padding:6px;text-align:center;background:#292524;color:#fde68a;font-weight:700;">${grandByMonth[m].gly > 0 ? grandByMonth[m].gly.toLocaleString() : '—'}</td>`;
        grandRowHtml += `<td style="border:1px solid #334155;padding:6px;text-align:center;background:#1c1917;color:#fcd34d;font-weight:700;">${grandByMonth[m].aly > 0 ? grandByMonth[m].aly.toLocaleString() : '—'}</td>`;
        extraChemicals.forEach(c => {
            grandRowHtml += `<td style="border:1px solid #334155;padding:6px;text-align:center;background:#1e3a5f;color:#93c5fd;font-weight:700;">${grandByMonth[m].extras[c.name] > 0 ? grandByMonth[m].extras[c.name].toLocaleString() : '—'}</td>`;
        });
    });
    grandRowHtml += `<td style="border:1px solid #0f3820;padding:6px 10px;text-align:center;background:#0f3820;color:#4ade80;font-weight:700;font-size:0.9rem;">${grandTotalGly > 0 ? grandTotalGly.toLocaleString() : '—'}</td>`;
    grandRowHtml += `<td style="border:1px solid #0f3820;padding:6px 10px;text-align:center;background:#052e16;color:#34d399;font-weight:700;font-size:0.9rem;">${grandTotalAly > 0 ? grandTotalAly.toLocaleString() : '—'}</td>`;
    extraChemicals.forEach(c => {
        grandRowHtml += `<td style="border:1px solid #1e3a5f;padding:6px 10px;text-align:center;background:#1e3a5f;color:#60a5fa;font-weight:700;font-size:0.9rem;">${grandTotalExtras[c.name] > 0 ? grandTotalExtras[c.name].toLocaleString() : '—'}</td>`;
    });
    trGrand.innerHTML = grandRowHtml;
    tbody.appendChild(trGrand);

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    div.appendChild(tableWrap);
    wrapper.appendChild(div);

    if (typeof window._applyReadOnly === 'function') window._applyReadOnly(wrapper, 'maintenance');
};

// ─────────────────────────────────────────────────────────────────────
// Helper: Create a small editable input cell
// ─────────────────────────────────────────────────────────────────────
const createSprayInput = (type, value, onChange, highlight = false) => {
    const inp = document.createElement('input');
    inp.type = type;
    inp.className = 'edit-input text-center';
    inp.style.cssText = `width:100%; min-width:40px; text-align:center; font-size:0.78rem; padding:2px 3px; ${highlight ? 'font-weight:600;' : ''}`;
    inp.value = value != null && value !== '' ? value : '';
    inp.placeholder = '';
    inp.onchange = e => onChange(type === 'number' ? (e.target.value === '' ? '' : parseFloat(e.target.value) || 0) : e.target.value);
    return inp;
};

// ─────────────────────────────────────────────────────────────────────
// Default data structure — matches the Excel blocks
// ─────────────────────────────────────────────────────────────────────
const getDefaultSprayingData = () => {
    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    const emptyMonth = () => ({ roundGly: '', roundAly: '', litresGly: '', gmAly: '', haGly: '', haAly: '' });

    // md: helper to create a month data entry (GLY and ALLY share the same round and Ha)
    const md = (round, litresGly, gmAly, ha) => ({
        roundGly: round, roundAly: round,
        litresGly, gmAly, haGly: ha, haAly: ha
    });

    const makeBlock = (blockNo, plantYear, haPrevious, haPresent, monthData = {}) => ({
        blockNo: String(blockNo),
        plantYear: String(plantYear),
        haPrevious,
        haPresent,
        months: Object.fromEntries(MONTHS.map(m => [m, monthData[m] ? { ...emptyMonth(), ...monthData[m] } : emptyMonth()]))
    });

    return {
        phases: [
            {
                phaseName: 'OP2010',
                blocks: [
                    makeBlock(1,  2010, 53.2,  53.09, { FEB: md(1,40,2000,53.2),  MAY: md(2,40,2000,53.2),  AUG: md(3,40,2000,53.2)  }),
                    makeBlock(2,  2010, 60.4,  60.27, { APR: md(1,80,4000,60.4),  JUL: md(2,80,4000,60.4),  OCT: md(3,80,4000,60.27) }),
                    makeBlock(3,  2010, 69.2,  69.04, { MAR: md(1,60,3000,69.2),  JUN: md(2,60,3000,69.2),  SEP: md(3,60,3000,69.2)  }),
                    makeBlock(4,  2010, 70.6,  70.51, { MAR: md(1,60,3000,70.6),  JUN: md(2,60,3000,70.6),  SEP: md(3,60,3000,70.6)  }),
                    makeBlock(5,  2010, 50.4,  50.4,  { FEB: md(1,40,2000,50.4),  JUN: md(2,40,2000,50.4),  AUG: md(3,40,2000,50.4)  }),
                    makeBlock(6,  2010, 58.6,  58.6,  { MAY: md(1,40,2000,58.6),  JUL: md(2,60,3000,58.6),  OCT: md(3,40,2000,58.6)  }),
                    makeBlock(7,  2010, 23.6,  23.6,  { FEB: md(1,20,1000,23.6),  MAY: md(2,20,1000,23.6),  AUG: md(3,20,1000,23.6)  }),
                    makeBlock(8,  2010, 61.6,  61.6,  { APR: md(1,40,2000,61.6),  JUL: md(2,40,2000,61.6),  OCT: md(3,40,2000,61.6)  }),
                    makeBlock(9,  2010, 38.3,  38.3,  { APR: md(1,40,2000,38.3),  JUL: md(2,40,2000,38.3),  OCT: md(3,40,2000,38.3)  }),
                    makeBlock(11, 2010, 44.5,  44.5,  { APR: md(1,40,2000,44.5),  JUL: md(2,40,2000,44.5),  OCT: md(3,40,2000,44.5)  }),
                    makeBlock(12, 2010, 71.0,  71.0,  { FEB: md(1,60,3000,71),    JUN: md(2,60,3000,71),    AUG: md(3,60,3000,71)    }),
                    makeBlock(23, 2010, 14.6,  14.6,  { FEB: md(1,20,1000,14.6),  JUN: md(2,20,1000,14.6),  AUG: md(3,20,1000,14.6)  }),
                ]
            },
            {
                phaseName: 'OP2011',
                blocks: [
                    makeBlock(10, 2011, 19.1,  19.1,  { MAY: md(1,20,1000,19.1),  JUL: md(2,20,1000,19.1),  OCT: md(3,20,1000,19.1)  }),
                    makeBlock(13, 2011, 60.8,  60.8,  { FEB: md(1,40,2000,60.8),  MAY: md(2,40,2000,60.8),  AUG: md(3,40,2000,60.8)  }),
                    makeBlock(14, 2011, 41.6,  41.6,  { APR: md(1,40,2000,41.6),  JUL: md(2,40,2000,41.6),  OCT: md(3,40,2000,41.6)  }),
                    makeBlock(15, 2011, 49.3,  49.17, { APR: md(1,60,3000,49.3),  JUL: md(2,80,4000,49.3),  OCT: md(3,60,3000,49.17) }),
                    makeBlock(16, 2011, 53.2,  52.61, { MAR: md(1,40,2000,53.2),  JUN: md(2,40,2000,53.2),  SEP: md(3,40,2000,53.2)  }),
                    makeBlock(17, 2011, 45.7,  45.58, { FEB: md(1,40,2000,45.7),  MAY: md(2,40,2000,45.7),  AUG: md(3,40,2000,45.7)  }),
                    makeBlock(18, 2011, 40.8,  40.8,  { MAR: md(1,40,2000,40.8),  JUN: md(2,40,2000,40.8),  SEP: md(3,40,2000,40.8)  }),
                ]
            },
            {
                phaseName: 'OP2012',
                blocks: [
                    makeBlock(19, 2012, 50.6,  50.6,  { FEB: md(1,60,3000,50.6),  JUN: md(2,60,3000,50.6),  AUG: md(3,60,3000,50.6)  }),
                    makeBlock(20, 2012, 62.1,  61.98, { FEB: md(1,40,2000,62.1),  MAY: md(2,40,2000,62.1),  AUG: md(3,40,2000,62.1)  }),
                    makeBlock(21, 2012, 72.2,  71.59, { MAR: md(1,80,4000,72.2),  JUN: md(2,80,4000,72.2),  SEP: md(3,80,4000,72.2)  }),
                    makeBlock(22, 2012, 52.3,  52.08, { MAR: md(1,40,2000,52.3),  JUN: md(2,40,2000,52.3),  SEP: md(3,40,2000,52.3)  }),
                    makeBlock(24, 2012, 44.7,  44.67, { MAY: md(1,40,2000,44.7),  JUL: md(2,40,2000,44.7),  OCT: md(3,40,2000,44.67) }),
                ]
            },
            {
                phaseName: 'OP2015',
                blocks: [
                    makeBlock(25,    2015, 38.22, 38.23, { MAR: md(1,40,2000,38.22), AUG: md(2,40,2000,38.22) }),
                    makeBlock('26A', 2015, 22.72, 22.72, { MAR: md(1,20,1000,22.72), JUN: md(2,20,1000,22.72), SEP: md(3,20,1000,22.72) }),
                    makeBlock('26B', 2015, 0,     0),
                    makeBlock(27,    2015, 18.64, 14.3,  { FEB: md(1,20,1000,18.64), MAY: md(2,20,1000,18.64), AUG: md(3,40,2000,18.64) }),
                    makeBlock(28,    2015, 25.5,  21.94, { APR: md(1,20,1000,25.5),  JUN: md(2,20,1000,25.5),  SEP: md(3,20,1000,25.5)  }),
                    makeBlock(29,    2015, 11.38, 19.26, { MAY: md(1,20,1000,11.38), JUL: md(2,20,1000,11.38), OCT: md(3,20,1000,19.26) }),
                    makeBlock(30,    2015, 24.35, 24.3,  { MAY: md(1,40,2000,24.35), JUL: md(2,40,2000,24.35), OCT: md(3,20,1000,24.3)  }),
                    makeBlock(31,    2015, 34.08, 34.02, { APR: md(1,40,2000,34.08), JUL: md(2,40,2000,34.08), OCT: md(3,40,2000,34.02) }),
                    makeBlock(32,    2015, 0,     0),
                ]
            },
            {
                phaseName: 'OP2016',
                blocks: [
                    makeBlock(33, 2016, 28.72, 28.42, { APR: md(1,20,1000,28.72), JUN: md(2,20,1000,28.72), SEP: md(3,20,1000,28.72) }),
                    makeBlock(39, 2016, 4.5,   4.5,   { APR: md(1,7,333,4.5),     JUN: md(2,7,333,4.5),     SEP: md(3,6,334,4.5)    }),
                ]
            }
        ]
    };
};

// ─────────────────────────────────────────────────────────────────────
// Blank year — same block/phase structure but all months empty
// Used by "Add Year" so new years never inherit the previous-year schedule
// ─────────────────────────────────────────────────────────────────────
const getBlankSprayingYear = () => {
    const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const emptyMonth = () => ({ roundGly:'', roundAly:'', litresGly:'', gmAly:'', haGly:'', haAly:'' });
    const defaults = getDefaultSprayingData();
    return {
        phases: defaults.phases.map(ph => ({
            phaseName: ph.phaseName,
            blocks: ph.blocks.map(b => ({
                blockNo:    b.blockNo,
                plantYear:  b.plantYear,
                haPrevious: b.haPrevious,
                haPresent:  b.haPresent,
                months: Object.fromEntries(MONTHS.map(m => [m, emptyMonth()]))
            }))
        }))
    };
};

// ─────────────────────────────────────────────────────────────────────
// Save / Load spraying data to Firebase (under shared db path)
// ─────────────────────────────────────────────────────────────────────
const saveSprayingData = (silent = true) => {
    if (!window._sprayingDb || !window._sprayingUid) {
        if (!silent) window.notify('Not connected to database. Please login first.', 'warn');
        return;
    }
    const payload = JSON.stringify(window.state.spraying);
    window._sprayingDb.ref('shared/spraying_data').set(payload)
        .then(() => { if (!silent) window.notify('Spraying data saved successfully!', 'success'); })
        .catch(e => { console.error('Spraying save error:', e); if (!silent) window.notify('Error saving: ' + e.message, 'error'); });
};

// ─────────────────────────────────────────────────────────────────────
// Add a new Phase to the year
// ─────────────────────────────────────────────────────────────────────
const addNewPhase = (yearStr) => {
    const name = prompt('Enter Phase name (e.g., OP2016):');
    if (!name || name.trim() === '') return;
    const yd = window.state.spraying[yearStr];
    if (!yd) return;
    yd.phases.push({ phaseName: name.trim(), blocks: [] });
    renderSprayingReport();
};

// ─────────────────────────────────────────────────────────────────────
// Add block to a phase
// ─────────────────────────────────────────────────────────────────────
const addNewBlock = (yearStr, phaseIdx) => {
    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const yd = window.state.spraying[yearStr];
    if (!yd || !yd.phases[phaseIdx]) return;

    const blockNo = prompt('Enter Block No:');
    if (!blockNo || blockNo.trim() === '') return;

    yd.phases[phaseIdx].blocks.push({
        blockNo: blockNo.trim(),
        plantYear: '',
        haPrevious: 0,
        haPresent: 0,
        months: Object.fromEntries(MONTHS.map(m => [m, { roundGly: '', roundAly: '', litresGly: '', gmAly: '', haGly: '', haAly: '', extras: {} }]))
    });

    renderSprayingReport();
};

// ─────────────────────────────────────────────────────────────────────
// ExcelJS lazy loader (local copy for spraying template/import)
// ─────────────────────────────────────────────────────────────────────
async function ensureExcelJSSpraying() {
    if (typeof window.ExcelJS !== 'undefined') return;
    await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
        s.onload = res;
        s.onerror = () => rej(new Error('Failed to load ExcelJS'));
        document.head.appendChild(s);
    });
}

// ─────────────────────────────────────────────────────────────────────
// Download Spraying data entry template
// ─────────────────────────────────────────────────────────────────────
async function downloadSprayingTemplate(yearStr) {
    try {
        await ensureExcelJSSpraying();
        const wb = new window.ExcelJS.Workbook();
        const ws = wb.addWorksheet('Spraying Data');

        const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        const ydForHdr = (window.state.spraying && window.state.spraying[yearStr]) || {};
        const extraChemicals = Array.isArray(ydForHdr.extraChemicals) ? ydForHdr.extraChemicals : [];

        const HEADERS = ['Year','Phase','Block','Ha Previous','Ha Present','Month',
                         'Round GLY','Litres GLY','Ha GLY','Round ALY','GM ALY','Ha ALY'];
        extraChemicals.forEach(c => {
            HEADERS.push(`Round ${c.name}`, `${c.uom || 'LITRE'} ${c.name}`, `Ha ${c.name}`);
        });

        ws.columns = [
            {width:8},{width:12},{width:8},{width:13},{width:13},
            {width:8},{width:12},{width:12},{width:12},{width:10},{width:10},{width:10},
            ...extraChemicals.flatMap(() => [{width:12},{width:12},{width:12}])
        ];

        const hdr = ws.getRow(1);
        hdr.values = HEADERS;
        hdr.eachCell(cell => {
            cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1A3D1E' } };
            cell.font = { bold:true, color:{ argb:'FFFFFFFF' } };
            cell.alignment = { horizontal:'center' };
        });
        hdr.height = 18;

        const yd = window.state.spraying && window.state.spraying[yearStr];
        let rowIdx = 2;
        if (yd && yd.phases) {
            for (const phase of yd.phases) {
                for (const block of phase.blocks) {
                    for (const month of MONTHS) {
                        const md = (block.months && block.months[month]) || {};
                        const ex = md.extras || {};
                        const cleanV = v => (v !== '' && v != null ? v : '');
                        const row = ws.getRow(rowIdx);
                        row.values = [
                            yearStr, phase.phaseName, block.blockNo,
                            block.haPrevious != null ? block.haPrevious : '',
                            block.haPresent  != null ? block.haPresent  : '',
                            month,
                            cleanV(md.roundGly),
                            cleanV(md.litresGly),
                            cleanV(md.haGly),
                            cleanV(md.roundAly),
                            cleanV(md.gmAly),
                            cleanV(md.haAly),
                            ...extraChemicals.flatMap(c => [
                                cleanV(ex[c.name + '_round']),
                                cleanV(ex[c.name]),
                                cleanV(ex[c.name + '_ha'])
                            ])
                        ];
                        if (yd.phases.indexOf(phase) % 2 === 1) {
                            row.eachCell(cell => {
                                cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF0F7F0' } };
                            });
                        }
                        rowIdx++;
                    }
                }
            }
        }

        const lastColNum = 12 + extraChemicals.length * 3;
        const colLetter = ws.getColumn(lastColNum).letter;
        ws.autoFilter = { from:'A1', to:`${colLetter}1` };

        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Spraying_Template_${yearStr}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        window.notify('Error generating template: ' + err.message, 'error');
    }
}

// ─────────────────────────────────────────────────────────────────────
// Import Spraying data from filled template
// ─────────────────────────────────────────────────────────────────────
async function importSprayingFromExcel(file, yearStr) {
    if (!file) return;
    try {
        await ensureExcelJSSpraying();
        const wb = new window.ExcelJS.Workbook();
        await wb.xlsx.load(await file.arrayBuffer());

        const ws = wb.getWorksheet('Spraying Data') || wb.worksheets[0];
        if (!ws) { window.notify('No worksheet found in file.', 'error'); return; }

        const yd = window.state.spraying && window.state.spraying[yearStr];
        if (!yd) { window.notify(`No spraying data for year ${yearStr}. Add year first.`, 'warn'); return; }
        if (!Array.isArray(yd.extraChemicals)) yd.extraChemicals = [];

        // ── Header-driven column mapping ──────────────────────────────
        // Read row 1 and map each column by its header NAME (not a fixed
        // position) so extra chemicals (e.g. EMB) are routed correctly
        // instead of spilling into the ALY columns.
        const headerVals = ws.getRow(1).values; // 1-indexed
        const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
        // Units that mark a chemical's "amount" column (vs Round / Ha).
        const UNIT_WORDS = { litre: 'LITRE', litres: 'LITRE', l: 'LITRE', ml: 'ML',
                             gm: 'GM', g: 'GM', kg: 'KG', cc: 'CC', pkt: 'PKT',
                             packet: 'PKT', sachet: 'SACHET', bottle: 'BTL' };

        const colMap = {};        // base field -> column index
        const extraCols = {};     // chemical name (display) -> { round, amount, ha, uom }
        for (let c = 1; c < headerVals.length; c++) {
            const raw = headerVals[c];
            const h = norm(raw);
            if (!h) continue;
            switch (h) {
                case 'year':        colMap.year = c; break;
                case 'phase':       colMap.phase = c; break;
                case 'block':       colMap.block = c; break;
                case 'ha previous': colMap.haPrev = c; break;
                case 'ha present':  colMap.haPresent = c; break;
                case 'month':       colMap.month = c; break;
                case 'round gly':   colMap.roundGly = c; break;
                case 'litres gly':
                case 'litre gly':   colMap.litresGly = c; break;
                case 'ha gly':      colMap.haGly = c; break;
                case 'round aly':   colMap.roundAly = c; break;
                case 'gm aly':      colMap.gmAly = c; break;
                case 'ha aly':      colMap.haAly = c; break;
                default: {
                    // "<prefix> <chemical>" → extra chemical column.
                    const sp = h.indexOf(' ');
                    if (sp <= 0) break;
                    const prefix = h.slice(0, sp);
                    const restRaw = String(raw).trim().slice(String(raw).trim().indexOf(' ') + 1).trim();
                    if (!restRaw) break;
                    const key = restRaw; // preserve user's chemical name/case
                    if (!extraCols[key]) extraCols[key] = { round: null, amount: null, ha: null, uom: '' };
                    if (prefix === 'round')      extraCols[key].round = c;
                    else if (prefix === 'ha')     extraCols[key].ha = c;
                    else if (UNIT_WORDS[prefix]) { extraCols[key].amount = c; extraCols[key].uom = UNIT_WORDS[prefix]; }
                    // unknown prefix → leave column unmapped (never misassign)
                }
            }
        }

        if (colMap.phase == null || colMap.block == null || colMap.month == null) {
            window.notify('Could not find the "Phase", "Block" and "Month" header columns in row 1. Please keep the header row intact.', 'error');
            return;
        }

        // Register any new extra chemicals discovered in the file so their
        // columns render in the on-screen table.
        let newChemicals = [];
        Object.keys(extraCols).forEach(name => {
            if (!yd.extraChemicals.some(ec => ec.name.toLowerCase() === name.toLowerCase())) {
                yd.extraChemicals.push({ name, uom: extraCols[name].uom || 'LITRE' });
                newChemicals.push(name);
            }
        });

        const num = v => (v != null && v !== '' ? v : undefined);

        let updated = 0, skipped = 0;
        ws.eachRow((row, rowNum) => {
            if (rowNum === 1) return;
            const vals = row.values; // 1-indexed in ExcelJS
            const at = i => (i != null ? vals[i] : undefined);

            const phaseName = at(colMap.phase) != null ? String(at(colMap.phase)).trim() : '';
            const blockNo   = at(colMap.block) != null ? String(at(colMap.block)).trim() : '';
            const month     = at(colMap.month) != null ? String(at(colMap.month)).trim().toUpperCase() : '';
            const haPrev    = at(colMap.haPrev);
            const haPresent = at(colMap.haPresent);

            if (!phaseName || !blockNo || !month) { skipped++; return; }

            const phase = yd.phases.find(p => p.phaseName === phaseName);
            if (!phase) { skipped++; return; }
            const block = phase.blocks.find(b => b.blockNo === blockNo);
            if (!block) { skipped++; return; }

            if (haPrev    != null && haPrev    !== '') block.haPrevious = parseFloat(haPrev)    || block.haPrevious;
            if (haPresent != null && haPresent !== '') block.haPresent  = parseFloat(haPresent) || block.haPresent;

            if (!block.months) block.months = {};
            const existing = block.months[month] || {};
            const extras = Object.assign({}, existing.extras || {});

            // Extra chemicals (EMB, etc.) → extras[name], extras[name+'_round'], extras[name+'_ha']
            Object.keys(extraCols).forEach(name => {
                const ec = extraCols[name];
                const rv = num(at(ec.round));
                const av = num(at(ec.amount));
                const hv = num(at(ec.ha));
                if (rv !== undefined) extras[name + '_round'] = rv;
                if (av !== undefined) extras[name]            = av;
                if (hv !== undefined) extras[name + '_ha']    = hv;
            });

            block.months[month] = {
                roundGly:  num(at(colMap.roundGly))  ?? (existing.roundGly  || ''),
                litresGly: num(at(colMap.litresGly)) ?? (existing.litresGly || ''),
                roundAly:  num(at(colMap.roundAly))  ?? (existing.roundAly  || ''),
                gmAly:     num(at(colMap.gmAly))     ?? (existing.gmAly     || ''),
                haGly:     num(at(colMap.haGly))     ?? (existing.haGly     || ''),
                haAly:     num(at(colMap.haAly))     ?? (existing.haAly     || ''),
                extras:    extras
            };
            updated++;
        });

        saveSprayingData(false);
        renderSprayingReport();
        const extraNote = newChemicals.length ? `\nAdded chemical column(s): ${newChemicals.join(', ')}.` : '';
        window.notify(`Import complete: ${updated} rows updated, ${skipped} skipped.${extraNote}`, 'success');
    } catch (err) {
        window.notify('Import error: ' + err.message, 'error');
    }
}
