window.renderCurrentPrevReport = () => {
    const wrapper = document.getElementById('current-prev-wrapper');
    if (!wrapper) return;
    
    const year = window.state.selectedReportYear;
    const month = window.state.activePerfMonth;
    
    if (!year || !month) {
        wrapper.innerHTML = '<p style="padding: 2rem;">Please select a year and month from the sidebar.</p>';
        return;
    }

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mIdx = months.indexOf(month);
    const prevMonth = mIdx === 0 ? "Dec" : months[mIdx - 1];
    const prevYear = mIdx === 0 ? String(parseInt(year) - 1) : year;

    const blocks = window.state.reports[year] || [];
    if (blocks.length === 0) {
        wrapper.innerHTML = `<p style="padding: 2rem;">No planting phase data found for ${year}.</p>`;
        return;
    }

    // Attempt to resolve month assignments or use fallbacks
    let monthAssignments = {};
    if (window.state.performance[year] && window.state.performance[year][month] && window.state.performance[year][month].gangAssignments) {
        monthAssignments = window.state.performance[year][month].gangAssignments;
    } else {
        blocks.forEach(b => monthAssignments[b.block_id] = b.gang || "Unassigned");
    }

    // Group blocks by gang
    const gangMap = {};
    blocks.forEach(block => {
        const gang = monthAssignments[block.block_id] || "Unassigned";
        if (!gangMap[gang]) gangMap[gang] = [];
        gangMap[gang].push(block);
    });

    const currPerf = (window.state.performance[year] && window.state.performance[year][month]) || {};
    const prevPerf = (window.state.performance[prevYear] && window.state.performance[prevYear][prevMonth]) || {};
    
    const currBudgetYearData = window.state.ffbBudget && window.state.ffbBudget[year] ? window.state.ffbBudget[year] : [];
    const prevBudgetYearData = window.state.ffbBudget && window.state.ffbBudget[prevYear] ? window.state.ffbBudget[prevYear] : [];
    
    if (Object.keys(currPerf).length === 0 && Object.keys(prevPerf).length === 0) {
        wrapper.innerHTML = `
            <div class="toolbar"><h2>COMPARISON: ${month} ${year} vs ${prevMonth} ${prevYear}</h2></div>
            <div style="padding: 3rem; text-align: center; background: var(--bg-secondary); border-radius: 8px; border: 1px dashed var(--border-color);">
                <h3 style="color: var(--text-muted);">No Performance Data Found</h3>
                <p>Please import the Harvesting Interval Excel files for <strong>${month} ${year}</strong> and <strong>${prevMonth} ${prevYear}</strong> using the Data Management menu.</p>
            </div>
        `;
        return;
    }

    // Helper to get annual budget for a block/month
    const getBlockBudgetMt = (bId, budgetDataArray, targetMonthStr) => {
        const bd = budgetDataArray.find(b => String(b.block_id) === String(bId));
        if (!bd || !bd.months || !Array.isArray(bd.months)) return 0;
        
        const monthNumArray = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const mIdx = monthNumArray.indexOf(targetMonthStr);
        if (mIdx === -1) return 0;
        
        return parseFloat(bd.months[mIdx] || 0);
    };

    const formatNum = (n) => (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    
    let gT_HA = 0;
    let gT_R1 = 0, gT_R2 = 0, gT_R3 = 0, gT_CurrTot = 0, gT_CurrBud = 0;
    let gT_PrevTot = 0, gT_PrevBud = 0;

    const gangs = Object.keys(gangMap).sort();
    const toggleIds = [];
    let tbodyHtml = '';
    
    gangs.forEach((gang, index) => {
        const gangBlocks = gangMap[gang].sort((a,b) => String(a.block_id).localeCompare(String(b.block_id), undefined, {numeric:true}));
        
        let s_HA = 0;
        let s_R1 = 0, s_R2 = 0, s_R3 = 0, s_CurrTot = 0, s_CurrBud = 0;
        let s_PrevTot = 0, s_PrevBud = 0;
        
        let blockHtml = '';

        gangBlocks.forEach(b => {
            const bId = b.block_id;
            const ha = parseFloat(b.ha) || 0;
            s_HA += ha;
            
            // Current Month Data
            let r1 = 0, r2 = 0, r3 = 0, currTot = 0;
            if (currPerf[gang] && currPerf[gang].blocks && currPerf[gang].blocks[bId]) {
                const pd = currPerf[gang].blocks[bId];
                r1 = parseFloat(pd.r1) || 0;
                r2 = parseFloat(pd.r2) || 0;
                r3 = parseFloat(pd.r3) || 0;
                currTot = r1 + r2 + r3 + (parseFloat(pd.r4) || 0);
            }
            s_R1 += r1; s_R2 += r2; s_R3 += r3; s_CurrTot += currTot;
            
            const currBud = getBlockBudgetMt(bId, currBudgetYearData, month);
            s_CurrBud += currBud;
            
            const currActualMtHa = ha > 0 ? currTot / ha : 0;
            const currBudgetMtHa = ha > 0 ? currBud / ha : 0;
            
            // Previous Month Data
            let prevTot = 0;
            const prevGangMap = (window.state.performance[prevYear] && window.state.performance[prevYear][prevMonth] && window.state.performance[prevYear][prevMonth].gangAssignments) || {};
            const prevGang = prevGangMap[bId] || gang; 
            
            if (prevPerf[prevGang] && prevPerf[prevGang].blocks && prevPerf[prevGang].blocks[bId]) {
                const pd = prevPerf[prevGang].blocks[bId];
                prevTot = (parseFloat(pd.r1)||0) + (parseFloat(pd.r2)||0) + (parseFloat(pd.r3)||0) + (parseFloat(pd.r4)||0);
            }
            s_PrevTot += prevTot;
            
            const prevBud = getBlockBudgetMt(bId, prevBudgetYearData, prevMonth);
            s_PrevBud += prevBud;
            
            const prevActualMtHa = ha > 0 ? prevTot / ha : 0;

            blockHtml += `
                <tr class="row-block perf-toggle-${index}-hideable" style="background:var(--bg-primary);">
                    <td class="text-left" style="padding-left:2rem;">${bId}</td>
                    <td class="text-right">${formatNum(ha)}</td>
                    
                    <td class="text-right">${r1 > 0 ? formatNum(r1) : '-'}</td>
                    <td class="text-right">${r2 > 0 ? formatNum(r2) : '-'}</td>
                    <td class="text-right">${r3 > 0 ? formatNum(r3) : '-'}</td>
                    <td class="text-right font-bold ${currBud > 0 && currTot < currBud ? 'text-danger-important' : ''}">${formatNum(currTot)}</td>
                    
                    <td class="text-right">${formatNum(currBud)}</td>
                    
                    <td class="text-right">${formatNum(currActualMtHa)}</td>
                    <td class="text-right">${formatNum(currBudgetMtHa)}</td>
                    
                    <td class="text-right font-bold ${prevBud > 0 && prevTot < prevBud ? 'text-danger-important' : ''}" style="${prevBud > 0 && prevTot < prevBud ? '' : 'color:var(--text-muted);'}">${formatNum(prevTot)}</td>
                    <td class="text-right" style="color:var(--text-muted);">${formatNum(prevBud)}</td>
                    <td class="text-right" style="color:var(--text-muted);">${formatNum(prevActualMtHa)}</td>
                </tr>
            `;
        });

        const s_currActualMtHa = s_HA > 0 ? s_CurrTot / s_HA : 0;
        const s_currBudgetMtHa = s_HA > 0 ? s_CurrBud / s_HA : 0;
        const s_prevActualMtHa = s_HA > 0 ? s_PrevTot / s_HA : 0;

        const toggleId = `perf-toggle-${index}`;
        toggleIds.push(toggleId);

        // Gang header row with collapse toggle
        tbodyHtml += `
            <tr class="row-group-header" onclick="document.body.classList.toggle('${toggleId}')" style="cursor:pointer; background:var(--bg-secondary); border-top: 2px solid var(--border-color);">
                <td class="text-left font-bold" style="color:var(--text-primary);">
                    <span id="${toggleId}-icon" style="display:inline-block; transition:transform 0.2s; margin-right:0.5rem;">▼</span>${gang}
                </td>
                <td class="text-right font-bold">${formatNum(s_HA)}</td>
                <td class="text-right font-bold">${formatNum(s_R1)}</td>
                <td class="text-right font-bold">${formatNum(s_R2)}</td>
                <td class="text-right font-bold">${formatNum(s_R3)}</td>
                <td class="text-right font-bold ${s_CurrBud > 0 && s_CurrTot < s_CurrBud ? 'text-danger-important' : ''}" style="${s_CurrBud > 0 && s_CurrTot < s_CurrBud ? '' : 'color: #3b82f6;'}">${formatNum(s_CurrTot)}</td>
                
                <td class="text-right font-bold">${formatNum(s_CurrBud)}</td>
                
                <td class="text-right font-bold" style="color: #10b981;">${formatNum(s_currActualMtHa)}</td>
                <td class="text-right font-bold">${formatNum(s_currBudgetMtHa)}</td>
                
                <td class="text-right font-bold ${s_PrevBud > 0 && s_PrevTot < s_PrevBud ? 'text-danger-important' : ''}" style="${s_PrevBud > 0 && s_PrevTot < s_PrevBud ? '' : 'color: #f59e0b;'}">${formatNum(s_PrevTot)}</td>
                <td class="text-right font-bold">${formatNum(s_PrevBud)}</td>
                <td class="text-right font-bold">${formatNum(s_prevActualMtHa)}</td>
            </tr>
        `;
        
        tbodyHtml += blockHtml;

        gT_HA += s_HA;
        gT_R1 += s_R1; gT_R2 += s_R2; gT_R3 += s_R3; gT_CurrTot += s_CurrTot; gT_CurrBud += s_CurrBud;
        gT_PrevTot += s_PrevTot; gT_PrevBud += s_PrevBud;

        // Inject CSS for this group toggle
        if (!document.getElementById(`style-${toggleId}`)) {
            const style = document.createElement('style');
            style.id = `style-${toggleId}`;
            style.innerHTML = `
                body.${toggleId} .${toggleId}-hideable { display: none !important; }
                body.${toggleId} #${toggleId}-icon { transform: rotate(-90deg); }
            `;
            document.head.appendChild(style);
        }
        // Start collapsed by default
        document.body.classList.add(toggleId);
    });

    const gT_currActualMtHa = gT_HA > 0 ? gT_CurrTot / gT_HA : 0;
    const gT_currBudgetMtHa = gT_HA > 0 ? gT_CurrBud / gT_HA : 0;
    const gT_prevActualMtHa = gT_HA > 0 ? gT_PrevTot / gT_HA : 0;

    let html = `
        <div class="toolbar">
            <div class="toolbar-left">
                <h2>HARVESTER PERFORMANCE COMPARISON: ${month.toUpperCase()} ${year} vs ${prevMonth.toUpperCase()} ${prevYear}</h2>
            </div>
            <div class="toolbar-right" style="display:flex; gap:0.5rem; align-items:center;">
                <button id="perf-expand-all-btn" style="padding:0.4rem 0.9rem; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:4px; cursor:pointer; font-size:0.85rem;">
                    <span>+</span> Expand All
                </button>
                <button id="perf-collapse-all-btn" style="padding:0.4rem 0.9rem; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:4px; cursor:pointer; font-size:0.85rem;">
                    <span>−</span> Collapse All
                </button>
            </div>
        </div>
        <div class="table-container">
            <table class="grouped-table" style="font-size: 0.85rem;">
                <thead>
                    <tr>
                        <th rowspan="2" class="text-left" style="width:150px;">Gang / Block</th>
                        <th rowspan="2" class="text-right">Total HA</th>
                        <th colspan="4" class="text-center" style="background: rgba(59, 130, 246, 0.1);">${month.toUpperCase()} ${year} ACTUAL (MT)</th>
                        <th rowspan="2" class="text-right">Budget ${month} (MT)</th>
                        <th colspan="2" class="text-center" style="background: rgba(16, 185, 129, 0.1);">${month.toUpperCase()} ${year} MT / HA</th>
                        <th colspan="3" class="text-center" style="background: rgba(245, 158, 11, 0.1);">${prevMonth.toUpperCase()} ${prevYear} PREVIOUS MONTH</th>
                    </tr>
                    <tr>
                        <th class="text-right" style="font-size:0.75rem;">1st</th>
                        <th class="text-right" style="font-size:0.75rem;">2nd</th>
                        <th class="text-right" style="font-size:0.75rem;">3rd</th>
                        <th class="text-right" style="font-size:0.75rem;">Total</th>
                        
                        <th class="text-right" style="font-size:0.75rem;">Actual</th>
                        <th class="text-right" style="font-size:0.75rem;">Budget</th>

                        <th class="text-right" style="font-size:0.75rem;">Actual FFB</th>
                        <th class="text-right" style="font-size:0.75rem;">Budget FFB</th>
                        <th class="text-right" style="font-size:0.75rem;">Actual MT/HA</th>
                    </tr>
                </thead>
                <tbody>
                    ${tbodyHtml}
                </tbody>
                <tfoot>
                    <tr class="row-grand-total">
                        <td class="text-left font-bold">GRAND TOTAL</td>
                        <td class="text-right font-bold">${formatNum(gT_HA)}</td>
                        <td class="text-right font-bold">${formatNum(gT_R1)}</td>
                        <td class="text-right font-bold">${formatNum(gT_R2)}</td>
                        <td class="text-right font-bold">${formatNum(gT_R3)}</td>
                        <td class="text-right font-bold ${gT_CurrBud > 0 && gT_CurrTot < gT_CurrBud ? 'text-danger-important' : ''}">${formatNum(gT_CurrTot)}</td>
                        <td class="text-right font-bold">${formatNum(gT_CurrBud)}</td>
                        <td class="text-right font-bold">${formatNum(gT_currActualMtHa)}</td>
                        <td class="text-right font-bold">${formatNum(gT_currBudgetMtHa)}</td>
                        <td class="text-right font-bold ${gT_PrevBud > 0 && gT_PrevTot < gT_PrevBud ? 'text-danger-important' : ''}">${formatNum(gT_PrevTot)}</td>
                        <td class="text-right font-bold">${formatNum(gT_PrevBud)}</td>
                        <td class="text-right font-bold">${formatNum(gT_prevActualMtHa)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;

    wrapper.innerHTML = html;

    // Expand All button
    const expandAllBtn = document.getElementById('perf-expand-all-btn');
    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', () => {
            toggleIds.forEach(id => document.body.classList.remove(id));
        });
    }

    // Collapse All button
    const collapseAllBtn = document.getElementById('perf-collapse-all-btn');
    if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', () => {
            toggleIds.forEach(id => document.body.classList.add(id));
        });
    }
};
