window.renderYtdReport = () => {
    const wrapper = document.getElementById('ytd-wrapper');
    if (!wrapper) return;
    
    const year = window.state.selectedReportYear;
    const month = window.state.activePerfMonth;
    
    if (!year || !month) {
        wrapper.innerHTML = '<p style="padding: 2rem;">Please select a year and month from the sidebar.</p>';
        return;
    }

    const blocks = window.state.reports[year] || [];
    if (blocks.length === 0) {
        wrapper.innerHTML = `<p style="padding: 2rem;">No planting phase data found for ${year}.</p>`;
        return;
    }

    const prevYear = String(parseInt(year) - 1);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mIdx = months.indexOf(month);
    
    // Group by O/P Year
    const opMap = {};
    blocks.forEach(block => {
        const op = block.op_year || "Unassigned";
        if (!opMap[op]) opMap[op] = [];
        opMap[op].push(block);
    });

    const currBudgetYearData = window.state.ffbBudget && window.state.ffbBudget[year] ? window.state.ffbBudget[year] : [];
    const prevBudgetYearData = window.state.ffbBudget && window.state.ffbBudget[prevYear] ? window.state.ffbBudget[prevYear] : [];
    
    // Helper to sum YTD budget for a block (Jan -> Target Month)
    const getYtdBudgetMt = (bId, budgetDataArray) => {
        const bd = budgetDataArray.find(b => String(b.block_id) === String(bId));
        if (!bd || !bd.months || !Array.isArray(bd.months)) return 0;
        let sum = 0;
        for (let i = 0; i <= mIdx; i++) {
            sum += parseFloat(bd.months[i] || 0);
        }
        return sum;
    };
    
    // Helper to get Annual budget total for a block
    const getAnnualBudgetMt = (bId, budgetDataArray) => {
        const bd = budgetDataArray.find(b => String(b.block_id) === String(bId));
        if (!bd) return 0;
        return parseFloat(bd.annual_budget || bd.total || 0); 
    };

    // Helper to sum YTD Actual for a block (Jan -> Target Month)
    const getYtdActualMt = (y, bId) => {
        let sum = 0;
        if (!window.state.performance[y]) return sum;
        
        for (let i = 0; i <= mIdx; i++) {
            const mStr = months[i];
            const mData = window.state.performance[y][mStr];
            if (!mData) continue;
            
            // Need to find the block across all gangs as it might have shifted
            const blockGangAssignments = mData.gangAssignments || {};
            const gangName = blockGangAssignments[bId];
            
            if (gangName && mData[gangName] && mData[gangName].blocks && mData[gangName].blocks[bId]) {
                const pd = mData[gangName].blocks[bId];
                sum += (parseFloat(pd.r1)||0) + (parseFloat(pd.r2)||0) + (parseFloat(pd.r3)||0) + (parseFloat(pd.r4)||0);
            } else {
                // Fallback check all gangs if missing from assignments map
                Object.keys(mData).forEach(gKey => {
                    if (gKey !== 'gangAssignments') {
                        if (mData[gKey].blocks && mData[gKey].blocks[bId]) {
                            const pd = mData[gKey].blocks[bId];
                            sum += (parseFloat(pd.r1)||0) + (parseFloat(pd.r2)||0) + (parseFloat(pd.r3)||0) + (parseFloat(pd.r4)||0);
                        }
                    }
                });
            }
        }
        return sum;
    };

    const formatNum = (n) => (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Sort O/P ascending
    const opKeys = Object.keys(opMap).sort((a, b) => parseInt(a) - parseInt(b));

    let gT_HA = 0;
    let gT_CurrBud = 0, gT_CurrAct = 0;
    let gT_PrevBud = 0, gT_PrevAct = 0;
    let gT_Var = 0;

    let tbodyHtml = '';
    const toggleIds = [];

    opKeys.forEach((op, index) => {
        const opBlocks = opMap[op].sort((a,b) => String(a.block_id).localeCompare(String(b.block_id), undefined, {numeric:true}));
        
        let s_HA = 0;
        let s_CurrBud = 0, s_CurrAct = 0;
        let s_PrevBud = 0, s_PrevAct = 0;
        let s_Var = 0;
        
        let blockHtml = '';

        opBlocks.forEach(b => {
            const bId = b.block_id;
            const ha = parseFloat(b.ha) || 0;
            s_HA += ha;
            
            const currBud = getYtdBudgetMt(bId, currBudgetYearData);
            const prevBud = getYtdBudgetMt(bId, prevBudgetYearData);
            
            const currAct = getYtdActualMt(year, bId);
            const prevAct = getYtdActualMt(prevYear, bId);
            
            const variance = currAct - prevAct;
            
            s_CurrBud += currBud;
            s_CurrAct += currAct;
            s_PrevBud += prevBud;
            s_PrevAct += prevAct;
            s_Var += variance;
            
            const currMtHa = ha > 0 ? currAct / ha : 0;
            const prevMtHa = ha > 0 ? prevAct / ha : 0;

            blockHtml += `
                <tr class="row-block ytd-toggle-${index}-hideable" style="background:var(--bg-primary);">
                    <td class="text-left" style="padding-left:2rem;">${bId}</td>
                    <td class="text-right">${formatNum(ha)}</td>
                    
                    <td class="text-right" style="color:var(--text-muted);">${formatNum(currBud)}</td>
                    <td class="text-right font-bold ${currBud > 0 && currAct < currBud ? 'text-danger-important' : ''}">${formatNum(currAct)}</td>
                    
                    <td class="text-right" style="color:var(--text-muted);">${formatNum(prevBud)}</td>
                    <td class="text-right font-bold ${prevBud > 0 && prevAct < prevBud ? 'text-danger-important' : ''}">${formatNum(prevAct)}</td>
                    
                    <td class="text-right font-bold ${variance >= 0 ? 'text-success' : 'text-danger'}">${variance > 0 ? '+' : ''}${formatNum(variance)}</td>
                    
                    <td class="text-right">${formatNum(currMtHa)}</td>
                    <td class="text-right">${formatNum(prevMtHa)}</td>
                </tr>
            `;
        });

        const s_currMtHa = s_HA > 0 ? s_CurrAct / s_HA : 0;
        const s_prevMtHa = s_HA > 0 ? s_PrevAct / s_HA : 0;

        const toggleId = `ytd-toggle-${index}`;
        toggleIds.push(toggleId);

        // Group header row with collapse toggle
        tbodyHtml += `
            <tr class="row-group-header" onclick="document.body.classList.toggle('${toggleId}')" style="cursor:pointer; background:var(--bg-secondary); border-top: 2px solid var(--border-color);">
                <td class="text-left font-bold" style="color:var(--text-primary);">
                    <span id="${toggleId}-icon" style="display:inline-block; transition:transform 0.2s; margin-right:0.5rem;">▼</span>O/P ${op}
                </td>
                <td class="text-right font-bold">${formatNum(s_HA)}</td>
                
                <td class="text-right font-bold">${formatNum(s_CurrBud)}</td>
                <td class="text-right font-bold ${s_CurrBud > 0 && s_CurrAct < s_CurrBud ? 'text-danger-important' : ''}" style="${s_CurrBud > 0 && s_CurrAct < s_CurrBud ? '' : 'color: #3b82f6;'}">${formatNum(s_CurrAct)}</td>
                
                <td class="text-right font-bold">${formatNum(s_PrevBud)}</td>
                <td class="text-right font-bold ${s_PrevBud > 0 && s_PrevAct < s_PrevBud ? 'text-danger-important' : ''}" style="${s_PrevBud > 0 && s_PrevAct < s_PrevBud ? '' : 'color: #f59e0b;'}">${formatNum(s_PrevAct)}</td>
                
                <td class="text-right font-bold ${s_Var >= 0 ? 'text-success' : 'text-danger'}">${s_Var > 0 ? '+' : ''}${formatNum(s_Var)}</td>
                
                <td class="text-right font-bold" style="color: #10b981;">${formatNum(s_currMtHa)}</td>
                <td class="text-right font-bold">${formatNum(s_prevMtHa)}</td>
            </tr>
        `;
        
        tbodyHtml += blockHtml;

        gT_HA += s_HA;
        gT_CurrBud += s_CurrBud; gT_CurrAct += s_CurrAct;
        gT_PrevBud += s_PrevBud; gT_PrevAct += s_PrevAct;
        gT_Var += s_Var;

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

    const gT_currMtHa = gT_HA > 0 ? gT_CurrAct / gT_HA : 0;
    const gT_prevMtHa = gT_HA > 0 ? gT_PrevAct / gT_HA : 0;

    let html = `
        <div class="toolbar">
            <div class="toolbar-left">
                <h2>YIELD TO DATE (YTD) COMPARISON: JAN - ${month.toUpperCase()} (${year} vs ${prevYear})</h2>
            </div>
            <div class="toolbar-right" style="display:flex; gap:0.5rem; align-items:center;">
                <button id="ytd-expand-all-btn" style="padding:0.4rem 0.9rem; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:4px; cursor:pointer; font-size:0.85rem;">
                    <span>+</span> Expand All
                </button>
                <button id="ytd-collapse-all-btn" style="padding:0.4rem 0.9rem; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:4px; cursor:pointer; font-size:0.85rem;">
                    <span>−</span> Collapse All
                </button>
            </div>
        </div>
        <div class="table-container">
            <table class="grouped-table" style="font-size: 0.85rem;">
                <thead>
                    <tr>
                        <th rowspan="2" class="text-left" style="width:120px;">Block</th>
                        <th rowspan="2" class="text-right">Total HA</th>
                        <th colspan="2" class="text-center" style="background: rgba(59, 130, 246, 0.1);">${year}</th>
                        <th colspan="2" class="text-center" style="background: rgba(245, 158, 11, 0.1);">${prevYear}</th>
                        <th rowspan="2" class="text-right">Actual Variance<br/>(${year} vs ${prevYear})</th>
                        <th colspan="2" class="text-center" style="background: rgba(16, 185, 129, 0.1);">YTD MT / HA</th>
                    </tr>
                    <tr>
                        <th class="text-right" style="font-size:0.75rem;">YTD Budget (MT)</th>
                        <th class="text-right" style="font-size:0.75rem;">YTD Actual (MT)</th>
                        
                        <th class="text-right" style="font-size:0.75rem;">YTD Budget (MT)</th>
                        <th class="text-right" style="font-size:0.75rem;">YTD Actual (MT)</th>

                        <th class="text-right" style="font-size:0.75rem;">${year}</th>
                        <th class="text-right" style="font-size:0.75rem;">${prevYear}</th>
                    </tr>
                </thead>
                <tbody>
                    ${tbodyHtml}
                </tbody>
                <tfoot>
                    <tr class="row-grand-total">
                        <td class="text-left font-bold">ALL BLOCKS</td>
                        <td class="text-right font-bold">${formatNum(gT_HA)}</td>
                        <td class="text-right font-bold">${formatNum(gT_CurrBud)}</td>
                        <td class="text-right font-bold ${gT_CurrBud > 0 && gT_CurrAct < gT_CurrBud ? 'text-danger-important' : ''}">${formatNum(gT_CurrAct)}</td>
                        <td class="text-right font-bold">${formatNum(gT_PrevBud)}</td>
                        <td class="text-right font-bold ${gT_PrevBud > 0 && gT_PrevAct < gT_PrevBud ? 'text-danger-important' : ''}">${formatNum(gT_PrevAct)}</td>
                        <td class="text-right font-bold ${gT_Var >= 0 ? 'text-success' : 'text-danger'}">${gT_Var > 0 ? '+' : ''}${formatNum(gT_Var)}</td>
                        <td class="text-right font-bold">${formatNum(gT_currMtHa)}</td>
                        <td class="text-right font-bold">${formatNum(gT_prevMtHa)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
        <style>
            .text-success { color: #10b981 !important; }
            .text-danger { color: #ef4444 !important; }
        </style>
    `;

    wrapper.innerHTML = html;

    // Expand All button
    const expandAllBtn = document.getElementById('ytd-expand-all-btn');
    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', () => {
            toggleIds.forEach(id => document.body.classList.remove(id));
        });
    }

    // Collapse All button
    const collapseAllBtn = document.getElementById('ytd-collapse-all-btn');
    if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', () => {
            toggleIds.forEach(id => document.body.classList.add(id));
        });
    }
};
