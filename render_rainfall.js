const renderRainfallTable = () => {
    const rainfallWrapper = document.getElementById('rainfall-wrapper');
    if (!rainfallWrapper) return;
    
    rainfallWrapper.innerHTML = '';
    
    const yearStr = state.selectedReportYear;
    if (!yearStr) return;

    // Guard: Ensure rainfall data exists for the selected year
    if (!state.rainfall) state.rainfall = {};
    if (!state.rainfall[yearStr]) {
        if (typeof createEmptyData === 'function') {
            state.rainfall[yearStr] = createEmptyData();
        } else {
            state.rainfall[yearStr] = {};
            const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
            months.forEach(m => state.rainfall[yearStr][m] = { days: 0, mm: 0 });
        }
    }

    const currentYear = parseInt(yearStr);
    const prevYear = (currentYear - 1).toString();
    const isPrevYearAvailable = state.rainfall && state.rainfall[prevYear];
    
    // Header
    const headerTitle = document.createElement('h1');
    headerTitle.textContent = `SUMMARY REPORT FOR RAINFALL RECORD FOR THE YEAR ${isPrevYearAvailable ? prevYear + ' VS ' : ''}${currentYear}`;
    headerTitle.style.marginBottom = '2rem';
    headerTitle.style.fontSize = '1.25rem';
    headerTitle.style.fontWeight = '700';
    headerTitle.style.textTransform = 'uppercase';
    headerTitle.style.textDecoration = 'underline';
    rainfallWrapper.appendChild(headerTitle);

    // Provide a Save button
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.style.justifyContent = 'flex-end';
    toolbar.style.marginBottom = '1rem';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.style.backgroundColor = '#10b981';
    saveBtn.style.borderColor = '#10b981';
    saveBtn.innerHTML = `<span>💾</span> Save Rainfall Data`;
    saveBtn.onclick = () => {
        saveState();
    };
    toolbar.appendChild(saveBtn);
    rainfallWrapper.appendChild(toolbar);

    // Table Container
    const tableContainer = document.createElement('div');
    tableContainer.className = 'table-container';
    tableContainer.style.background = 'white';
    tableContainer.style.padding = '0';
    tableContainer.style.borderRadius = '0';
    tableContainer.style.boxShadow = 'none';

    const table = document.createElement('table');
    table.className = 'grouped-table';
    table.style.width = '100%';
    table.style.textAlign = 'center';
    table.style.borderCollapse = 'collapse';
    
    const thead = document.createElement('thead');
    const headerGroups = [];
    if (isPrevYearAvailable) headerGroups.push({ label: prevYear, subLabel: 'RAINFALL RECORD' });
    headerGroups.push({ label: currentYear, subLabel: 'RAINFALL RECORD' });
    if (isPrevYearAvailable) headerGroups.push({ label: `${currentYear} vs ${prevYear}`, subLabel: 'DIFF.' });

    // Top header row
    let topHeaderHtml = `<tr><th rowspan="3" style="background:white; border:2px solid #000; padding:10px; font-size:0.95rem;">MONTH</th>`;
    headerGroups.forEach(group => {
        topHeaderHtml += `<th colspan="3" style="background:white; border:2px solid #000; padding:10px; font-size:0.95rem;">${group.label}</th>`;
    });
    topHeaderHtml += `</tr>`;

    // Middle header row (sub-labels)
    let midHeaderHtml = `<tr>`;
    headerGroups.forEach(group => {
        midHeaderHtml += `<th colspan="3" style="background:white; border:2px solid #000; padding:4px; font-size:0.8rem;">${group.subLabel}</th>`;
    });
    midHeaderHtml += `</tr>`;

    // Bottom header row (column names)
    const colNames = `
        <th style="background:white; border:2px solid #000; font-size:0.75rem; padding:6px;">DAYS</th>
        <th style="background:white; border:2px solid #000; font-size:0.75rem; padding:6px;">MM</th>
        <th style="background:white; border:2px solid #000; font-size:0.75rem; padding:6px;">MM TO MONTH</th>
    `;
    let bottomHeaderHtml = `<tr>`;
    headerGroups.forEach(() => bottomHeaderHtml += colNames);
    bottomHeaderHtml += `</tr>`;

    thead.innerHTML = topHeaderHtml + midHeaderHtml + bottomHeaderHtml;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const monthsArr = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const monthFullNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    let prevCumulative = 0;
    let currCumulative = 0;
    
    let prevTotalDays = 0;
    let prevTotalMM = 0;
    let currTotalDays = 0;
    let currTotalMM = 0;

    let lastActiveMonthIdx = -1;
    // Find latest month with data in CURRENT year
    monthsArr.forEach((m, i) => {
        const d = state.rainfall[yearStr][m] || {days:0, mm:0};
        if (parseFloat(d.days) > 0 || parseFloat(d.mm) > 0) {
            lastActiveMonthIdx = i;
        }
    });

    monthsArr.forEach((month, idx) => {
        const tr = document.createElement('tr');
        
        // Month name
        let rowHtml = `<td style="border:1px solid #000; font-weight:400; text-align:left; padding-left:0.5rem;">${month}</td>`;
        
        // Previous Year Data
        let prevDays = 0, prevMM = 0;
        if (isPrevYearAvailable) {
            const pData = state.rainfall[prevYear][month] || { days:0, mm:0 };
            prevDays = parseFloat(pData.days) || 0;
            prevMM = parseFloat(pData.mm) || 0;
            prevCumulative += prevMM;
            
            prevTotalDays += prevDays;
            prevTotalMM += prevMM;

            rowHtml += `
                <td style="border:1px solid #000; text-align:right; padding-right:5px;">${prevDays > 0 ? prevDays.toLocaleString('en-US', {minimumFractionDigits:2}) : '0.00'}</td>
                <td style="border:1px solid #000; text-align:right; padding-right:5px;">${prevMM > 0 ? prevMM.toLocaleString('en-US', {minimumFractionDigits:2}) : '0.00'}</td>
                <td style="border:1px solid #000; text-align:right; padding-right:5px;">${prevCumulative.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
            `;
        }

        // Current Year Data
        const cData = state.rainfall[yearStr][month] || { days:0, mm:0 };
        const currDays = parseFloat(cData.days) || 0;
        const currMM = parseFloat(cData.mm) || 0;
        const isPopulated = currDays > 0 || currMM > 0;
        
        if (isPopulated) {
            currCumulative += currMM;
            currTotalDays += currDays;
            currTotalMM += currMM;
        }

        const tdDays = document.createElement('td');
        tdDays.style.border = '1px solid #000';
        const inputDays = document.createElement('input');
        inputDays.type = 'number';
        inputDays.className = 'edit-input text-right';
        inputDays.style.padding = '2px 5px';
        inputDays.value = isPopulated ? currDays : '';
        let daysSaveTimer = null;
        inputDays.oninput = (e) => {
            const val = parseFloat(e.target.value) || 0;
            state.rainfall[yearStr][month].days = val;
            const anyVal = val > 0 || (parseFloat(state.rainfall[yearStr][month].mm) || 0) > 0;
            if (anyVal) {
                tdDays.style.background = '';
                inputDays.style.color = '';
                inputDays.style.background = '';
                tdMM.style.background = '';
                inputMM.style.color = '';
                inputMM.style.background = '';
            }
            clearTimeout(daysSaveTimer);
            daysSaveTimer = setTimeout(() => saveState(true), 800);
        };
        inputDays.onchange = () => {
            clearTimeout(daysSaveTimer);
            saveState(true);
            renderRainfallTable();
        };
        tdDays.appendChild(inputDays);

        const tdMM = document.createElement('td');
        tdMM.style.border = '1px solid #000';
        const inputMM = document.createElement('input');
        inputMM.type = 'number';
        inputMM.className = 'edit-input text-right';
        inputMM.style.padding = '2px 5px';
        inputMM.value = isPopulated ? currMM : '';
        let mmSaveTimer = null;
        inputMM.oninput = (e) => {
            const val = parseFloat(e.target.value) || 0;
            state.rainfall[yearStr][month].mm = val;
            const anyVal = val > 0 || (parseFloat(state.rainfall[yearStr][month].days) || 0) > 0;
            if (anyVal) {
                tdDays.style.background = '';
                inputDays.style.color = '';
                inputDays.style.background = '';
                tdMM.style.background = '';
                inputMM.style.color = '';
                inputMM.style.background = '';
            }
            clearTimeout(mmSaveTimer);
            mmSaveTimer = setTimeout(() => saveState(true), 800);
        };
        inputMM.onchange = () => {
            clearTimeout(mmSaveTimer);
            saveState(true);
            renderRainfallTable();
        };
        tdMM.appendChild(inputMM);

        const tdCumMM = document.createElement('td');
        tdCumMM.style.border = '1px solid #000';
        tdCumMM.style.textAlign = 'right';
        tdCumMM.style.paddingRight = '5px';
        tdCumMM.textContent = isPopulated ? currCumulative.toLocaleString('en-US', {minimumFractionDigits:2}) : '0.00';

        // Difference Data
        let diffHtml = '';
        if (isPrevYearAvailable) {
            if (isPopulated) {
                const diffDays = currDays - prevDays;
                const diffMM = currMM - prevMM;
                const diffCum = currCumulative - prevCumulative;

                diffHtml = `
                    <td style="border:1px solid #000; text-align:right; padding-right:5px;">${diffDays.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                    <td style="border:1px solid #000; text-align:right; padding-right:5px;">${diffMM.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                    <td style="border:1px solid #000; text-align:right; padding-right:5px;">${diffCum.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                `;
            } else {
                // In mockup, if current month is empty, diff MM to month still shows the "negative" of previous cumulative
                const diffCum = 0 - prevCumulative;
                diffHtml = `
                    <td style="border:1px solid #000; background:#000;"></td>
                    <td style="border:1px solid #000; background:#000;"></td>
                    <td style="border:1px solid #000; text-align:right; padding-right:5px;">${diffCum.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                `;
            }
        }

        tr.innerHTML = rowHtml;
        tr.appendChild(tdDays);
        tr.appendChild(tdMM);
        tr.appendChild(tdCumMM);
        
        if (isPrevYearAvailable) {
            tr.insertAdjacentHTML('beforeend', diffHtml);
        }

        // Styling for non-populated months
        if (!isPopulated) {
            tdDays.style.background = '#000';
            tdMM.style.background = '#000';
            // In mockup, Jan 2026 MM TO MONTH is 704.00, others are 0.00 and NOT blacked out?
            // Wait, looking at mockup, middle column rows 2..12 have "0.00" and are NOT blacked out for MM to Month.
            // But DAYS and MM ARE blacked out.
            inputDays.style.background = 'transparent';
            inputMM.style.background = 'transparent';
            inputDays.style.color = '#fff';
            inputMM.style.color = '#fff';
        }

        tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    // Totals Row
    const tfoot = document.createElement('tfoot');
    const trTotals = document.createElement('tr');
    trTotals.style.fontWeight = '700';

    let tfootHtml = `<td style="text-align:left; border:1px solid #000; padding-left:0.5rem; font-style:italic;">TOTAL</td>`;
    
    if (isPrevYearAvailable) {
        tfootHtml += `
            <td style="border:1px solid #000; text-align:right; padding-right:5px;">${prevTotalDays.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
            <td style="border:1px solid #000; text-align:right; padding-right:5px;">${prevTotalMM.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
            <td style="border:1px solid #000;"></td>
        `;
    }
    
    // Totals for current year (mockup shows empty)
    tfootHtml += `
        <td style="border:1px solid #000;"></td>
        <td style="border:1px solid #000;"></td>
        <td style="border:1px solid #000;"></td>
    `;

    if (isPrevYearAvailable) {
        // Red bracket logic: Diff at the bottom is based on the LAST POPULATED MONTH
        let ytdPrevDays = 0;
        let ytdPrevMM = 0;
        for(let i=0; i<=lastActiveMonthIdx; i++) {
            const pData = state.rainfall[prevYear][monthsArr[i]] || {days:0, mm:0};
            ytdPrevDays += parseFloat(pData.days) || 0;
            ytdPrevMM += parseFloat(pData.mm) || 0;
        }

        if (lastActiveMonthIdx > -1) {
            const totalDiffDays = currTotalDays - ytdPrevDays;
            const totalDiffMM = currTotalMM - ytdPrevMM;
            tfootHtml += `
                <td style="border:1px solid #000; text-align:right; padding-right:5px;">${totalDiffDays.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                <td style="border:1px solid #000; text-align:right; padding-right:5px;">${totalDiffMM.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                <td style="border:1px solid #000;"></td>
            `;
        } else {
             tfootHtml += `<td style="border:1px solid #000;"></td><td style="border:1px solid #000;"></td><td style="border:1px solid #000;"></td>`;
        }
    }

    trTotals.innerHTML = tfootHtml;
    tfoot.appendChild(trTotals);
    table.appendChild(tfoot);

    tableContainer.appendChild(table);
    rainfallWrapper.appendChild(tableContainer);


    // Summary Widget (Red Bracket Area)
    if (isPrevYearAvailable && lastActiveMonthIdx > -1) {
        let pCum = 0;
        let cCum = 0;
        for(let i=0; i<=lastActiveMonthIdx; i++) {
            pCum += parseFloat(state.rainfall[prevYear][monthsArr[i]]?.mm || 0);
            cCum += parseFloat(state.rainfall[yearStr][monthsArr[i]]?.mm || 0);
        }
        const diff = cCum - pCum;
        const operator = cCum > pCum ? '<' : cCum < pCum ? '>' : '='; // Mockup shows 2025 > 2026 when 2026 is less
        const actionWord = cCum < pCum ? 'less' : 'more';
        const latestMonthName = monthFullNames[lastActiveMonthIdx];

        const summaryWrapper = document.createElement('div');
        summaryWrapper.style.marginTop = '4rem';
        summaryWrapper.style.textAlign = 'left';

        summaryWrapper.innerHTML = `
            <table style="border-collapse:collapse; text-align:center; width:280px; font-family:'Outfit';">
                <thead>
                    <tr><th style="background:white; border:2px solid #000; padding:8px; font-size:0.95rem;">MM TO MONTH ${currentYear} vs ${prevYear}</th></tr>
                </thead>
                <tbody>
                    <tr><td style="background:white; border:2px solid #000; padding:10px; font-weight:700; font-size:1.3rem;">${diff.toLocaleString('en-US', {minimumFractionDigits:2})}</td></tr>
                    <tr style="border:none;">
                        <td style="padding:10px 0;">
                            <div style="display:flex; justify-content:center; align-items:center; font-weight:700; font-size:1.15rem; gap:2rem;">
                                <span>${prevYear}</span>
                                <span>${operator}</span>
                                <span>${currentYear}</span>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
            <div style="margin-top:1.5rem; font-size:1rem; font-weight:700; color:#000; font-family:'Outfit'; line-height:1.6;">
                <p style="margin:5px 0;">*MM TO MONTH as of ${latestMonthName} for both years</p>
                <p style="margin:5px 0;">**${currentYear} MM TO MONTH is ${actionWord} than ${prevYear} by ${Math.abs(diff).toLocaleString('en-US', {minimumFractionDigits:0})}</p>
            </div>
        `;
        rainfallWrapper.appendChild(summaryWrapper);
    }
};
