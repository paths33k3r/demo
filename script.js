window.state = window.state || {};
const state = window.state;

// HTML-escape for user/DB free text (gang names, block ids) before innerHTML.
const sEsc = (s) => window.escapeHtml(s);

// =====================================================================
// script.js — main application (Phase 9 split in progress).
// The login shell lives in app_boot.js (which sets window._fb and
// calls window.runMainApplication after login); user management lives
// in app_user_mgmt.js. Everything below still shares one closure.
// =====================================================================
const runMainApplication = () => {
    const { auth, db } = window._fb;
        // App State
        Object.assign(state, {
            reports: {}, // { "2025": [ { block_id, ha, op_year, gang }, ... ] }
            performance: {}, // { "2025": { "Jan": { "DARSO GANG": { manpower: 17, leave: 0, blocks: { "15": { budget: 56.34, r1: 33.38, r2: 10.51, r3: 20.07, manday: 56 } } } } } } }
            ffbBudget: null, // initialized later
            rainfall: null, // initialized later
            gangsByYear: {}, // { "2025": ["DARSO GANG", ...], "2026": [...] }
            maintenance: {}, // { "2026": { activityTypes, gangs:{}, entries:[] } } — loaded from shared/maintenance_data
            wages: {}, // { "2026": { penaltyPerBunch, gangs:{} } } — loaded from shared/wages_data
            wagesLedger: {}, // { "2026": { "APR": { harvester:[], driverLoader:[], jobcard:[] } } } — loaded from shared/wages_ledger_data
            selectedReportYear: null,
            activeViewType: 'report_year',
            activeViewValue: null,
            activePerfMonth: null // Used when activeViewType === 'perf_month'
        });

        // Predefined Gang Assignments
        const predefinedGangs = {
            "YUVENTUS UN GANG": ["1", "3", "14"],
            "DARSO GANG": ["15", "16", "17", "19", "20", "21", "22"],
            "YUDI GANG -previously ERDI GANG": ["2", "11", "29"],
            "SOFIO MODENTUS MISSA GANG - previously SERAN": ["4", "5", "6", "7", "23", "24"],
            "NU AZANI GANG": ["8", "9", "12", "10", "13", "18"],
            "WENDERLINUS GANG": ["25", "26A", "27", "28", "30", "31", "33", "39"]
        };



        const getGangForBlock = (blockId) => {
            for (const [gang, blocks] of Object.entries(predefinedGangs)) {
                if (blocks.includes(blockId)) return gang;
            }
            return "Unassigned";
        };

        // =====================================================================
        // =====================================================================
        // USER MANAGEMENT & ROLES — extracted to app_user_mgmt.js (Phase 9)
        // =====================================================================
        const {
            loadUserRole, applyRolePermissions, renderUserManagementPanel,
            checkFirstLogin, autoBackupCheck, setupActivityBackupListener,
            syncBackupSettingsFromFirebase, renderBackupSettingsPanel, triggerBackup
        } = window._initUserMgmt({ auth, db });
        // END USER MANAGEMENT
        // =====================================================================

        const getPeakManpowerForGang = (year, month, gangName) => {
            if (!state.performance[year] || !state.performance[year][month] || !state.performance[year][month][gangName]) return 0;
            const gangData = state.performance[year][month][gangName];
            if (!gangData.blocks) return 0;

            // Days 1..31
            const dailyTotals = new Array(31).fill(0);

            Object.values(gangData.blocks).forEach(blockPerf => {
                if (blockPerf.days && Array.isArray(blockPerf.days)) {
                    blockPerf.days.forEach((day, index) => {
                        if (index < 31) {
                            const val = parseFloat(day.hpVal) || 0;
                            dailyTotals[index] += val;
                        }
                    });
                }
            });

            const peak = Math.max(...dailyTotals);
            return peak > 0 ? peak : 0;
        };

        const saveState = (silent = false) => {
            if (!auth.currentUser) return;
            try {
                db.ref('shared/app_state').set(JSON.stringify(state))
                    .then(() => {
                        window.dispatchEvent(new CustomEvent('harvesting:activity'));
                        if (!silent) {
                            window.notify("Data saved successfully to cloud!", 'success');
                            if (typeof window.logAudit === 'function') {
                                const sec = state.activeViewType || 'harvesting';
                                const yr = state.activeViewValue || state.selectedReportYear || '';

                                // Diff rainfall data if that's the active section
                                let details = '';
                                let changeLines = [];
                                if (sec === 'rainfall_record' && yr && state.rainfall && state.rainfall[yr]) {
                                    const diffs = window._auditDiff(`rainfall_${yr}`, state.rainfall[yr]);
                                    diffs.forEach(d => {
                                        changeLines.push(`${d.path}: ${d.before} → ${d.after}`);
                                    });
                                    // Update snapshot after save
                                    window._auditSnapshot(`rainfall_${yr}`, state.rainfall[yr]);
                                }
                                details = changeLines.length ? changeLines.join(', ') : '';

                                window.logAudit('save', sec, `Year ${yr}`, details);
                            }
                        }
                    })
                    .catch(e => {
                        console.error("Firebase save error:", e);
                        if (!silent) window.notify("Failed to save data. Please check console for errors.", 'error');
                    });
            } catch (e) {
                console.error("Error saving state:", e);
                if (!silent) window.notify("Failed to save data completely.", 'error');
            }
        };
        window.saveState = saveState;

        // ── Audit log ─────────────────────────────────────────────────────────
        window._auditDb = db;

        // Snapshots: take a copy of section data when it's opened so we can diff on save
        window._auditSnapshots = {};
        window._auditSnapshot = function (key, data) {
            window._auditSnapshots[key] = JSON.stringify(data);
        };
        window._auditDiff = function (key, currentData) {
            const prev = window._auditSnapshots[key];
            if (!prev) return [];
            try {
                const prevObj = JSON.parse(prev);
                const currObj = typeof currentData === 'object' ? currentData : JSON.parse(currentData);
                const changes = [];
                function walk(p, c, path) {
                    if (typeof p !== 'object' || typeof c !== 'object' || p === null || c === null) {
                        if (p !== c) changes.push({ path, before: p, after: c });
                        return;
                    }
                    const keys = new Set([...Object.keys(p), ...Object.keys(c)]);
                    keys.forEach(k => walk(p[k], c[k], path ? `${path}.${k}` : k));
                }
                walk(prevObj, currObj, '');
                return changes;
            } catch (e) { return []; }
        };

        window.logAudit = function (action, section, target, details = '', before = null, after = null) {
            if (!auth.currentUser) return;
            const entry = {
                ts: Date.now(),
                user: auth.currentUser.email || auth.currentUser.uid,
                action,
                section,
                target: target || '',
                details: details || '',
            };
            if (before !== null) entry.before = typeof before === 'string' ? before : JSON.stringify(before);
            if (after  !== null) entry.after  = typeof after  === 'string' ? after  : JSON.stringify(after);
            db.ref('shared/audit_log').push(entry).catch(e => console.warn('Audit log write error:', e));

            // Purge entries older than 12 months (only run occasionally)
            if (Math.random() < 0.05) {
                const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
                db.ref('shared/audit_log').orderByChild('ts').endAt(cutoff).once('value', snap => {
                    snap.forEach(child => child.ref.remove());
                });
            }
        };
        // ─────────────────────────────────────────────────────────────────────

        // DOM Elements
        const tableBody = document.getElementById('table-body');
        const tableGrandTotal = document.getElementById('table-grand-total');
        const headerGrandTotal = document.getElementById('header-grand-total');
        const loadingEl = document.getElementById('loading');
        const tableContainer = document.getElementById('table-container');

        const sidebarYearList = document.getElementById('sidebar-year-list');
        const sidebarGangList = document.getElementById('sidebar-gang-list');
        const tableTitle = document.getElementById('table-title');
        const colHeaderGrouping = document.getElementById('col-header-grouping');
        const mainReportWrapper = document.getElementById('main-report-wrapper');

        // Performance and Interval DOM Elements
        const perfWrapper = document.getElementById('performance-wrapper');
        const intervalWrapper = document.getElementById('interval-wrapper');
        const ffbWrapper = document.getElementById('ffb-budget-wrapper');
        const rainfallWrapper = document.getElementById('rainfall-wrapper');

        // Expose db for render_spraying.js and render_ironhorse.js
        window._sprayingDb = db;
        window._ironHorseDb = db;
        window._sprayingUid = auth.currentUser ? auth.currentUser.uid : null;
        auth.onAuthStateChanged(u => {
            window._sprayingUid = u ? u.uid : null;
        });

        // Chart instances keyed by gang name
        const performanceChartInstances = {};

        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        const formatHA = (num) => Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const getActiveBlocks = () => {
            const blocks = state.reports[state.selectedReportYear] || [];
            if (state.activeViewType === 'gang') {
                return blocks.filter(b => b.gang === state.activeViewValue);
            }
            return blocks;
        };

        const getGroupedBlocks = (blocks) => {
            const groups = {};
            // Even in Gang view, the user typically wants to see the blocks grouped by O/P year
            const groupProp = 'op_year';
            blocks.forEach(block => {
                const key = block[groupProp] || "Unassigned";
                if (!groups[key]) groups[key] = [];
                groups[key].push(block);
            });
            return groups;
        };

        // Recalculates totals and updates DOM
        const recalculateTotals = () => {
            const blocks = getActiveBlocks();
            const total = blocks.reduce((sum, b) => sum + b.ha, 0);

            const formattedTotal = formatHA(total);
            if (tableGrandTotal) tableGrandTotal.textContent = formattedTotal;
            if (headerGrandTotal) headerGrandTotal.textContent = formattedTotal + ' HA';

            // Update group subtotals in the DOM 
            const groups = getGroupedBlocks(blocks);
            // We have to iterate the actual DOM array to map to `subtotal-${groupIdx}`
            const groupKeys = Object.keys(groups).sort((a, b) => parseInt(a) - parseInt(b));
            groupKeys.forEach((groupKey, idx) => {
                const subtotalEl = document.getElementById(`subtotal-${idx}`);
                if (subtotalEl) {
                    const subTotal = groups[groupKey].reduce((sum, b) => sum + b.ha, 0);
                    subtotalEl.textContent = formatHA(subTotal);
                }
            });
        };


        const handleGlobalAddBlock = () => {
            if (!state.selectedReportYear) {
                window.notify("No report year available", 'warn');
                return;
            }

            if (state.activeViewType === 'gang') {
                const targetBlockId = prompt(`Enter the Block Number to assign to Gang '${state.activeViewValue}':`);
                if (!targetBlockId) return;

                const blockToAssign = state.reports[state.selectedReportYear].find(b => b.block_id === targetBlockId.trim());

                if (!blockToAssign) {
                    window.notify(`Block '${targetBlockId.trim()}' not found in Report Year ${state.selectedReportYear}. Please add it to the Planting Phase Record first.`, 'error');
                    return;
                }

                blockToAssign.gang = state.activeViewValue;

            } else {
                const targetOpYear = prompt("Enter the Planting Phase Year (O/P) for this new block:");
                if (!targetOpYear) return;

                const newBlock = {
                    block_id: "New Block " + Math.floor(Math.random() * 1000),
                    ha: 0,
                    op_year: targetOpYear.trim(),
                    gang: "Unassigned"
                };
                state.reports[state.selectedReportYear].push(newBlock);
            }

            renderTable();
            recalculateTotals();
        };

        const handleDeleteYear = () => {
            if (!state.selectedReportYear) return;

            const isAdmin = confirm("Admin Check: Are you sure you are authorized to bulk delete?");
            if (!isAdmin) return;

            const confirmDelete = confirm(`WARNING: Are you sure you want to permanently delete ALL data for Report Year ${state.selectedReportYear}?`);
            if (!confirmDelete) return;

            if (typeof window.logAudit === 'function') {
                window.logAudit('delete', 'harvesting', `Year ${state.selectedReportYear}`, 'Bulk delete of entire report year');
            }
            delete state.reports[state.selectedReportYear];

            const remainingYears = Object.keys(state.reports).sort((a, b) => parseInt(a) - parseInt(b));
            if (remainingYears.length > 0) {
                state.selectedReportYear = remainingYears[remainingYears.length - 1];
                state.activeViewType = 'report_year';
                state.activeViewValue = state.selectedReportYear;
            } else {
                state.selectedReportYear = null;
                state.activeViewType = 'report_year';
                state.activeViewValue = null;
            }

            renderSidebar();
            renderTable();
            recalculateTotals();
        };

        const handleImportExcel = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                // Sheet selection: auto-detect harvesting interval sheet, let user confirm or override
                const sheetNames = workbook.SheetNames;
                let sheetsToImport = [];

                // Auto-detect: look for sheet whose row 2 starts with GANG / YEAR / BLOCK / HA
                const isIntervalSheet = (name) => {
                    try {
                        const ws = workbook.Sheets[name];
                        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true });
                        for (let r = 0; r <= Math.min(5, rows.length - 1); r++) {
                            const row = rows[r];
                            if (row && String(row[0] || '').trim().toUpperCase() === 'GANG' &&
                                String(row[2] || '').trim().toUpperCase().startsWith('BLOCK')) {
                                return true;
                            }
                        }
                    } catch (e) { /* ignore */ }
                    return false;
                };

                const detectedIndices = sheetNames.reduce((acc, name, idx) => {
                    if (isIntervalSheet(name)) acc.push(idx);
                    return acc;
                }, []);

                if (sheetNames.length === 1) {
                    sheetsToImport = [sheetNames[0]];
                } else {
                    const sheetList = sheetNames.map((name, idx) => {
                        const tag = detectedIndices.includes(idx) ? ' ✓ (harvesting data detected)' : '';
                        return `${idx + 1}. ${name}${tag}`;
                    }).join('\n');

                    const defaultChoice = detectedIndices.length > 0 ? String(detectedIndices[0] + 1) : '1';
                    const sheetChoice = prompt(
                        `This file has ${sheetNames.length} worksheets:\n${sheetList}\n\nEnter a sheet number to import (✓ = harvesting data detected):`,
                        defaultChoice
                    );
                    if (!sheetChoice) { e.target.value = ''; return; }
                    const sheetIndex = parseInt(sheetChoice.trim()) - 1;
                    if (isNaN(sheetIndex) || sheetIndex < 0 || sheetIndex >= sheetNames.length) {
                        window.notify("Invalid sheet selection. Import cancelled.", 'error');
                        e.target.value = '';
                        return;
                    }
                    sheetsToImport = [sheetNames[sheetIndex]];
                }

                // Ask user for target month and year when importing this interval data
                const importTargetStr = prompt("Which month and year are you importing this data for? (e.g., Mar 2026)", "Mar 2026");
                if (!importTargetStr) {
                    window.notify("Import cancelled. Month and Year is required to assign interval performance data.", 'warn');
                    return;
                }

                const [monthStr, yearStr] = importTargetStr.trim().split(" ");
                if (!monthStr || !yearStr) {
                    window.notify("Import cancelled. Please enter a valid Month and Year format (e.g., Mar 2026).", 'warn');
                    return;
                }

                const targetMonth = monthStr.charAt(0).toUpperCase() + monthStr.slice(1).toLowerCase();
                const targetYear = yearStr;

                // Ensure we have a report year to add to
                if (!state.reports[targetYear]) {
                    handleAddReportYearManual(targetYear);
                }

                // Initialize performance state
                state.performance[targetYear] = state.performance[targetYear] || {};
                state.performance[targetYear][targetMonth] = state.performance[targetYear][targetMonth] || { gangAssignments: {} };

                // In the provided sample, row 3 (index 2) has headers: 'GANG', 'YEAR', 'BLOCK', 'HA', 1, 2...
                // Data actually starts from row 5 (index 4)
                let currentGang = "Unassigned";
                const newBlocks = [];

                // Helper: parse a single sheet's rows into newBlocks
                const parseSheetData = (excelData) => {
                    if (!excelData || excelData.length < 4) return;
                    for (let i = 4; i < excelData.length; i++) {
                        const row = excelData[i];
                        if (!row || row.length === 0) continue;

                        const gangCol = row[0];
                        if (gangCol && typeof gangCol === 'string' && gangCol.trim() !== '') {
                            currentGang = gangCol.trim();
                        }

                        const yearCol = row[1];
                        const blockCol = row[2];
                        const haCol = row[3];

                        if (yearCol && blockCol) {
                            const parsedYear = String(yearCol).trim();
                            if (parsedYear) {
                                const blockId = String(blockCol).trim();
                                const haValue = parseFloat(haCol) || 0;
                                const manpowerRow = (i + 1 < excelData.length) ? excelData[i + 1] : [];
                                const daysData = [];
                                for (let d = 0; d < 31; d++) {
                                    const roundVal = row[4 + d];
                                    const hpVal = manpowerRow[4 + d];
                                    daysData.push({
                                        roundVal: roundVal != null ? String(roundVal).trim() : "",
                                        hpVal: hpVal != null ? String(hpVal).trim() : ""
                                    });
                                }
                                const totalManday = parseFloat(row[35]) || 0;
                                const r1 = parseFloat(row[36]) || 0;
                                const r2 = parseFloat(row[38]) || 0;
                                const r3 = parseFloat(row[40]) || 0;
                                const r4 = parseFloat(row[42]) || 0;

                                newBlocks.push({
                                    block_id: blockId, ha: haValue, op_year: parsedYear, gang: currentGang,
                                    days: daysData, manday: totalManday, r1, r2, r3, r4
                                });
                                state.performance[targetYear][targetMonth].gangAssignments[blockId] = currentGang;
                            }
                        }
                    }
                };

                // Parse all selected sheets
                sheetsToImport.forEach(sheetName => {
                    const ws = workbook.Sheets[sheetName];
                    const excelData = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true });
                    parseSheetData(excelData);
                });

                if (newBlocks.length === 0) {
                    window.notify("No valid data found in the Excel file format.", 'error');
                    return;
                }

                // Select the target year in the UI as the active year
                state.selectedReportYear = targetYear;

                // Check if existing data exists for this month and offer to overwrite
                const existingMonthData = state.performance[targetYear]?.[targetMonth];
                const hasExistingGangData = existingMonthData && Object.keys(existingMonthData).some(k => k !== 'gangAssignments');
                if (hasExistingGangData) {
                    const shouldOverwrite = confirm(
                        `Existing data found for ${targetMonth} ${targetYear}.\n\nClick OK to OVERWRITE (clears old data first).\nClick Cancel to MERGE (adds/updates blocks, keeps others).`
                    );
                    if (shouldOverwrite) {
                        state.performance[targetYear][targetMonth] = { gangAssignments: {} };
                    }
                }

                // Merge/overwrite imported gangs with existing blocks.
                // DOES NOT inject new blocks into Planting Phase Records.
                newBlocks.forEach(importedBlock => {
                    // Also update the performance data for the specific block in the target month
                    const gangName = importedBlock.gang;
                    if (!state.performance[targetYear][targetMonth][gangName]) {
                        state.performance[targetYear][targetMonth][gangName] = { manpower: 0, leave: 0, blocks: {} };
                    }

                    const pBlocks = state.performance[targetYear][targetMonth][gangName].blocks;
                    pBlocks[importedBlock.block_id] = {
                        ha: importedBlock.ha,
                        budget: pBlocks[importedBlock.block_id]?.budget || 0,
                        manday: importedBlock.manday,
                        r1: importedBlock.r1,
                        r2: importedBlock.r2,
                        r3: importedBlock.r3,
                        r4: importedBlock.r4,
                        days: importedBlock.days
                    };
                    // Always update gangAssignments so the renderer finds the correct gang key
                    state.performance[targetYear][targetMonth].gangAssignments[importedBlock.block_id] = gangName;
                });

                // After importing blocks, calculate and set peak manpower for all gangs in this month
                Object.keys(state.performance[targetYear][targetMonth]).forEach(key => {
                    if (key !== 'gangAssignments') {
                        const gangPerf = state.performance[targetYear][targetMonth][key];
                        if (!gangPerf.isManpowerManual) {
                            const peak = getPeakManpowerForGang(targetYear, targetMonth, key);
                            gangPerf.manpower = peak;
                        }
                    }
                });

                // Reset input so the same file can be triggered again if needed
                e.target.value = '';

                // Switch view to the newly imported interval
                state.activeViewType = 'interval_month';
                state.activePerfMonth = targetMonth;

                if (typeof window.logAudit === 'function') {
                    window.logAudit('import', 'harvesting', `${targetMonth} ${targetYear}`, `File: ${file.name} — ${newBlocks.length} blocks imported`);
                }
                // Update UI
                window.notify(`Successfully imported ${newBlocks.length} blocks!`, 'success');
                renderSidebar();
                renderTable();
                recalculateTotals();
                saveState(true);
            };
            reader.readAsArrayBuffer(file);
        };



        const handleImportFfbBudget = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                const excelData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                if (excelData.length < 2) {
                    window.notify("Excel file does not contain enough data rows.", 'error');
                    return;
                }

                const importYear = prompt("Enter the year for this FFB Budget import (e.g., 2026):", state.selectedReportYear || "2026");
                if (!importYear) {
                    window.notify("Import cancelled. Year is required.", 'warn');
                    return;
                }

                if (!state.ffbBudget) state.ffbBudget = {};
                state.ffbBudget[importYear] = [];

                // Format:
                // Row 0: Headers (BLK, AGE (MTH), HARVEST YR., etc.)
                // Row N: "SUBTOTAL OP2010" (in first column)
                // Row N+1: "1", "168-180", 11.00, etc.

                let currentPhase = "Unassigned";

                for (let i = 1; i < excelData.length; i++) {
                    const row = excelData[i];
                    if (!row || row.length < 1) continue;

                    const firstColRaw = String(row[0] || "").trim();
                    if (!firstColRaw) continue;

                    // Check for Subtotal/Phase row
                    const isSubtotal = firstColRaw.toUpperCase().startsWith("SUBTOTAL");
                    if (isSubtotal) {
                        // Extract phase name e.g. "SUBTOTAL OP2010" -> "OP2010"
                        currentPhase = firstColRaw.substring(8).trim();
                        continue;
                    }

                    // If it's not a subtotal, treat it as a block row.
                    // We need at least enough columns for block, age, harvest yr, mt/ha/yr, mt/ha/mth, ha, and jan
                    if (row.length < 7) continue;

                    const blockId = firstColRaw;
                    const ageMth = row[1] != null ? String(row[1]).trim() : "";
                    const harvestYr = parseFloat(row[2]) || 0;
                    const mtHaYr = parseFloat(row[3]) || 0;
                    const mtHaMth = parseFloat(row[4]) || 0;
                    const ha = parseFloat(row[5]) || 0;

                    const months = [];
                    for (let m = 0; m < 12; m++) {
                        months.push(parseFloat(row[6 + m]) || 0);
                    }

                    state.ffbBudget[importYear].push({
                        phase: currentPhase,
                        block_id: blockId,
                        ageMth,
                        harvestYr,
                        mtHaYr,
                        mtHaMth,
                        ha,
                        months
                    });
                }

                e.target.value = '';
                if (typeof window.logAudit === 'function') {
                    window.logAudit('import', 'ffb_budget', `Year ${importYear}`, `File: ${file.name} — ${state.ffbBudget[importYear].length} blocks imported`);
                }
                window.notify(`Successfully imported ${state.ffbBudget[importYear].length} blocks for year ${importYear}!`, 'success');

                // Switch view if it was FFB Budget already
                if (state.activeViewType === 'ffb_budget') {
                    state.activeViewValue = importYear;
                    renderTable();
                }
                saveState(true);
            };
            reader.readAsArrayBuffer(file);
        };

        // Helper for manual import if needed (removed per user request - layout hardcoded directly)

        const handleAddReportYearManual = (newYearStr) => {
            const newYear = newYearStr.trim();
            if (state.reports[newYear]) return;
            state.reports[newYear] = [];
            state.gangsByYear[newYear] = state.gangsByYear[state.selectedReportYear] ? JSON.parse(JSON.stringify(state.gangsByYear[state.selectedReportYear])) : [];
            state.selectedReportYear = newYear;
            state.activeViewType = 'report_year';
            state.activeViewValue = newYear;
            saveState(true);
        };

        const handleAddReportYear = (e) => {
            console.log("handleAddReportYear triggered");
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            const newYearStr = prompt("Enter the new Report Year (e.g., 2026):");
            if (!newYearStr || newYearStr.trim() === "") return;
            const newYear = newYearStr.trim();

            if (state.reports[newYear]) {
                window.notify(`Report Year ${newYear} already exists!`, 'warn');
                return;
            }

            // Clone current year data if exists, otherwise empty
            const sourceData = state.reports[state.selectedReportYear] || [];
            state.reports[newYear] = JSON.parse(JSON.stringify(sourceData));

            const sourceGangs = state.gangsByYear[state.selectedReportYear] || [];
            state.gangsByYear[newYear] = JSON.parse(JSON.stringify(sourceGangs));

            // Initialize empty rainfall data for the new year
            if (!state.rainfall) state.rainfall = {};
            if (!state.rainfall[newYear]) {
                if (typeof createEmptyRainfallYear === 'function') {
                    state.rainfall[newYear] = createEmptyRainfallYear();
                } else {
                    state.rainfall[newYear] = {};
                    const monthsArr = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
                    monthsArr.forEach(m => state.rainfall[newYear][m] = { days: 0, mm: 0 });
                }
            }

            state.selectedReportYear = newYear;
            state.activeViewType = 'report_year';
            state.activeViewValue = newYear;

            renderSidebar();
            renderTable();
            recalculateTotals();
        };

        const handleDuplicateGangYear = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            const years = Object.keys(state.reports).sort((a, b) => parseInt(b) - parseInt(a));
            const sourceYear = state.selectedReportYear && state.reports[state.selectedReportYear] ?
                state.selectedReportYear : (years.length > 0 ? years[0] : null);

            if (!sourceYear) {
                window.notify("No existing year found to duplicate from.", 'warn');
                return;
            }

            const newYearStr = prompt(`Duplicate gangs from Year ${sourceYear} to new Year (e.g., 2026):`);
            if (!newYearStr || newYearStr.trim() === "") return;
            const newYear = newYearStr.trim();

            if (state.reports[newYear]) {
                window.notify(`Year ${newYear} already exists!`, 'warn');
                return;
            }

            // Deep copy
            state.reports[newYear] = JSON.parse(JSON.stringify(state.reports[sourceYear]));
            state.gangsByYear[newYear] = JSON.parse(JSON.stringify(state.gangsByYear[sourceYear] || []));

            state.selectedReportYear = newYear;
            state.activeViewType = 'report_year';
            state.activeViewValue = newYear;

            renderSidebar();
            renderTable();
            recalculateTotals();
        };

        // ── Harvesting Gang management (shared by the overview page) ──────
        const renameGang = (year, gang) => {
            const newName = prompt(`Rename gang '${gang}' in Year ${year}:`);
            if (!newName || !newName.trim() || newName.trim() === gang) return;
            const trimmedName = newName.trim();
            const blocks = state.reports[year] || [];
            blocks.forEach(b => { if (b.gang === gang) b.gang = trimmedName; });
            const gIdx = (state.gangsByYear[year] || []).indexOf(gang);
            if (gIdx > -1) state.gangsByYear[year][gIdx] = trimmedName;
            if (state.performance[year]) {
                Object.keys(state.performance[year]).forEach(m => {
                    const mData = state.performance[year][m];
                    if (mData.gangAssignments) {
                        Object.keys(mData.gangAssignments).forEach(bId => {
                            if (mData.gangAssignments[bId] === gang) mData.gangAssignments[bId] = trimmedName;
                        });
                    }
                    if (mData[gang]) { mData[trimmedName] = mData[gang]; delete mData[gang]; }
                });
            }
            if (state.activeViewType === 'gang' && state.activeViewValue === gang && state.selectedReportYear === year) {
                state.activeViewValue = trimmedName;
            }
            if (typeof window.logAudit === 'function') window.logAudit('update', 'gangs', `Renamed "${gang}" → "${trimmedName}" — Year ${year}`, '');
            saveState(true);
            renderGangOverview();
            renderSidebar();
            renderTable();
            recalculateTotals();
        };

        const removeGang = (year, gang) => {
            if (!confirm(`WARNING: Remove Gang '${gang}' from Year ${year}? This will return all blocks in this gang to 'Unassigned' (it will NOT delete the planting phase data).`)) return;
            if (typeof window.logAudit === 'function') window.logAudit('delete', 'gangs', `Gang "${gang}" — Year ${year}`, 'Gang removed; blocks returned to Unassigned');
            const blocks = state.reports[year] || [];
            blocks.forEach(b => { if (b.gang === gang) b.gang = 'Unassigned'; });
            state.gangsByYear[year] = (state.gangsByYear[year] || []).filter(g => g !== gang);
            if (state.performance[year]) {
                Object.keys(state.performance[year]).forEach(m => {
                    const mData = state.performance[year][m];
                    if (mData.gangAssignments) {
                        Object.keys(mData.gangAssignments).forEach(bId => {
                            if (mData.gangAssignments[bId] === gang) mData.gangAssignments[bId] = 'Unassigned';
                        });
                    }
                    if (mData[gang]) delete mData[gang];
                });
            }
            if (state.activeViewType === 'gang' && state.activeViewValue === gang && state.selectedReportYear === year) {
                state.activeViewType = 'gang_overview';
            }
            saveState(true);
            renderGangOverview();
            renderSidebar();
            renderTable();
            recalculateTotals();
        };

        const renderGangOverview = () => {
            const wrapper = document.getElementById('gang-overview-wrapper');
            if (!wrapper) return;
            wrapper.innerHTML = '';

            const years = Object.keys(state.reports).sort((a, b) => parseInt(a) - parseInt(b));
            if (years.length === 0) {
                wrapper.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--text-secondary);">No report years yet. Add a year first.</div>`;
                return;
            }
            let year = state.selectedReportYear;
            if (!year || !state.reports[year]) { year = years[years.length - 1]; state.selectedReportYear = year; }

            const canEdit = (typeof window._canEdit === 'function') ? window._canEdit('gangs') : true;
            const blocks = state.reports[year] || [];
            const gangs = (state.gangsByYear[year] || []).slice().sort();

            const toolbar = document.createElement('div');
            toolbar.style.cssText = 'display:flex; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom:1.25rem;';
            toolbar.innerHTML = `
                <h2 style="margin:0; font-size:1.15rem; color:var(--text-primary);">Harvesting Gangs — ${year}</h2>
                <label style="font-size:0.85rem; color:var(--text-secondary); margin-left:auto;">Year</label>
                <select id="go-year" class="edit-input" style="padding:0.4rem 0.6rem;">
                    ${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}
                </select>
                ${canEdit ? `<button id="go-add-gang" class="btn-primary" style="padding:0.45rem 0.9rem;"><span>➕</span> Add Gang</button>
                             <button id="go-dup-year" class="btn-secondary" style="padding:0.45rem 0.9rem;" title="Create a new year by duplicating this year's gangs &amp; blocks">📋 Add Year (Duplicate)</button>` : ''}
            `;
            wrapper.appendChild(toolbar);

            const tableWrap = document.createElement('div');
            tableWrap.style.cssText = 'overflow-x:auto;';

            const enc = (s) => encodeURIComponent(s);
            const unassigned = blocks.filter(b => !b.gang || b.gang === 'Unassigned');
            const unaHa = unassigned.reduce((s, b) => s + (Number(b.ha) || 0), 0);

            if (gangs.length === 0) {
                tableWrap.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--text-secondary); border:1px dashed var(--border-color); border-radius:8px;">No gangs for ${year} yet.${canEdit ? ' Click <strong>➕ Add Gang</strong>.' : ''}</div>`;
            } else {
                let rows = '';
                gangs.forEach(g => {
                    const gb = blocks.filter(b => b.gang === g);
                    const ha = gb.reduce((s, b) => s + (Number(b.ha) || 0), 0);
                    rows += `<tr>
                        <td class="go-open" data-gang="${enc(g)}" style="font-weight:600; cursor:pointer;">${sEsc(g)}</td>
                        <td style="text-align:center;">${gb.length}</td>
                        <td style="text-align:right;">${formatHA(ha)}</td>
                        <td style="text-align:right; white-space:nowrap;">
                            ${canEdit ? `<span class="go-rename" data-gang="${enc(g)}" title="Rename" style="cursor:pointer; padding:2px 6px;">✏️</span>
                                         <span class="go-delete" data-gang="${enc(g)}" title="Delete" style="cursor:pointer; padding:2px 6px;">🗑️</span>` : ''}
                            <span class="go-open" data-gang="${enc(g)}" title="Open blocks" style="cursor:pointer; padding:2px 6px; color:var(--accent-color, #2563eb);">▶</span>
                        </td>
                    </tr>`;
                });
                tableWrap.innerHTML = `
                <table class="report-table" style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr>
                            <th style="text-align:left;">Gang</th>
                            <th style="text-align:center;">Blocks</th>
                            <th style="text-align:right;">Total HA</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                        ${unassigned.length ? `<tr style="color:var(--text-secondary);">
                            <td class="go-open" data-gang="${enc('Unassigned')}" style="font-style:italic; cursor:pointer;">Unassigned</td>
                            <td style="text-align:center;">${unassigned.length}</td>
                            <td style="text-align:right;">${formatHA(unaHa)}</td>
                            <td style="text-align:right;"><span class="go-open" data-gang="${enc('Unassigned')}" title="Open blocks" style="cursor:pointer; padding:2px 6px;">▶</span></td>
                        </tr>` : ''}
                    </tbody>
                </table>`;
            }
            wrapper.appendChild(tableWrap);

            const yearSel = document.getElementById('go-year');
            if (yearSel) yearSel.onchange = () => { state.selectedReportYear = yearSel.value; renderGangOverview(); };

            wrapper.querySelectorAll('.go-open').forEach(el => {
                el.onclick = (e) => {
                    e.stopPropagation();
                    const g = decodeURIComponent(el.dataset.gang);
                    state.selectedReportYear = year;
                    state.activeViewType = 'gang';
                    state.activeViewValue = g;
                    renderSidebar();
                    renderTable();
                    recalculateTotals();
                };
            });

            if (canEdit) {
                const addBtn = document.getElementById('go-add-gang');
                if (addBtn) addBtn.onclick = () => {
                    const name = prompt(`Enter new Gang name for Year ${year}:`);
                    if (name && name.trim()) {
                        const t = name.trim();
                        if (!state.gangsByYear[year]) state.gangsByYear[year] = [];
                        if (!state.gangsByYear[year].includes(t)) state.gangsByYear[year].push(t);
                        if (typeof window.logAudit === 'function') window.logAudit('add', 'gangs', `Gang "${t}" — Year ${year}`, '');
                        saveState(true);
                        renderGangOverview();
                        renderSidebar();
                    }
                };
                const dupBtn = document.getElementById('go-dup-year');
                if (dupBtn) dupBtn.onclick = (e) => handleDuplicateGangYear(e);
                wrapper.querySelectorAll('.go-rename').forEach(el => {
                    el.onclick = (e) => { e.stopPropagation(); renameGang(year, decodeURIComponent(el.dataset.gang)); };
                });
                wrapper.querySelectorAll('.go-delete').forEach(el => {
                    el.onclick = (e) => { e.stopPropagation(); removeGang(year, decodeURIComponent(el.dataset.gang)); };
                });
            }
        };

        // ── Generic main-panel selector (replaces nested year/month dropdown menus) ──
        const SELECTOR_CONFIG = {
            interval_month:  { title: 'Harvesting Interval',          monthBased: true,  menuKey: 'performance', yearsFrom: 'reports' },
            perf_month:      { title: 'Harvester Performance Chart',  monthBased: true,  menuKey: 'performance', yearsFrom: 'reports' },
            current_prev:    { title: 'Current vs Previous Month',    monthBased: true,  menuKey: 'performance', yearsFrom: 'reports' },
            ytd:             { title: 'Harvesting YTD',               monthBased: true,  menuKey: 'performance', yearsFrom: 'reports' },
            rainfall_record: { title: 'Rainfall Record',             monthBased: false, menuKey: 'rainfall',    yearsFrom: 'rainfall' },
            ffb_budget:      { title: 'FFB Budget Estimate',         monthBased: false, menuKey: 'ffbBudget',   yearsFrom: 'ffbBudget' }
        };

        const selectorYearsFor = (src) => {
            let obj = {};
            if (src === 'reports') obj = state.reports || {};
            else if (src === 'rainfall') obj = state.rainfall || {};
            else if (src === 'ffbBudget') obj = state.ffbBudget || {};
            return Object.keys(obj).filter(k => /^\d{4}$/.test(k)).sort((a, b) => parseInt(a) - parseInt(b));
        };

        const selectorAddYear = (cfg) => {
            const newYearStr = prompt(`Enter the new ${cfg.title} Year (e.g., 2027):`);
            if (!newYearStr || !newYearStr.trim()) return null;
            const newYear = newYearStr.trim();
            if (cfg.yearsFrom === 'reports') {
                window.notify('Add report years from the Planting Phase Record menu.', 'info');
                return null;
            } else if (cfg.yearsFrom === 'rainfall') {
                if (!state.rainfall) state.rainfall = {};
                if (state.rainfall[newYear]) { window.notify(`Rainfall Record for ${newYear} already exists!`, 'warn'); return null; }
                if (typeof createEmptyRainfallYear === 'function') state.rainfall[newYear] = createEmptyRainfallYear();
                else state.rainfall[newYear] = {};
            } else if (cfg.yearsFrom === 'ffbBudget') {
                if (!state.ffbBudget) state.ffbBudget = {};
                if (state.ffbBudget[newYear]) { window.notify(`FFB Budget Year ${newYear} already exists!`, 'warn'); return null; }
                const existing = Object.keys(state.ffbBudget).filter(k => /^\d{4}$/.test(k)).sort((a, b) => parseInt(a) - parseInt(b));
                state.ffbBudget[newYear] = existing.length ? JSON.parse(JSON.stringify(state.ffbBudget[existing[existing.length - 1]])) : [];
            }
            saveState(true);
            return newYear;
        };

        const openSelectorTarget = (target, year, month) => {
            const cfg = SELECTOR_CONFIG[target];
            state.selectedReportYear = year;
            state.activeViewType = target;
            if (cfg && cfg.monthBased) {
                state.activePerfMonth = month;
            } else {
                state.activeViewValue = year;
            }
            renderSidebar();
            renderTable();
            if (typeof recalculateTotals === 'function') recalculateTotals();
        };

        const renderSelectorView = () => {
            const wrapper = document.getElementById('selector-wrapper');
            if (!wrapper) return;
            wrapper.innerHTML = '';

            const target = state.selectorTarget || state.activeViewValue;
            const cfg = SELECTOR_CONFIG[target];
            if (!cfg) { wrapper.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--text-secondary);">Unknown view.</div>`; return; }

            const canEdit = (typeof window._canEdit === 'function') ? window._canEdit(cfg.menuKey) : true;
            const years = selectorYearsFor(cfg.yearsFrom);

            state._selectorYear = state._selectorYear || {};
            let year = state._selectorYear[target] || state.selectedReportYear;
            if (!year || !years.includes(year)) year = years.length ? years[years.length - 1] : '';
            state._selectorYear[target] = year;

            const addYearBtnHtml = (canEdit && cfg.yearsFrom !== 'reports')
                ? `<button id="sel-add-year" class="btn-secondary" style="padding:0.45rem 0.9rem;"><span>➕</span> Add Year</button>` : '';

            // Toolbar
            const toolbar = document.createElement('div');
            toolbar.style.cssText = 'display:flex; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom:1.25rem;';
            toolbar.innerHTML = `
                <h2 style="margin:0; font-size:1.15rem; color:var(--text-primary);">${cfg.title}${year ? ' — ' + year : ''}</h2>
                ${years.length ? `<label style="font-size:0.85rem; color:var(--text-secondary); margin-left:auto;">Year</label>
                <select id="sel-year" class="edit-input" style="padding:0.4rem 0.6rem;">
                    ${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}
                </select>` : '<span style="margin-left:auto;"></span>'}
                ${addYearBtnHtml}
            `;
            wrapper.appendChild(toolbar);

            if (!years.length) {
                const msg = document.createElement('div');
                msg.style.cssText = 'padding:2rem; text-align:center; color:var(--text-secondary); border:1px dashed var(--border-color); border-radius:8px;';
                msg.innerHTML = (cfg.yearsFrom === 'reports')
                    ? 'No report years yet. Add a year from the Planting Phase Record menu.'
                    : `No years yet.${canEdit ? ' Click <strong>➕ Add Year</strong>.' : ''}`;
                wrapper.appendChild(msg);
            } else if (cfg.monthBased) {
                // Month grid
                const grid = document.createElement('div');
                grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:0.75rem;';
                months.forEach(m => {
                    const hasData = !!(state.performance && state.performance[year] && state.performance[year][m]);
                    const card = document.createElement('div');
                    card.className = 'sel-month-card';
                    card.dataset.month = m;
                    card.style.cssText = `position:relative; cursor:pointer; user-select:none; padding:0.9rem 0.75rem; border-radius:8px; text-align:center; font-weight:600;
                        border:1px solid ${hasData ? 'var(--accent-color, #2563eb)' : 'var(--border-color)'};
                        background:${hasData ? 'rgba(37,99,235,0.08)' : 'var(--bg-secondary, #f8fafc)'};
                        color:var(--text-primary);`;
                    card.innerHTML = `
                        <div style="font-size:1.05rem;">${m}</div>
                        <div style="font-size:0.72rem; font-weight:500; margin-top:0.25rem; color:${hasData ? 'var(--accent-color, #2563eb)' : 'var(--text-secondary)'};">${hasData ? '● has data' : 'no data'}</div>
                        <span class="sel-month-newtab" data-month="${m}" title="Open in new tab" style="position:absolute; top:4px; right:6px; font-size:0.8rem; color:var(--text-secondary); padding:2px;">↗</span>
                    `;
                    grid.appendChild(card);
                });
                wrapper.appendChild(grid);

                grid.querySelectorAll('.sel-month-card').forEach(card => {
                    card.onclick = () => openSelectorTarget(target, year, card.dataset.month);
                });
                grid.querySelectorAll('.sel-month-newtab').forEach(el => {
                    el.onclick = (e) => {
                        e.stopPropagation();
                        const hash = `#view=${target}&year=${year}&month=${encodeURIComponent(el.dataset.month)}`;
                        window.open(window.location.pathname + hash, '_blank');
                    };
                });
            } else {
                // Year-only: render the actual report table inline, directly below the toolbar.
                // The report wrappers (ffb-budget-wrapper / rainfall-wrapper) live elsewhere in the
                // DOM, so relocate the matching one to sit right after the selector wrapper.
                state.selectedReportYear = year;   // renderRainfallTable reads this
                state.activeViewValue = year;      // renderFfbBudgetTable reads this

                let reportWrapper = null;
                if (target === 'ffb_budget') {
                    reportWrapper = document.getElementById('ffb-budget-wrapper');
                    if (reportWrapper) {
                        wrapper.insertAdjacentElement('afterend', reportWrapper);
                        reportWrapper.classList.remove('hidden');
                        if (typeof renderFfbBudgetTable === 'function') renderFfbBudgetTable();
                    }
                } else if (target === 'rainfall_record') {
                    reportWrapper = document.getElementById('rainfall-wrapper');
                    if (reportWrapper) {
                        wrapper.insertAdjacentElement('afterend', reportWrapper);
                        reportWrapper.classList.remove('hidden');
                        if (typeof renderRainfallTable === 'function') renderRainfallTable();
                        const rfYear = year;
                        if (rfYear && state.rainfall && state.rainfall[rfYear] && typeof window._auditSnapshot === 'function') {
                            window._auditSnapshot(`rainfall_${rfYear}`, state.rainfall[rfYear]);
                        }
                    }
                }
                if (reportWrapper && typeof window._applyReadOnly === 'function') {
                    window._applyReadOnly(reportWrapper, cfg.menuKey);
                }
            }

            const yearSel = document.getElementById('sel-year');
            if (yearSel) yearSel.onchange = () => { state._selectorYear[target] = yearSel.value; renderSelectorView(); };

            const addYearBtn = document.getElementById('sel-add-year');
            if (addYearBtn) addYearBtn.onclick = () => {
                const ny = selectorAddYear(cfg);
                if (ny) { state._selectorYear[target] = ny; renderSelectorView(); renderSidebar(); }
            };
        };

        // Year-selector bar for the Planting Phase Record (report_year view).
        // The main report renders inline into #main-report-wrapper, so instead of
        // routing it through the selector view we inject a matching toolbar card
        // (reusing #selector-wrapper) directly above the report.
        const renderPlantingYearBar = () => {
            const wrapper = document.getElementById('selector-wrapper');
            const mainW = document.getElementById('main-report-wrapper');
            if (!wrapper || !mainW) return;
            wrapper.innerHTML = '';

            const years = Object.keys(state.reports || {}).filter(k => /^\d{4}$/.test(k)).sort((a, b) => parseInt(a) - parseInt(b));
            if (!years.length) { wrapper.classList.add('hidden'); return; }

            let year = state.selectedReportYear;
            if (!year || !years.includes(year)) { year = years[years.length - 1]; state.selectedReportYear = year; }
            const canEdit = (typeof window._canEdit === 'function') ? window._canEdit('planting') : true;

            const toolbar = document.createElement('div');
            toolbar.style.cssText = 'display:flex; align-items:center; flex-wrap:wrap; gap:0.75rem;';
            toolbar.innerHTML = `
                <h2 style="margin:0; font-size:1.15rem; color:var(--text-primary);">Planting Phase Record — ${year}</h2>
                <label style="font-size:0.85rem; color:var(--text-secondary); margin-left:auto;">Year</label>
                <select id="pl-year" class="edit-input" style="padding:0.4rem 0.6rem;">
                    ${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}
                </select>
                ${canEdit ? `<button id="pl-add-year" class="btn-secondary" style="padding:0.45rem 0.9rem;"><span>➕</span> Add Year</button>` : ''}
            `;
            wrapper.appendChild(toolbar);

            // Position the bar directly above the main report card.
            mainW.insertAdjacentElement('beforebegin', wrapper);
            wrapper.classList.remove('hidden');

            const ySel = document.getElementById('pl-year');
            if (ySel) ySel.onchange = () => {
                state.selectedReportYear = ySel.value;
                state.activeViewType = 'report_year';
                state.activeViewValue = ySel.value;
                renderSidebar();
                renderTable();
                if (typeof recalculateTotals === 'function') recalculateTotals();
            };
            const addBtn = document.getElementById('pl-add-year');
            if (addBtn && typeof handleAddReportYear === 'function') addBtn.onclick = handleAddReportYear;
        };

        const renderSidebar = () => {
            // Handle Sidebar Header styling
            const navHeaderBudget = document.getElementById('nav-header-budget');
            const navHeaderYear = document.getElementById('nav-header-year');
            const navHeaderGangYear = document.getElementById('nav-header-gang-year');
            const navHeaderInterval = document.getElementById('nav-header-interval');
            const navHeaderPerf = document.getElementById('nav-header-perf');

            if (navHeaderBudget) navHeaderBudget.style.color = state.activeViewType === 'ffb_budget' ? 'var(--text-primary)' : '';
            if (navHeaderYear) navHeaderYear.style.color = state.activeViewType === 'report_year' ? 'var(--text-primary)' : '';
            if (navHeaderGangYear) navHeaderGangYear.style.color = state.activeViewType === 'gang' ? 'var(--text-primary)' : '';
            if (navHeaderInterval) navHeaderInterval.style.color = state.activeViewType === 'interval_month' ? 'var(--text-primary)' : '';
            if (navHeaderPerf) navHeaderPerf.style.color = state.activeViewType === 'perf_month' ? 'var(--text-primary)' : '';

            const navHeaderYtd = document.getElementById('nav-header-ytd');
            const navHeaderCurrentPrev = document.getElementById('nav-header-current-prev');
            if (navHeaderYtd) navHeaderYtd.style.color = state.activeViewType === 'ytd' ? 'var(--text-primary)' : '';
            if (navHeaderCurrentPrev) navHeaderCurrentPrev.style.color = state.activeViewType === 'current_prev' ? 'var(--text-primary)' : '';

            // Render Report Years
            if (sidebarYearList) {
                sidebarYearList.innerHTML = '';
                const reportYears = Object.keys(state.reports).sort((a, b) => parseInt(a) - parseInt(b));

                reportYears.forEach(year => {
                    const li = document.createElement('li');
                    li.className = 'nav-item';
                    if (state.activeViewType === 'report_year' && state.activeViewValue === year) {
                        li.classList.add('active');
                    }

                    const a = document.createElement('a');
                    a.href = '#';
                    a.className = 'nav-link';
                    a.textContent = year;
                    a.dataset.viewHash = `#view=report_year&year=${year}`;
                    a.onclick = (e) => {
                        e.preventDefault();
                        state.selectedReportYear = year;
                        state.activeViewType = 'report_year';
                        state.activeViewValue = year;
                        renderSidebar();
                        renderTable();
                        recalculateTotals();
                    };
                    li.appendChild(a);
                    sidebarYearList.appendChild(li);
                });

                const liAdd = document.createElement('li');
                liAdd.className = 'nav-item';
                const aAdd = document.createElement('a');
                aAdd.href = '#';
                aAdd.className = 'nav-link add-year-link';
                aAdd.innerHTML = `<span style="margin-right:0.5rem;">➕</span> Add Year`;
                aAdd.onclick = handleAddReportYear;
                liAdd.appendChild(aAdd);
                sidebarYearList.appendChild(liAdd);
            }

            // Render Gangs (Grouped by Year)
            const sidebarGangYearList = document.getElementById('sidebar-gang-year-list');
            if (sidebarGangYearList) {
                sidebarGangYearList.innerHTML = '';

                const reportYears = Object.keys(state.reports).sort((a, b) => parseInt(a) - parseInt(b));

                reportYears.forEach(year => {
                    const liYear = document.createElement('li');
                    liYear.className = 'nav-item';

                    // Keep the year open if we are currently viewing something inside it
                    const isOpen = state.selectedReportYear === year ? 'open' : '';

                    const divYearHeader = document.createElement('div');
                    divYearHeader.className = `nav-item-header has-children ${isOpen}`;
                    divYearHeader.innerHTML = `<span class="nav-label">${year}</span><span class="nav-chevron">▼</span>`;

                    const ulGangs = document.createElement('ul');
                    ulGangs.className = 'nav-submenu';

                    const blocks = state.reports[year] || [];
                    // Use persistent gang list for the year
                    const gangs = (state.gangsByYear[year] || []).sort();

                    // Helper for rendering edit/delete icons in Gang list
                    const createActionIcon = (text, className, onClick) => {
                        const span = document.createElement('span');
                        span.className = `sidebar-mini-icon ${className}`;
                        span.innerHTML = text;
                        span.style.cursor = 'pointer';
                        span.style.fontSize = '0.9em';
                        span.style.padding = '2px 4px';
                        span.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onClick();
                        };
                        return span;
                    };

                    gangs.forEach(gang => {
                        const liGang = document.createElement('li');
                        liGang.className = 'nav-item';
                        if (state.activeViewType === 'gang' && state.activeViewValue === gang && state.selectedReportYear === year) {
                            liGang.classList.add('active');
                        }

                        const a = document.createElement('a');
                        a.href = '#';
                        a.className = 'nav-link';
                        a.dataset.viewHash = `#view=gang&year=${year}&gang=${encodeURIComponent(gang)}`;

                        a.style.display = 'flex';
                        a.style.justifyContent = 'space-between';
                        a.style.alignItems = 'center';

                        const labelSpan = document.createElement('span');
                        labelSpan.textContent = gang;
                        a.appendChild(labelSpan);

                        const actionDiv = document.createElement('div');
                        actionDiv.style.display = 'flex';
                        actionDiv.style.gap = '0.5rem';

                        actionDiv.appendChild(createActionIcon('✏️', 'edit-gang', () => {
                            const newName = prompt(`Rename gang '${gang}' in Year ${year}:`);
                            if (newName && newName.trim() !== "" && newName.trim() !== gang) {
                                const trimmedName = newName.trim();
                                // Update reports
                                blocks.forEach(b => {
                                    if (b.gang === gang) b.gang = trimmedName;
                                });
                                // Update persistent gang list
                                const gIdx = state.gangsByYear[year].indexOf(gang);
                                if (gIdx > -1) state.gangsByYear[year][gIdx] = trimmedName;

                                // Update performance data if exists
                                if (state.performance[year]) {
                                    Object.keys(state.performance[year]).forEach(m => {
                                        const mData = state.performance[year][m];
                                        if (mData.gangAssignments) {
                                            Object.keys(mData.gangAssignments).forEach(bId => {
                                                if (mData.gangAssignments[bId] === gang) mData.gangAssignments[bId] = trimmedName;
                                            });
                                        }
                                        if (mData[gang]) {
                                            mData[trimmedName] = mData[gang];
                                            delete mData[gang];
                                        }
                                    });
                                }
                                if (state.activeViewType === 'gang' && state.activeViewValue === gang && state.selectedReportYear === year) {
                                    state.activeViewValue = trimmedName;
                                }
                                renderSidebar();
                                renderTable();
                            }
                        }));

                        actionDiv.appendChild(createActionIcon('🗑️', 'delete-gang', () => {
                            if (confirm(`WARNING: Remove Gang '${gang}' from Year ${year}? This will return all blocks in this gang to 'Unassigned' (it will NOT delete the planting phase data).`)) {
                                if (typeof window.logAudit === 'function') {
                                    window.logAudit('delete', 'gangs', `Gang "${gang}" — Year ${year}`, 'Gang removed; blocks returned to Unassigned');
                                }
                                // Non-destructive: Just unassign blocks
                                blocks.forEach(b => {
                                    if (b.gang === gang) b.gang = "Unassigned";
                                });

                                // Remove from persistent gang list
                                state.gangsByYear[year] = state.gangsByYear[year].filter(g => g !== gang);

                                // Update performance data
                                if (state.performance[year]) {
                                    Object.keys(state.performance[year]).forEach(m => {
                                        const mData = state.performance[year][m];
                                        if (mData.gangAssignments) {
                                            Object.keys(mData.gangAssignments).forEach(bId => {
                                                if (mData.gangAssignments[bId] === gang) mData.gangAssignments[bId] = "Unassigned";
                                            });
                                        }
                                        if (mData[gang]) delete mData[gang];
                                    });
                                }

                                if (state.activeViewType === 'gang' && state.activeViewValue === gang && state.selectedReportYear === year) {
                                    state.activeViewType = 'report_year';
                                    state.activeViewValue = year;
                                }
                                renderSidebar();
                                renderTable();
                                recalculateTotals();
                            }
                        }));

                        a.appendChild(actionDiv);

                        a.onclick = (e) => {
                            if (e.target !== a && e.target !== labelSpan) return;
                            e.preventDefault();
                            state.selectedReportYear = year; // switching year contextualizes the gang
                            state.activeViewType = 'gang';
                            state.activeViewValue = gang;
                            renderSidebar();
                            renderTable();
                            recalculateTotals();
                        };
                        liGang.appendChild(a);
                        ulGangs.appendChild(liGang);
                    });

                    // Add Gang button tailored for THIS specific year
                    const liAddGang = document.createElement('li');
                    liAddGang.className = 'nav-item';
                    const aAddGang = document.createElement('a');
                    aAddGang.href = '#';
                    aAddGang.className = 'nav-link add-year-link';
                    aAddGang.innerHTML = `<span style="margin-right:0.5rem;">➕</span> Add Gang`;
                    aAddGang.onclick = (e) => {
                        e.stopPropagation();
                        const newGang = prompt(`Enter new Gang name for Year ${year}:`);
                        if (newGang && newGang.trim()) {
                            const trimmed = newGang.trim();
                            if (!state.gangsByYear[year]) state.gangsByYear[year] = [];
                            if (!state.gangsByYear[year].includes(trimmed)) {
                                state.gangsByYear[year].push(trimmed);
                            }
                            state.selectedReportYear = year;
                            state.activeViewType = 'gang';
                            state.activeViewValue = trimmed;
                            renderSidebar();
                            renderTable();
                            recalculateTotals();
                        }
                    };
                    liAddGang.appendChild(aAddGang);
                    ulGangs.appendChild(liAddGang);

                    liYear.appendChild(divYearHeader);
                    liYear.appendChild(ulGangs);

                    sidebarGangYearList.appendChild(liYear);
                });

                // Add Year (Duplicate) link rendered at the end of the year list
                const liAddYear = document.createElement('li');
                liAddYear.className = 'nav-item';
                const aAddYear = document.createElement('a');
                aAddYear.href = '#';
                aAddYear.id = 'global-add-year-gang-btn';
                aAddYear.className = 'nav-link add-year-link';
                aAddYear.style.borderTop = '1px solid var(--border-color)';
                aAddYear.style.marginTop = '0.5rem';
                aAddYear.innerHTML = `<span style="margin-right:0.5rem;">➕</span> Add Year (Duplicate)`;
                aAddYear.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDuplicateGangYear(e);
                };
                liAddYear.appendChild(aAddYear);
                sidebarGangYearList.appendChild(liAddYear);
            }

            // (Per-activity Gantt shortcuts removed — the sidebar now has a single
            //  Field Maintenance → Gantt Chart link; activities are chosen with the
            //  Gantt view's own activity filter.)


            // Render Performance Navigation
            const renderMonthNav = (containerId, targetViewType) => {
                const container = document.getElementById(containerId);
                if (!container) return;
                container.innerHTML = '';
                const reportYears = Object.keys(state.reports).sort((a, b) => parseInt(a) - parseInt(b));

                reportYears.forEach(year => {
                    const liYear = document.createElement('li');
                    liYear.className = 'nav-item';

                    const isYearOpen = (state.activeViewType === targetViewType && state.selectedReportYear === year) ? 'open' : '';

                    const divYearHeader = document.createElement('div');
                    divYearHeader.className = `nav-item-header has-children ${isYearOpen}`;
                    divYearHeader.innerHTML = `<span class="nav-label">${year}</span><span class="nav-chevron">▼</span>`;

                    const ulMonthsContainer = document.createElement('div');
                    ulMonthsContainer.className = 'nav-submenu';
                    ulMonthsContainer.style.padding = '0.5rem 1rem';

                    const selectMonth = document.createElement('select');
                    selectMonth.className = 'month-dropdown';
                    selectMonth.style.width = '100%';
                    selectMonth.style.padding = '0.4rem';
                    selectMonth.style.borderRadius = '4px';
                    selectMonth.style.border = '1px solid var(--border-color)';
                    selectMonth.style.background = 'var(--bg-secondary)';
                    selectMonth.style.color = 'var(--text-primary)';
                    selectMonth.style.outline = 'none';

                    const defaultOpt = document.createElement('option');
                    defaultOpt.value = '';
                    defaultOpt.textContent = 'Select Month...';
                    if (!state.activePerfMonth || state.selectedReportYear !== year || state.activeViewType !== targetViewType) {
                        defaultOpt.selected = true;
                    }
                    selectMonth.appendChild(defaultOpt);

                    months.forEach(month => {
                        const opt = document.createElement('option');
                        opt.value = month;
                        opt.textContent = month;
                        if (state.activeViewType === targetViewType && state.selectedReportYear === year && state.activePerfMonth === month) {
                            opt.selected = true;
                        }
                        selectMonth.appendChild(opt);
                    });

                    selectMonth.onchange = (e) => {
                        e.stopPropagation();
                        const selectedMonth = e.target.value;
                        if (selectedMonth) {
                            state.selectedReportYear = year;
                            state.activePerfMonth = selectedMonth;
                            state.activeViewType = targetViewType;
                            renderSidebar();
                            renderTable();
                        } else {
                            state.activeViewType = 'report_year';
                            renderSidebar();
                            renderTable();
                        }
                    };

                    const monthNavRow = document.createElement('div');
                    monthNavRow.style.cssText = 'display:flex;align-items:center;gap:4px;';
                    monthNavRow.appendChild(selectMonth);

                    const openTabBtn = document.createElement('button');
                    openTabBtn.title = 'Open in new tab';
                    openTabBtn.textContent = '↗';
                    openTabBtn.style.cssText = 'padding:2px 6px;cursor:pointer;border:1px solid var(--border-color);border-radius:3px;background:var(--bg-secondary);color:var(--text-secondary);font-size:0.85rem;flex-shrink:0;';
                    openTabBtn.onclick = (e) => {
                        e.stopPropagation();
                        const selectedMonth = selectMonth.value;
                        if (selectedMonth) {
                            const hash = `#view=${targetViewType}&year=${year}&month=${encodeURIComponent(selectedMonth)}`;
                            window.open(window.location.pathname + hash, '_blank');
                        } else {
                            window.notify('Please select a month first.', 'warn');
                        }
                    };
                    monthNavRow.appendChild(openTabBtn);

                    ulMonthsContainer.appendChild(monthNavRow);
                    liYear.appendChild(divYearHeader);
                    liYear.appendChild(ulMonthsContainer);
                    container.appendChild(liYear);
                });
            };

            // Render FFB Budget Navigation
            const renderFfbBudgetNav = () => {
                const container = document.getElementById('sidebar-budget-list');
                if (!container) return;
                container.innerHTML = '';

                const ffbYears = state.ffbBudget ?
                    Object.keys(state.ffbBudget)
                        .filter(key => /^\d{4}$/.test(key)) // Only 4-digit years
                        .sort((a, b) => parseInt(a) - parseInt(b)) : [];

                ffbYears.forEach(year => {
                    const li = document.createElement('li');
                    li.className = 'nav-item';
                    if (state.activeViewType === 'ffb_budget' && state.activeViewValue === year) {
                        li.classList.add('active');
                    }

                    const a = document.createElement('a');
                    a.href = '#';
                    a.className = 'nav-link';
                    a.textContent = year;
                    a.dataset.viewHash = `#view=ffb_budget&year=${year}`;
                    a.onclick = (e) => {
                        e.preventDefault();
                        state.selectedReportYear = year;
                        state.activeViewType = 'ffb_budget';
                        state.activeViewValue = year;
                        renderSidebar();
                        renderTable();
                        recalculateTotals();
                    };
                    li.appendChild(a);
                    container.appendChild(li);
                });

                // Add FFB Year Button
                const liAddFfbYear = document.createElement('li');
                liAddFfbYear.className = 'nav-item';
                const aAddFfbYear = document.createElement('a');
                aAddFfbYear.href = '#';
                aAddFfbYear.className = 'nav-link add-year-link';
                aAddFfbYear.innerHTML = `<span style="margin-right:0.5rem;">➕</span> Add Year`;
                aAddFfbYear.onclick = (e) => {
                    if (e) {
                        e.preventDefault();
                        e.stopPropagation();
                    }

                    const newYearStr = prompt("Enter the new FFB Budget Year (e.g., 2027):");
                    if (!newYearStr || newYearStr.trim() === "") return;
                    const newYear = newYearStr.trim();

                    if (state.ffbBudget && state.ffbBudget[newYear]) {
                        window.notify(`FFB Budget Year ${newYear} already exists!`, 'warn');
                        return;
                    }

                    if (!state.ffbBudget) state.ffbBudget = {};

                    // Duplicate last year's data or create empty if none exists
                    const existingYears = Object.keys(state.ffbBudget).sort((a, b) => parseInt(a) - parseInt(b));
                    if (existingYears.length > 0) {
                        const lastYear = existingYears[existingYears.length - 1];
                        state.ffbBudget[newYear] = JSON.parse(JSON.stringify(state.ffbBudget[lastYear]));
                        // Reset amounts to zero for the new year clone? Or keep as requested: "duplicate previous year's data so i could edit it with ease"
                        // We will keep it exactly identical as requested.
                    } else {
                        state.ffbBudget[newYear] = [];
                    }

                    state.selectedReportYear = newYear;
                    state.activeViewType = 'ffb_budget';
                    state.activeViewValue = newYear;

                    renderSidebar();
                    renderTable();
                    recalculateTotals();
                };
                liAddFfbYear.appendChild(aAddFfbYear);
                container.appendChild(liAddFfbYear);
            };
            // Render Rainfall Navigation
            const renderRainfallNav = () => {
                const container = document.getElementById('sidebar-rainfall-list');
                if (!container) return;
                container.innerHTML = '';

                const rfYears = state.rainfall ?
                    Object.keys(state.rainfall)
                        .filter(key => /^\d{4}$/.test(key))
                        .sort((a, b) => parseInt(a) - parseInt(b)) : [];

                rfYears.forEach(year => {
                    const li = document.createElement('li');
                    li.className = 'nav-item';
                    if (state.activeViewType === 'rainfall_record' && state.activeViewValue === year) {
                        li.classList.add('active');
                    }

                    const a = document.createElement('a');
                    a.href = '#';
                    a.className = 'nav-link';
                    a.textContent = year;
                    a.dataset.viewHash = `#view=rainfall_record&year=${year}`;
                    a.onclick = (e) => {
                        e.preventDefault();
                        state.selectedReportYear = year;
                        state.activeViewType = 'rainfall_record';
                        state.activeViewValue = year;
                        renderSidebar();
                        renderTable();
                        recalculateTotals();
                    };
                    li.appendChild(a);
                    container.appendChild(li);
                });

                // Add Rainfall Year Button
                const liAddYear = document.createElement('li');
                liAddYear.className = 'nav-item';
                const aAddYear = document.createElement('a');
                aAddYear.href = '#';
                aAddYear.className = 'nav-link add-year-link';
                aAddYear.innerHTML = `<span style="margin-right:0.5rem;">➕</span> Add Year`;
                aAddYear.onclick = (e) => {
                    if (e) {
                        e.preventDefault();
                        e.stopPropagation();
                    }

                    const newYearStr = prompt("Enter the new Rainfall Year (e.g., 2026):");
                    if (!newYearStr || newYearStr.trim() === "") return;
                    const newYear = newYearStr.trim();

                    if (state.rainfall && state.rainfall[newYear]) {
                        window.notify(`Rainfall Record for ${newYear} already exists!`, 'warn');
                        return;
                    }

                    if (!state.rainfall) state.rainfall = {};

                    // Use the helper from rainfallData.js to construct an empty object
                    if (typeof createEmptyRainfallYear === 'function') {
                        state.rainfall[newYear] = createEmptyRainfallYear();
                    }

                    state.selectedReportYear = newYear;
                    state.activeViewType = 'rainfall_record';
                    state.activeViewValue = newYear;

                    renderSidebar();
                    renderTable();
                    recalculateTotals();
                    saveState(true);
                };
                liAddYear.appendChild(aAddYear);
                container.appendChild(liAddYear);
            };

            renderFfbBudgetNav();
            renderRainfallNav();
            renderMonthNav('sidebar-interval-list', 'interval_month');
            renderMonthNav('sidebar-perf-list', 'perf_month');
            renderMonthNav('sidebar-ytd-list', 'ytd');
            renderMonthNav('sidebar-current-prev-list', 'current_prev');
        };

        // --- Global navigation history (back button) ---
        const _viewSnapshot = () => ({
            type: state.activeViewType,
            value: state.activeViewValue,
            year: state.selectedReportYear,
            ganttFilter: state.maintGanttFilter,
            selectorTarget: state.selectorTarget
        });
        const _sameView = (a, b) => {
            if (!a || !b) return false;
            return a.type === b.type && a.value === b.value &&
                   a.year === b.year && a.ganttFilter === b.ganttFilter &&
                   a.selectorTarget === b.selectorTarget;
        };
        const updateGlobalBackButton = () => {
            const btn = document.getElementById('global-back-btn');
            if (!btn) return;
            const stack = state._navStack || [];
            btn.style.display = stack.length ? '' : 'none';
        };
        if (!Array.isArray(state._navStack)) state._navStack = [];
        const _navBackBtn = document.getElementById('global-back-btn');
        if (_navBackBtn && !_navBackBtn._wired) {
            _navBackBtn._wired = true;
            _navBackBtn.addEventListener('click', () => {
                const stack = state._navStack || [];
                if (!stack.length) return;
                const prev = stack.pop();
                state._navigatingBack = true;
                state.activeViewType = prev.type;
                state.activeViewValue = prev.value;
                if (prev.year != null) state.selectedReportYear = prev.year;
                state.maintGanttFilter = prev.ganttFilter;
                state.selectorTarget = prev.selectorTarget;
                renderSidebar();
                renderTable();
            });
        }

        const renderTable = () => {
            // Record navigation history: push the previous view when the view changes,
            // unless we are currently navigating back.
            const _curView = _viewSnapshot();
            if (state._navigatingBack) {
                state._navigatingBack = false;
            } else if (state._lastView && !_sameView(state._lastView, _curView)) {
                state._navStack = state._navStack || [];
                state._navStack.push(state._lastView);
                if (state._navStack.length > 50) state._navStack.shift();
            }
            state._lastView = _curView;
            updateGlobalBackButton();

            tableBody.innerHTML = '';
            perfWrapper.innerHTML = ''; // Clear dynamically appended performance widgets
            intervalWrapper.innerHTML = ''; // Clear dynamically appended interval widgets
            const ffbWrapper = document.getElementById('ffb-budget-wrapper');
            const rainfallWrapper = document.getElementById('rainfall-wrapper');
            const ytdWrapper = document.getElementById('ytd-wrapper');
            const currentPrevWrapper = document.getElementById('current-prev-wrapper');

            const userMgmtWrapper = document.getElementById('user-mgmt-wrapper');
            const excelReportsWrapper = document.getElementById('excel-reports-wrapper');
            const sprayingWrapper = document.getElementById('spraying-wrapper');
            const manuringWrapper = document.getElementById('manuring-wrapper');
            const maintenanceComingSoonWrapper = document.getElementById('maintenance-coming-soon-wrapper');
            const ihAssetsWrapper    = document.getElementById('ironhorse-assets-wrapper');
            const ihExpensesWrapper  = document.getElementById('ironhorse-expenses-wrapper');
            const ihCostPerHaWrapper = document.getElementById('ironhorse-costperha-wrapper');
            const gangOverviewWrapper = document.getElementById('gang-overview-wrapper');
            const selectorWrapper = document.getElementById('selector-wrapper');
            const dashboardWrapper = document.getElementById('dashboard-wrapper');
            const mntGangsWrapper    = document.getElementById('maintenance-gangs-wrapper');
            const mntWorklogWrapper  = document.getElementById('maintenance-worklog-wrapper');
            const mntGanttWrapper    = document.getElementById('maintenance-gantt-wrapper');
            const weeklyWrapper      = document.getElementById('weekly-activity-wrapper');
            const wagesWrapper       = document.getElementById('wages-wrapper');
            const wagesLedgerWrapper = document.getElementById('wages-ledger-wrapper');
            if (ffbWrapper) ffbWrapper.innerHTML = ''; // Clear FFB budget widgets
            if (rainfallWrapper) rainfallWrapper.innerHTML = ''; // Clear Rainfall widgets
            if (ytdWrapper) ytdWrapper.innerHTML = '';
            if (currentPrevWrapper) currentPrevWrapper.innerHTML = '';
            if (sprayingWrapper) sprayingWrapper.innerHTML = '';
            if (manuringWrapper) manuringWrapper.innerHTML = '';
            if (maintenanceComingSoonWrapper) maintenanceComingSoonWrapper.innerHTML = '';
            if (ihAssetsWrapper)    ihAssetsWrapper.innerHTML = '';
            if (ihExpensesWrapper)  ihExpensesWrapper.innerHTML = '';
            if (ihCostPerHaWrapper) ihCostPerHaWrapper.innerHTML = '';
            if (gangOverviewWrapper) { gangOverviewWrapper.innerHTML = ''; gangOverviewWrapper.classList.add('hidden'); }
            if (selectorWrapper) { selectorWrapper.innerHTML = ''; selectorWrapper.classList.add('hidden'); }
            if (mntGangsWrapper)    { mntGangsWrapper.innerHTML = '';   mntGangsWrapper.classList.add('hidden'); }
            if (mntWorklogWrapper)  { mntWorklogWrapper.innerHTML = ''; mntWorklogWrapper.classList.add('hidden'); }
            if (mntGanttWrapper)    { mntGanttWrapper.innerHTML = '';   mntGanttWrapper.classList.add('hidden'); }
            if (weeklyWrapper)      { weeklyWrapper.innerHTML = '';     weeklyWrapper.classList.add('hidden'); }
            if (wagesWrapper)       { wagesWrapper.innerHTML = '';      wagesWrapper.classList.add('hidden'); }
            if (wagesLedgerWrapper) { wagesLedgerWrapper.innerHTML = ''; wagesLedgerWrapper.classList.add('hidden'); }
            if (userMgmtWrapper) { userMgmtWrapper.innerHTML = ''; userMgmtWrapper.classList.add('hidden'); }
            if (excelReportsWrapper) { excelReportsWrapper.innerHTML = ''; excelReportsWrapper.classList.add('hidden'); }
            const auditLogWrapper = document.getElementById('audit-log-wrapper');
            if (auditLogWrapper) { auditLogWrapper.innerHTML = ''; auditLogWrapper.classList.add('hidden'); }

            // Hide special wrappers by default
            if (ffbWrapper) ffbWrapper.classList.add('hidden');
            if (rainfallWrapper) rainfallWrapper.classList.add('hidden');
            if (ytdWrapper) ytdWrapper.classList.add('hidden');
            if (currentPrevWrapper) currentPrevWrapper.classList.add('hidden');
            const sprayingWrapperEl = document.getElementById('spraying-wrapper');
            const manuringWrapperEl = document.getElementById('manuring-wrapper');
            const maintenanceCSWrapperEl = document.getElementById('maintenance-coming-soon-wrapper');
            if (sprayingWrapperEl) sprayingWrapperEl.classList.add('hidden');
            if (manuringWrapperEl) manuringWrapperEl.classList.add('hidden');
            if (maintenanceCSWrapperEl) maintenanceCSWrapperEl.classList.add('hidden');
            if (ihAssetsWrapper)    ihAssetsWrapper.classList.add('hidden');
            if (ihExpensesWrapper)  ihExpensesWrapper.classList.add('hidden');
            if (ihCostPerHaWrapper) ihCostPerHaWrapper.classList.add('hidden');

            // ── Central view switcher ────────────────────────────────────
            // Hides every switchable view wrapper, shows the target, runs its
            // render fn, then applies read-only gating. Replaces the repeated
            // "hide these four + show one + render + applyReadOnly" boilerplate
            // in the branches below so a new view can't accidentally leave an
            // old panel visible.
            const _switchableWrappers = [
                mainReportWrapper, perfWrapper, intervalWrapper,
                ffbWrapper, rainfallWrapper, ytdWrapper, currentPrevWrapper,
                sprayingWrapper, manuringWrapper, maintenanceComingSoonWrapper,
                ihAssetsWrapper, ihExpensesWrapper, ihCostPerHaWrapper,
                gangOverviewWrapper, selectorWrapper,
                mntGangsWrapper, mntWorklogWrapper, mntGanttWrapper,
                weeklyWrapper, wagesWrapper, wagesLedgerWrapper,
                userMgmtWrapper, excelReportsWrapper, auditLogWrapper,
                dashboardWrapper
            ];
            const showView = (targetEl, renderFn, menuKey) => {
                _switchableWrappers.forEach(w => { if (w && w !== targetEl) w.classList.add('hidden'); });
                tableContainer.classList.add('hidden');
                if (!targetEl) return;
                targetEl.classList.remove('hidden');
                if (typeof renderFn === 'function') renderFn();
                if (menuKey && typeof window._applyReadOnly === 'function') window._applyReadOnly(targetEl, menuKey);
            };

            // Dashboard home
            if (state.activeViewType === 'dashboard') {
                showView(dashboardWrapper, () => {
                    if (typeof window.renderDashboard === 'function') window.renderDashboard();
                });
                return;
            }

            // User Management view
            if (state.activeViewType === 'user_mgmt') {
                showView(userMgmtWrapper, renderUserManagementPanel);
                return;
            }

            // Excel Reports view
            if (state.activeViewType === 'excel_reports') {
                showView(excelReportsWrapper, () => {
                    if (typeof window.renderReportsPanel === 'function') window.renderReportsPanel();
                });
                return;
            }

            // Generic selector landing view (year + month/year picker)
            if (state.activeViewType === 'selector') {
                showView(selectorWrapper, () => {
                    renderSelectorView();
                    const _cfg = SELECTOR_CONFIG[state.selectorTarget || state.activeViewValue];
                    if (_cfg) window._applyReadOnly(selectorWrapper, _cfg.menuKey);
                });
                return;
            }

            const isPerfView = state.activeViewType === 'perf_month';
            const isIntervalView = state.activeViewType === 'interval_month';
            const isHarvestingYtdView = state.activeViewType === 'harvesting_ytd';
            const isHarvestersComparisonView = state.activeViewType === 'harvesters_comparison';

            if (!state.selectedReportYear && !isHarvestingYtdView && !isHarvestersComparisonView) {
                if (tableTitle) tableTitle.textContent = "No Report Year Selected";
                perfWrapper.classList.add('hidden');
                intervalWrapper.classList.add('hidden');
                tableContainer.classList.add('hidden');
                return;
            }

            const isFfbBudgetView = state.activeViewType === 'ffb_budget';
            const isRainfallView = state.activeViewType === 'rainfall_record';
            const isYtdView = state.activeViewType === 'ytd';
            const isCurrentPrevView = state.activeViewType === 'current_prev';

            if (isPerfView) {
                showView(perfWrapper, renderPerformanceTable, 'performance');
            } else if (isIntervalView) {
                showView(intervalWrapper, () => {
                    if (typeof renderIntervalTable === 'function') renderIntervalTable();
                }, 'performance');
            } else if (isFfbBudgetView) {
                showView(ffbWrapper, renderFfbBudgetTable, 'ffbBudget');
            } else if (isRainfallView) {
                showView(rainfallWrapper, () => {
                    if (typeof renderRainfallTable === 'function') renderRainfallTable();
                    // Snapshot rainfall data for this year so we can diff on save
                    const rfYear = state.activeViewValue;
                    if (rfYear && state.rainfall && state.rainfall[rfYear]) {
                        window._auditSnapshot(`rainfall_${rfYear}`, state.rainfall[rfYear]);
                    }
                }, 'rainfall');
            } else if (isYtdView) {
                showView(ytdWrapper, () => {
                    if (typeof renderYtdReport === 'function') renderYtdReport();
                }, 'performance');
            } else if (isCurrentPrevView) {
                showView(currentPrevWrapper, () => {
                    if (typeof renderCurrentPrevReport === 'function') renderCurrentPrevReport();
                }, 'performance');
            } else if (state.activeViewType === 'spraying') {
                showView(sprayingWrapper, () => {
                    if (typeof renderSprayingReport === 'function') renderSprayingReport();
                }, 'maintenance');
            } else if (state.activeViewType === 'manuring') {
                showView(manuringWrapper, () => {
                    if (typeof window.renderManuringReport === 'function') window.renderManuringReport();
                }, 'maintenance');
            } else if (state.activeViewType === 'ironhorse_assets') {
                showView(ihAssetsWrapper, () => {
                    if (typeof renderIronHorseAssets === 'function') renderIronHorseAssets();
                }, 'ironhorse');
            } else if (state.activeViewType === 'ironhorse_expenses') {
                showView(ihExpensesWrapper, () => {
                    if (typeof renderIronHorseExpenses === 'function') renderIronHorseExpenses();
                }, 'ironhorse');
            } else if (state.activeViewType === 'ironhorse_costperha') {
                showView(ihCostPerHaWrapper, () => {
                    if (typeof renderIronHorseCostPerHa === 'function') renderIronHorseCostPerHa();
                }, 'ironhorse');
            } else if (state.activeViewType === 'weekly_activity') {
                showView(weeklyWrapper, () => {
                    if (typeof window.renderWeeklyActivity === 'function') window.renderWeeklyActivity();
                }, 'weekly');
            } else if (state.activeViewType === 'wages') {
                showView(wagesWrapper, () => {
                    if (typeof window.renderWagesView === 'function') window.renderWagesView();
                }, 'wages');
            } else if (state.activeViewType === 'wages_ledger') {
                showView(wagesLedgerWrapper, () => {
                    if (typeof window.renderWagesLedgerView === 'function') window.renderWagesLedgerView();
                }, 'wages');
            } else if (state.activeViewType === 'audit_log') {
                showView(auditLogWrapper, () => {
                    if (typeof window.renderAuditLog === 'function') window.renderAuditLog();
                });
            } else if (state.activeViewType === 'gang_overview') {
                showView(gangOverviewWrapper, renderGangOverview, 'gangs');
            } else if (state.activeViewType === 'maintenance_coming_soon') {
                showView(maintenanceComingSoonWrapper, () => {
                    const label = state.activeViewValue || 'Feature';
                    maintenanceComingSoonWrapper.innerHTML = `
                    <div style="padding:3rem 2rem; text-align:center;">
                        <div style="font-size:4rem; margin-bottom:1rem;">🚧</div>
                        <h2 style="margin-top:0; color:var(--text-primary);">${label}</h2>
                        <p style="color:var(--text-secondary); font-size:1rem;">This feature is under development.<br>Please check back later.</p>
                    </div>
                `;
                });
            } else if (state.activeViewType === 'maintenance_gangs') {
                showView(mntGangsWrapper, () => {
                    if (typeof window.renderMaintenanceGangs === 'function') window.renderMaintenanceGangs();
                });
            } else if (state.activeViewType === 'maintenance_worklog') {
                showView(mntWorklogWrapper, () => {
                    if (typeof window.renderMaintenanceWorkLog === 'function') window.renderMaintenanceWorkLog();
                });
            } else if (state.activeViewType === 'maintenance_gantt') {
                showView(mntGanttWrapper, () => {
                    if (typeof window.renderMaintenanceGantt === 'function') window.renderMaintenanceGantt();
                });
            } else {
                showView(mainReportWrapper);
                tableContainer.classList.remove('hidden');

                const isYearView = state.activeViewType === 'report_year';
                if (isYearView) {
                    renderPlantingYearBar();
                }
                if (tableTitle) {
                    tableTitle.textContent = isYearView
                        ? `Planting Phase (O/P) Breakdown year ${state.activeViewValue}`
                        : `Harvesting Gang: ${state.activeViewValue} (Year ${state.selectedReportYear})`;
                }

                if (colHeaderGrouping) {
                    colHeaderGrouping.textContent = 'O/P'; // Always O/P
                }

                const activeBlocks = getActiveBlocks();
                const groupedBlocks = getGroupedBlocks(activeBlocks);

                const groupKeys = Object.keys(groupedBlocks).sort((a, b) => parseInt(a) - parseInt(b));

                groupKeys.forEach((groupKey, groupIdx) => {
                    const groupBlocks = groupedBlocks[groupKey];

                    // 1. Render Group Header
                    const trHeader = document.createElement('tr');
                    trHeader.className = 'row-group-header';

                    const tdEmpty = document.createElement('td');
                    trHeader.appendChild(tdEmpty);

                    const tdOpLabel = document.createElement('td');
                    tdOpLabel.className = 'cell-op-label';
                    tdOpLabel.textContent = groupKey;
                    trHeader.appendChild(tdOpLabel);

                    const tdSubtotal = document.createElement('td');
                    tdSubtotal.className = 'cell-subtotal';
                    tdSubtotal.id = `subtotal-${groupIdx}`;
                    tdSubtotal.textContent = formatHA(groupBlocks.reduce((s, b) => s + b.ha, 0));
                    trHeader.appendChild(tdSubtotal);

                    const tdEmptyActions = document.createElement('td');
                    trHeader.appendChild(tdEmptyActions);

                    tableBody.appendChild(trHeader);

                    // 2. Render Nested Block Rows
                    groupBlocks.forEach((block, blockIdx) => {
                        const trBlock = document.createElement('tr');
                        trBlock.className = 'row-block' + (blockIdx % 2 ? ' zebra' : '');

                        // Block ID
                        const tdBlockId = document.createElement('td');
                        tdBlockId.className = 'cell-block';
                        const inputBlock = document.createElement('input');
                        inputBlock.className = 'edit-input text-center';
                        inputBlock.value = block.block_id;
                        inputBlock.onchange = (e) => block.block_id = e.target.value;
                        tdBlockId.appendChild(inputBlock);
                        trBlock.appendChild(tdBlockId);

                        // O/P Year Property
                        const tdOpValue = document.createElement('td');
                        tdOpValue.className = 'cell-op';
                        const inputOp = document.createElement('input');
                        inputOp.className = 'edit-input text-center';
                        inputOp.value = block.op_year;
                        inputOp.title = `Edit to re-assign to another O/P Year`;
                        inputOp.onchange = (e) => {
                            const newVal = e.target.value.trim();
                            if (!newVal) return;
                            block.op_year = newVal;
                            renderTable();
                            recalculateTotals();
                        };
                        tdOpValue.appendChild(inputOp);
                        trBlock.appendChild(tdOpValue);

                        // HA Value
                        const tdHaValue = document.createElement('td');
                        const inputHa = document.createElement('input');
                        inputHa.type = 'number';
                        inputHa.className = 'edit-input text-right';
                        inputHa.step = '0.01';
                        inputHa.value = block.ha.toFixed(2);
                        inputHa.oninput = (e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) {
                                block.ha = val;
                                recalculateTotals();
                            }
                        };
                        inputHa.onblur = (e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) e.target.value = val.toFixed(2);
                            else { e.target.value = '0.00'; block.ha = 0; recalculateTotals(); }
                        };
                        tdHaValue.appendChild(inputHa);
                        trBlock.appendChild(tdHaValue);

                        // Actions
                        const tdActions = document.createElement('td');
                        tdActions.className = 'cell-actions';
                        const btnDelete = document.createElement('button');
                        btnDelete.className = 'btn-icon delete';
                        btnDelete.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
                        btnDelete.onclick = () => {
                            if (state.activeViewType === 'gang') {
                                const confirmUnassign = confirm(`Are you sure you want to unassign block ${block.block_id} from gang ${state.activeViewValue}? It will remain in the Planting Phase Record.`);
                                if (!confirmUnassign) return;
                                block.gang = "Unassigned";
                            } else {
                                const confirmDelete = confirm(`WARNING: Are you sure you want to PERMANENTLY delete block ${block.block_id} from the Planting Phase Record for ${state.selectedReportYear}?`);
                                if (!confirmDelete) return;
                                const idx = state.reports[state.selectedReportYear].indexOf(block);
                                if (idx > -1) {
                                    state.reports[state.selectedReportYear].splice(idx, 1);
                                }
                            }
                            renderTable();
                            recalculateTotals();
                            renderSidebar();
                        };
                        tdActions.appendChild(btnDelete);
                        trBlock.appendChild(tdActions);

                        tableBody.appendChild(trBlock);
                    });

                    // 3. Render Spacer relative to group, except for last one
                    if (groupIdx < groupKeys.length - 1) {
                        const trSpacer = document.createElement('tr');
                        trSpacer.className = 'row-spacer';
                        trSpacer.innerHTML = '<td colspan="4"></td>';
                        tableBody.appendChild(trSpacer);
                    }
                });
            }
        };

        const renderPerformanceTable = () => {
            const year = state.selectedReportYear;
            const month = state.activePerfMonth;

            perfWrapper.innerHTML = ''; // Start clean

            // Clear all performance data for this month/year
            const clearMonthBtn = document.createElement('button');
            clearMonthBtn.textContent = `🗑 Clear All Data for ${month} ${year}`;
            clearMonthBtn.style.cssText = 'margin-bottom:1.25rem;padding:0.4rem 0.9rem;font-size:0.8rem;cursor:pointer;background:transparent;border:1px solid var(--danger);color:var(--danger);border-radius:4px;';
            clearMonthBtn.onclick = () => {
                if (!confirm(`Clear ALL performance data for ${month} ${year}?\n\nThis removes all block harvest figures (R1, R2, R3) and gang assignments for this month. This cannot be undone.`)) return;
                if (state.performance[year]) delete state.performance[year][month];
                saveState();
                renderPerformanceTable();
            };
            perfWrapper.appendChild(clearMonthBtn);

            // Ensure state tree
            state.performance[year] = state.performance[year] || {};
            state.performance[year][month] = state.performance[year][month] || {};

            const blocks = state.reports[year] || [];

            // --- 1. Initialize Month-Specific Gang Assignments ---
            // If this month doesn't have a gang map yet, we build one.
            if (!state.performance[year][month].gangAssignments) {

                // Try to find the previous month to inherit from
                const sortedMonths = [...months]; // Jan, Feb, Mar...
                const currentMonthIdx = sortedMonths.indexOf(month);

                let inheritedMap = null;

                if (currentMonthIdx > 0) {
                    // Check previous months in reverse order for an existing map
                    for (let i = currentMonthIdx - 1; i >= 0; i--) {
                        const prevMonth = sortedMonths[i];
                        if (state.performance[year][prevMonth] && state.performance[year][prevMonth].gangAssignments) {
                            // Deep copy the previous month's map
                            inheritedMap = JSON.parse(JSON.stringify(state.performance[year][prevMonth].gangAssignments));
                            break;
                        }
                    }
                }

                if (inheritedMap) {
                    state.performance[year][month].gangAssignments = inheritedMap;
                } else {
                    // Fallback: Build from the year's default state
                    const newMap = {};
                    blocks.forEach(b => {
                        newMap[b.block_id] = b.gang || "Unassigned";
                    });
                    state.performance[year][month].gangAssignments = newMap;
                }
            }

            const monthAssignments = state.performance[year][month].gangAssignments;

            // Extract gangs from the month-specific map, falling back to any new blocks
            const allGangsInMonth = new Set(Object.values(monthAssignments));
            // Also add any gangs from blocks that might be newly added to the year but not mapped yet
            blocks.forEach(b => {
                if (!monthAssignments[b.block_id]) {
                    monthAssignments[b.block_id] = b.gang || "Unassigned";
                    allGangsInMonth.add(b.gang || "Unassigned");
                }
            });

            const gangs = [...allGangsInMonth].filter(b => b && b !== "Unassigned").sort();

            if (gangs.length === 0) {
                perfWrapper.innerHTML = '<p style="padding: 2rem;">No harvesting gangs found for this year. Please assign blocks to gangs first.</p>';
                return;
            }

            gangs.forEach((gangName, gangIndex) => {
                const perfData = state.performance[year][month][gangName] || { manpower: 0, leave: 0, blocks: {} };
                state.performance[year][month][gangName] = perfData;

                // Filter blocks for this specific gang based on the MONTH-SPECIFIC map
                const gBlocks = blocks.filter(b => monthAssignments[b.block_id] === gangName);
                if (gBlocks.length === 0) return; // skip empty gangs

                // Add divider between gangs
                if (gangIndex > 0) {
                    const divider = document.createElement('hr');
                    divider.style.cssText = 'border: none; border-top: 3px solid var(--border-color); margin: 2rem 0;';
                    perfWrapper.appendChild(divider);
                }

                // Create wrapper block for this gang
                const gangWrapper = document.createElement('div');
                // Adding specific bottom margin to separate gangs clearly
                gangWrapper.style.marginBottom = '3rem';
                gangWrapper.style.padding = '0'; // Clean grouping

                const safeGangId = gangName.replace(/[^a-zA-Z0-9]/g, '_');

                gangWrapper.innerHTML = `
                <div class="performance-header" style="display: flex; justify-content: space-between; align-items: flex-end;">
                    <div>
                        <h2>HARVESTER PERFORMANCE CHART FOR THE MONTH OF ${month.toUpperCase()} ${year}</h2>
                        <div class="perf-stats">
                            <div class="stat-row">
                                <label>HARVESTER TEAM:</label>
                                <span class="font-bold">${sEsc(gangName.toUpperCase())}</span>
                            </div>
                            <div class="stat-row" style="display: flex; align-items: center; gap: 0.5rem;">
                                <label>TOTAL MANPOWER:</label>
                                <input type="number" id="perf-manpower-${safeGangId}" class="edit-input" style="width: 80px; padding: 0.25rem; border: 1px solid var(--border-color);" value="${perfData.manpower || 0}" min="0">
                                <button class="btn-icon" id="btn-sync-manpower-${safeGangId}" title="Refresh from Interval data for ${month} ${year}" style="padding: 2px 6px; font-size: 0.8rem; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer;">
                                    🔄 Sync
                                </button>
                                <span id="perf-manpower-badge-${safeGangId}" style="font-size: 0.75rem; color: #f59e0b; font-weight: 600; display: ${perfData.isManpowerManual ? 'inline' : 'none'};" title="Manually set — will not be overridden by Sync or re-import">✏ Manual</span>
                            </div>
                            <div class="stat-row">
                                <label>TOTAL ON LONG LEAVE:</label>
                                <input type="number" id="perf-leave-${safeGangId}" class="edit-input" style="width: 80px; padding: 0.25rem; border: 1px solid var(--border-color);" value="${perfData.leave || 0}" min="0">
                            </div>
                        </div>
                    </div>
                    <div>
                        <button class="btn-primary" id="btn-transfer-${safeGangId}" style="margin-bottom: 0.5rem; font-size: 0.8rem; padding: 0.4rem 0.8rem;">
                            <span>⇄</span> Transfer Block Here
                        </button>
                    </div>
                </div>

                <div class="table-container">
                    <table class="grouped-table" id="perf-table-${safeGangId}">
                        <thead>
                            <tr>
                                <th>Block</th>
                                <th>HA per Block</th>
                                <th>Budget ${year}</th>
                                <th>1st Round (MT)</th>
                                <th>2nd Round (MT)</th>
                                <th>3rd Round (MT)</th>
                                <th class="col-total">Total (MT)</th>
                                <th>Manday</th>
                                <th>MT / Manday</th>
                                <th class="col-actions"></th>
                            </tr>
                        </thead>
                        <tbody id="perf-table-body-${safeGangId}">
                            <!-- Generated by JS -->
                        </tbody>
                        <tfoot>
                            <tr class="row-grand-total">
                                <td colspan="1" class="grand-total-label">Total</td>
                                <td id="pTotalHa-${safeGangId}">0.00</td>
                                <td id="pTotalBudget-${safeGangId}">0.00</td>
                                <td id="pTotalR1-${safeGangId}">0.00</td>
                                <td id="pTotalR2-${safeGangId}">0.00</td>
                                <td id="pTotalR3-${safeGangId}">0.00</td>
                                <td id="pTotalAll-${safeGangId}">0.00</td>
                                <td id="pTotalManday-${safeGangId}">0.00</td>
                                <td id="pTotalMtManday-${safeGangId}">0.00</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div class="perf-dashboard-bottom">
                    <div class="chart-container">
                        <canvas id="performanceChart-${safeGangId}"></canvas>
                    </div>
                    <div class="summary-stats-side">
                        <div class="side-stat-box">
                            <div class="stat-title">MT per person</div>
                            <div class="stat-val" id="statMtPerson-${safeGangId}">0.00</div>
                        </div>
                        <div class="side-stat-box">
                            <div class="stat-title">HA per person</div>
                            <div class="stat-val" id="statHaPerson-${safeGangId}">0.00</div>
                        </div>
                        <div class="side-stat-box">
                            <div class="stat-title">Ratio HA to MT per person</div>
                            <div class="stat-val" id="statRatio-${safeGangId}">0:0</div>
                        </div>
                    </div>
                </div>
            `;

                perfWrapper.appendChild(gangWrapper);

                const perfTableBody = document.getElementById(`perf-table-body-${safeGangId}`);
                const inputManpower = document.getElementById(`perf-manpower-${safeGangId}`);
                const inputLeave = document.getElementById(`perf-leave-${safeGangId}`);
                const manpowerBadge = document.getElementById(`perf-manpower-badge-${safeGangId}`);

                let manpowerSaveTimer = null;
                inputManpower.oninput = (e) => {
                    perfData.manpower = parseFloat(e.target.value) || 0;
                    perfData.isManpowerManual = true;
                    if (manpowerBadge) manpowerBadge.style.display = 'inline';
                    calculatePerformanceTotals(perfData, gBlocks, safeGangId);
                    clearTimeout(manpowerSaveTimer);
                    manpowerSaveTimer = setTimeout(() => saveState(true), 800);
                };
                inputManpower.onchange = () => {
                    clearTimeout(manpowerSaveTimer);
                    saveState(true);
                };

                let leaveSaveTimer = null;
                inputLeave.oninput = (e) => {
                    perfData.leave = parseFloat(e.target.value) || 0;
                    calculatePerformanceTotals(perfData, gBlocks, safeGangId);
                    clearTimeout(leaveSaveTimer);
                    leaveSaveTimer = setTimeout(() => saveState(true), 800);
                };
                inputLeave.onchange = () => {
                    clearTimeout(leaveSaveTimer);
                    saveState(true);
                };

                const btnSync = document.getElementById(`btn-sync-manpower-${safeGangId}`);
                if (btnSync) {
                    btnSync.onclick = () => {
                        const peak = getPeakManpowerForGang(year, month, gangName);
                        perfData.manpower = peak;
                        perfData.isManpowerManual = false;
                        inputManpower.value = peak;
                        if (manpowerBadge) manpowerBadge.style.display = 'none';
                        calculatePerformanceTotals(perfData, gBlocks, safeGangId);
                        saveState(true);
                    };
                }

                const btnTransfer = document.getElementById(`btn-transfer-${safeGangId}`);
                if (btnTransfer) {
                    btnTransfer.onclick = () => {
                        const blockId = prompt(`Enter Block ID to transfer to ${gangName} for ${month} ${year}:`);
                        if (!blockId) return;

                        const blockToTransfer = blocks.find(b => b.block_id === blockId.trim());
                        if (!blockToTransfer) {
                            window.notify(`Block '${blockId}' not found in Year ${year}. Cannot transfer block.`, 'error');
                            return;
                        }

                        // Reassign just for this month
                        monthAssignments[blockToTransfer.block_id] = gangName;

                        // Add this gang to the master list if it somehow wasn't (edge case)
                        if (!allGangsInMonth.has(gangName)) allGangsInMonth.add(gangName);

                        renderPerformanceTable();
                    };
                }

                const createPerfInput = (bData, field, onChange) => {
                    const td = document.createElement('td');
                    const input = document.createElement('input');
                    input.type = 'number';
                    input.className = 'edit-input text-right';
                    input.step = '0.01';
                    input.value = (bData[field] || 0).toFixed(2);
                    input.oninput = (e) => {
                        const parsed = parseFloat(e.target.value) || 0;
                        onChange(parsed);
                        calculatePerformanceTotals(perfData, gBlocks, safeGangId);
                    };
                    input.onblur = (e) => { e.target.value = (parseFloat(e.target.value) || 0).toFixed(2); };
                    td.appendChild(input);
                    return td;
                };

                gBlocks.forEach(block => {
                    const bId = block.block_id;
                    if (!perfData.blocks[bId]) {
                        perfData.blocks[bId] = { budget: 0, r1: 0, r2: 0, r3: 0, manday: 0 };
                    }
                    const bData = perfData.blocks[bId];

                    // Dynamically sync FFB Budget for current month
                    const monthIndex = months.indexOf(month);
                    if (state.ffbBudget && state.ffbBudget[year]) {
                        // Try to find matching block budget. FFB rows might have 'block_id' or 'block'
                        const ffbRow = state.ffbBudget[year].find(r => String(r.block_id).trim() === String(bId).trim());
                        if (ffbRow && ffbRow.months && ffbRow.months.length > monthIndex) {
                            bData.budget = ffbRow.months[monthIndex] || 0;
                        }
                    }

                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td class="text-center cell-block">${sEsc(bId)}</td><td class="text-right">${formatHA(block.ha)}</td>`;

                    // createPerfInput handles input logic. If linked, any manual edits here are volatile until next render, serving purely as a temporary view if they don't want to use FFB structure.
                    tr.appendChild(createPerfInput(bData, 'budget', (v) => bData.budget = v));
                    tr.appendChild(createPerfInput(bData, 'r1', (v) => bData.r1 = v));
                    tr.appendChild(createPerfInput(bData, 'r2', (v) => bData.r2 = v));
                    tr.appendChild(createPerfInput(bData, 'r3', (v) => bData.r3 = v));

                    const tdTotal = document.createElement('td');
                    tdTotal.className = 'text-right font-bold col-total';
                    tdTotal.id = `perf-row-total-${safeGangId}-${bId}`;
                    tdTotal.textContent = formatHA(bData.r1 + bData.r2 + bData.r3);
                    tr.appendChild(tdTotal);

                    tr.appendChild(createPerfInput(bData, 'manday', (v) => bData.manday = v));

                    const tdMtManday = document.createElement('td');
                    tdMtManday.className = 'text-right font-bold';
                    tdMtManday.id = `perf-row-mt-${safeGangId}-${bId}`;
                    const totalRound = bData.r1 + bData.r2 + bData.r3;
                    tdMtManday.textContent = bData.manday > 0 ? (totalRound / bData.manday).toFixed(2) : "0.00";
                    tr.appendChild(tdMtManday);

                    // Delete (Remove from Gang) Actions
                    const tdActions = document.createElement('td');
                    tdActions.className = 'cell-actions';
                    const btnRemove = document.createElement('button');
                    btnRemove.className = 'btn-icon delete';
                    btnRemove.title = `Remove block from ${gangName} for ${month} ${year}`;
                    btnRemove.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
                    btnRemove.onclick = () => {
                        const confirmRemove = confirm(`Are you sure you want to remove block ${bId} from ${gangName} for this month only?`);
                        if (!confirmRemove) return;

                        monthAssignments[bId] = "Unassigned";
                        renderPerformanceTable();
                    };
                    tdActions.appendChild(btnRemove);
                    tr.appendChild(tdActions);

                    perfTableBody.appendChild(tr);
                });

                calculatePerformanceTotals(perfData, gBlocks, safeGangId);

                if (typeof renderIHExpensesForGang === 'function') {
                    renderIHExpensesForGang(gangWrapper, gangName, String(year), month);
                }
            });
        };

        const calculatePerformanceTotals = (perfData, blocks, safeGangId) => {
            let tHa = 0, tBudget = 0, tR1 = 0, tR2 = 0, tR3 = 0, tTotal = 0, tManday = 0;

            blocks.forEach(block => {
                const bId = block.block_id;
                const bData = perfData.blocks[bId];
                if (bData) {
                    tHa += block.ha;
                    tBudget += bData.budget;
                    tR1 += bData.r1;
                    tR2 += bData.r2;
                    tR3 += bData.r3;

                    const rowTotal = bData.r1 + bData.r2 + bData.r3;
                    tTotal += rowTotal;
                    tManday += bData.manday;

                    const rowTotalEl = document.getElementById(`perf-row-total-${safeGangId}-${bId}`);
                    const rowMtEl = document.getElementById(`perf-row-mt-${safeGangId}-${bId}`);

                    if (rowTotalEl) {
                        rowTotalEl.textContent = formatHA(rowTotal);
                        if (parseFloat(bData.budget) > 0 && rowTotal < parseFloat(bData.budget)) {
                            rowTotalEl.classList.add('text-danger-important');
                        } else {
                            rowTotalEl.classList.remove('text-danger-important');
                        }
                    }
                    if (rowMtEl) rowMtEl.textContent = bData.manday > 0 ? (rowTotal / bData.manday).toFixed(2) : "0.00";
                }
            });

            const pTotalHa = document.getElementById(`pTotalHa-${safeGangId}`);
            const pTotalBudget = document.getElementById(`pTotalBudget-${safeGangId}`);
            const pTotalR1 = document.getElementById(`pTotalR1-${safeGangId}`);
            const pTotalR2 = document.getElementById(`pTotalR2-${safeGangId}`);
            const pTotalR3 = document.getElementById(`pTotalR3-${safeGangId}`);
            const pTotalAll = document.getElementById(`pTotalAll-${safeGangId}`);
            const pTotalManday = document.getElementById(`pTotalManday-${safeGangId}`);
            const pTotalMtManday = document.getElementById(`pTotalMtManday-${safeGangId}`);

            if (pTotalHa) pTotalHa.textContent = formatHA(tHa);
            if (pTotalBudget) pTotalBudget.textContent = formatHA(tBudget);
            if (pTotalR1) pTotalR1.textContent = formatHA(tR1);
            if (pTotalR2) pTotalR2.textContent = formatHA(tR2);
            if (pTotalR3) pTotalR3.textContent = formatHA(tR3);
            if (pTotalAll) {
                pTotalAll.textContent = formatHA(tTotal);
                if (tBudget > 0 && tTotal < tBudget) {
                    pTotalAll.classList.add('text-danger-important');
                } else {
                    pTotalAll.classList.remove('text-danger-important');
                }
            }
            if (pTotalManday) pTotalManday.textContent = formatHA(tManday);
            if (pTotalMtManday) pTotalMtManday.textContent = tManday > 0 ? (tTotal / tManday).toFixed(2) : "0.00";

            // Side Stats
            const netManpower = perfData.manpower - perfData.leave;
            const mtPerson = netManpower > 0 ? (tTotal / netManpower).toFixed(2) : "0.00";
            const haPerson = netManpower > 0 ? (tHa / netManpower).toFixed(2) : "0.00";

            const statMtPerson = document.getElementById(`statMtPerson-${safeGangId}`);
            const statHaPerson = document.getElementById(`statHaPerson-${safeGangId}`);
            const statRatio = document.getElementById(`statRatio-${safeGangId}`);

            if (statMtPerson) statMtPerson.textContent = mtPerson;
            if (statHaPerson) statHaPerson.textContent = haPerson;

            if (statRatio && mtPerson !== "0.00" && haPerson !== "0.00") {
                const ratio = (parseFloat(mtPerson) / parseFloat(haPerson)).toFixed(2);
                statRatio.textContent = `1:${ratio}`;
            } else {
                if (statRatio) statRatio.textContent = "0:0";
            }

            updatePerformanceChart(blocks, perfData, safeGangId);
        };

        const updatePerformanceChart = (blocks, perfData, safeGangId) => {
            const ctx = document.getElementById(`performanceChart-${safeGangId}`);
            if (!ctx) return;

            const labels = [];
            const dR1 = [], dR2 = [], dR3 = [], dBudget = [], dTotal = [];

            blocks.forEach(block => {
                labels.push(block.block_id);
                const bData = perfData.blocks[block.block_id];
                dR1.push(bData.r1);
                dR2.push(bData.r2);
                dR3.push(bData.r3);
                dBudget.push(bData.budget);
                dTotal.push(bData.r1 + bData.r2 + bData.r3);
            });

            if (performanceChartInstances[safeGangId]) {
                performanceChartInstances[safeGangId].destroy();
            }

            performanceChartInstances[safeGangId] = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '1st Round',
                            data: dR1,
                            backgroundColor: '#60a5fa' // blue
                        },
                        {
                            label: '2nd Round',
                            data: dR2,
                            backgroundColor: '#ef4444' // red
                        },
                        {
                            label: '3rd Round',
                            data: dR3,
                            backgroundColor: '#a3e635' // green
                        },
                        {
                            type: 'line',
                            label: `Budget ${state.selectedReportYear}`,
                            data: dBudget,
                            borderColor: '#8b5cf6', // purple
                            backgroundColor: '#8b5cf6',
                            borderWidth: 0,
                            pointStyle: 'rect',
                            pointRadius: 6,
                            showLine: false
                        },
                        {
                            type: 'line',
                            label: `Total`,
                            data: dTotal,
                            borderColor: '#0ea5e9', // cyan
                            backgroundColor: '#0ea5e9',
                            borderWidth: 0,
                            pointStyle: 'cross',
                            pointRadius: 10,
                            pointBorderWidth: 2,
                            showLine: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            stacked: false,
                            title: { display: true, text: 'Block Harvested' }
                        },
                        y: {
                            beginAtZero: true,
                            title: { display: true, text: 'Harvest Amount' }
                        }
                    },
                    plugins: {
                        legend: {
                            position: 'right',
                        }
                    }
                }
            });
        };

        const renderIntervalTable = () => {
            const year = state.selectedReportYear;
            const month = state.activePerfMonth;

            intervalWrapper.innerHTML = ''; // Start clean

            // Ensure state tree
            state.performance[year] = state.performance[year] || {};
            state.performance[year][month] = state.performance[year][month] || {};

            let blocks = [...(state.reports[year] || [])];
            if (state.performance[year] && state.performance[year][month]) {
                Object.keys(state.performance[year][month]).forEach(gangKey => {
                    if (gangKey !== 'gangAssignments') {
                        const gangData = state.performance[year][month][gangKey];
                        if (gangData && gangData.blocks) {
                            Object.keys(gangData.blocks).forEach(bId => {
                                if (!blocks.find(b => String(b.block_id) === String(bId))) {
                                    blocks.push({ block_id: bId, ha: gangData.blocks[bId].ha || 0, gang: gangKey });
                                }
                            });
                        }
                    }
                });
            }
            blocks.sort((a, b) => parseFloat(a.block_id) - parseFloat(b.block_id));

            // 1. Initialize Month-Specific Gang Assignments
            if (!state.performance[year][month].gangAssignments) {
                const sortedMonths = [...months];
                const currentMonthIdx = sortedMonths.indexOf(month);
                let inheritedMap = null;

                if (currentMonthIdx > 0) {
                    for (let i = currentMonthIdx - 1; i >= 0; i--) {
                        const prevMonth = sortedMonths[i];
                        if (state.performance[year][prevMonth] && state.performance[year][prevMonth].gangAssignments) {
                            inheritedMap = JSON.parse(JSON.stringify(state.performance[year][prevMonth].gangAssignments));
                            break;
                        }
                    }
                }

                if (inheritedMap) {
                    state.performance[year][month].gangAssignments = inheritedMap;
                } else {
                    const newMap = {};
                    blocks.forEach(b => { newMap[b.block_id] = b.gang || "Unassigned"; });
                    state.performance[year][month].gangAssignments = newMap;
                }
            }

            const monthAssignments = state.performance[year][month].gangAssignments;

            const wrapper = document.createElement('div');
            wrapper.style.marginBottom = '3rem';
            wrapper.style.padding = '0';

            wrapper.innerHTML = `
            <div class="performance-header" style="display: flex; justify-content: space-between; align-items: flex-end;">
                <div>
                    <h2>HARVESTING INTERVAL FOR THE MONTH OF ${month.toUpperCase()} ${year}</h2>
                    <div class="perf-stats">
                        <div class="stat-row">
                            <label>VIEW:</label>
                            <span class="font-bold">ALL BLOCKS</span>
                        </div>
                    </div>
                </div>
                <div class="summary-table-container" style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 0.85rem;">
                        <thead>
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <th style="padding: 0.25rem 0.5rem; color: var(--text-muted); font-weight: 600;">FFB BUDGET</th>
                                <th style="padding: 0.25rem 0.5rem; color: var(--text-muted); font-weight: 600;">1ST RD</th>
                                <th style="padding: 0.25rem 0.5rem; color: var(--text-muted); font-weight: 600;">2ND RD</th>
                                <th style="padding: 0.25rem 0.5rem; color: var(--text-muted); font-weight: 600;">3RD RD</th>
                                <th style="padding: 0.25rem 0.5rem; color: var(--text-muted); font-weight: 600;">4TH RD</th>
                                <th style="padding: 0.25rem 0.5rem; color: var(--primary-color); font-weight: 700;">TOTAL</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td id="interval-sum-budget" style="padding: 0.25rem 0.5rem; font-weight: 700; color: var(--text-primary);">0.00</td>
                                <td id="interval-sum-r1" style="padding: 0.25rem 0.5rem; font-weight: 500;">0.00</td>
                                <td id="interval-sum-r2" style="padding: 0.25rem 0.5rem; font-weight: 500;">0.00</td>
                                <td id="interval-sum-r3" style="padding: 0.25rem 0.5rem; font-weight: 500;">0.00</td>
                                <td id="interval-sum-r4" style="padding: 0.25rem 0.5rem; font-weight: 500;">0.00</td>
                                <td id="interval-sum-total" style="padding: 0.25rem 0.5rem; font-weight: 700; color: var(--primary-color);">0.00</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="table-container" style="overflow-x: auto; padding-bottom: 2rem;">
                <table class="grouped-table" style="min-width: 1500px;" id="interval-table-all">
                    <thead>
                        <tr>
                            <th style="min-width: 60px; position: sticky; left: 0; background: var(--bg-primary); z-index: 1; border-right: 2px solid var(--border-color);">BLOCK</th>
                            <th style="min-width: 80px; border-right: 2px solid var(--border-color);">HA</th>
                            ${Array.from({ length: 31 }, (_, i) => `<th style="min-width: 40px; text-align: center; font-size: 0.8em; padding: 0.2rem;">${i + 1}</th>`).join('')}
                            <th style="min-width: 90px; text-align: center; border-left: 2px solid var(--border-color);">TOTAL MANDAY</th>
                            <th style="min-width: 90px; text-align: center; border-left: 2px solid var(--border-color);">FFB BUDGET</th>
                            <th style="min-width: 80px; text-align: center;">1ST RD</th>
                            <th style="min-width: 80px; text-align: center;">2ND RD</th>
                            <th style="min-width: 80px; text-align: center;">3RD RD</th>
                            <th style="min-width: 80px; text-align: center;">4TH RD</th>
                        </tr>
                    </thead>
                    <tbody id="interval-table-body-all">
                    </tbody>
                </table>
            </div>
        `;

            intervalWrapper.appendChild(wrapper);

            const tbody = document.getElementById(`interval-table-body-all`);

            let sBudget = 0, sR1 = 0, sR2 = 0, sR3 = 0, sR4 = 0;

            blocks.forEach(block => {
                const bId = block.block_id;
                const gangName = monthAssignments[bId] || block.gang || "Unassigned";

                // Ensure gang object exists
                if (!state.performance[year][month][gangName]) {
                    state.performance[year][month][gangName] = { manpower: 0, leave: 0, blocks: {} };
                }
                const perfData = state.performance[year][month][gangName];

                if (!perfData.blocks[bId]) {
                    perfData.blocks[bId] = { budget: 0, r1: 0, r2: 0, r3: 0, r4: 0, manday: 0, days: new Array(31).fill("") };
                }
                const bData = perfData.blocks[bId];
                if (!bData.days) bData.days = new Array(31).fill("");
                if (typeof bData.r4 === "undefined") bData.r4 = 0;

                // Dynamically sync FFB Budget for current month
                const monthIndex = months.indexOf(month);
                if (state.ffbBudget && state.ffbBudget[year]) {
                    const ffbRow = state.ffbBudget[year].find(r => String(r.block_id).trim() === String(bId).trim());
                    if (ffbRow && ffbRow.months && ffbRow.months.length > monthIndex) {
                        bData.budget = ffbRow.months[monthIndex] || 0;
                    }
                }

                sBudget += bData.budget || 0;
                sR1 += bData.r1 || 0;
                sR2 += bData.r2 || 0;
                sR3 += bData.r3 || 0;
                sR4 += bData.r4 || 0;

                const tr = document.createElement('tr');
                tr.innerHTML = `<td style="position: sticky; left: 0; background: var(--bg-primary); font-weight: 500; border-right: 2px solid var(--border-color);" class="text-center cell-block">${sEsc(bId)}</td>
                            <td class="text-right" style="border-right: 2px solid var(--border-color);">${formatHA(block.ha)}</td>`;

                bData.days.forEach((dayObj, i) => {
                    // Support both legacy array format and new object format
                    const isObj = typeof dayObj === 'object' && dayObj !== null;
                    const roundVal = isObj ? dayObj.roundVal : dayObj;
                    const hpVal = isObj ? dayObj.hpVal : "";

                    const td = document.createElement('td');
                    td.style.padding = '0';

                    const wrapper = document.createElement('div');
                    wrapper.style.display = 'flex';
                    wrapper.style.flexDirection = 'column';
                    wrapper.style.height = '100%';
                    wrapper.style.minHeight = '3.5rem';

                    const inputTop = document.createElement('input');
                    inputTop.type = 'text';
                    inputTop.className = 'edit-input text-center';
                    inputTop.style.width = '100%';
                    inputTop.style.flex = '1';
                    inputTop.style.padding = '0.2rem 0';
                    inputTop.style.border = 'none';
                    inputTop.style.borderBottom = '1px solid var(--border-color)';
                    inputTop.style.background = 'transparent';
                    inputTop.value = roundVal || "";
                    inputTop.onchange = (e) => {
                        if (!isObj) bData.days[i] = { roundVal: e.target.value, hpVal: "" };
                        else bData.days[i].roundVal = e.target.value;
                    };

                    const inputBot = document.createElement('input');
                    inputBot.type = 'text';
                    inputBot.className = 'edit-input text-center';
                    inputBot.style.width = '100%';
                    inputBot.style.flex = '1';
                    inputBot.style.padding = '0.2rem 0';
                    inputBot.style.border = 'none';
                    inputBot.style.background = 'transparent';
                    inputBot.style.color = '#ef4444'; // Red color for manpower
                    inputBot.value = hpVal || "";
                    inputBot.onchange = (e) => {
                        if (!isObj) bData.days[i] = { roundVal: dayObj, hpVal: e.target.value };
                        else bData.days[i].hpVal = e.target.value;
                    };

                    wrapper.appendChild(inputTop);
                    wrapper.appendChild(inputBot);
                    td.appendChild(wrapper);
                    tr.appendChild(td);
                });

                const createPerfInput = (field, onChange, extraStyle = "") => {
                    const td = document.createElement('td');
                    const input = document.createElement('input');
                    input.type = 'number';
                    input.className = 'edit-input text-right';
                    input.step = '0.01';
                    input.value = (bData[field] || 0).toFixed(2);
                    input.oninput = (e) => {
                        const parsed = parseFloat(e.target.value) || 0;
                        onChange(parsed);
                    };
                    input.onblur = (e) => { e.target.value = (parseFloat(e.target.value) || 0).toFixed(2); };
                    if (extraStyle) td.style.cssText = extraStyle;
                    td.appendChild(input);
                    return td;
                };

                tr.appendChild(createPerfInput('manday', (v) => bData.manday = v, "border-left: 2px solid var(--border-color);"));
                tr.appendChild(createPerfInput('budget', (v) => bData.budget = v, "border-left: 2px solid var(--border-color);"));
                tr.appendChild(createPerfInput('r1', (v) => { bData.r1 = v; renderIntervalTable(); }));
                tr.appendChild(createPerfInput('r2', (v) => { bData.r2 = v; renderIntervalTable(); }));
                tr.appendChild(createPerfInput('r3', (v) => { bData.r3 = v; renderIntervalTable(); }));
                tr.appendChild(createPerfInput('r4', (v) => { bData.r4 = v; renderIntervalTable(); }));

                tbody.appendChild(tr);
            });

            // Set the summary totals
            const sumBudgetEl = document.getElementById('interval-sum-budget');
            const sumR1El = document.getElementById('interval-sum-r1');
            const sumR2El = document.getElementById('interval-sum-r2');
            const sumR3El = document.getElementById('interval-sum-r3');
            const sumR4El = document.getElementById('interval-sum-r4');
            const sumTotalEl = document.getElementById('interval-sum-total');

            if (sumBudgetEl) sumBudgetEl.textContent = formatHA(sBudget);
            if (sumR1El) sumR1El.textContent = formatHA(sR1);
            if (sumR2El) sumR2El.textContent = formatHA(sR2);
            if (sumR3El) sumR3El.textContent = formatHA(sR3);
            if (sumR4El) sumR4El.textContent = formatHA(sR4);
            if (sumTotalEl) sumTotalEl.textContent = formatHA(sR1 + sR2 + sR3 + sR4);
        };

        const renderFfbBudgetTable = () => {
            const ffbBudgetWrapper = document.getElementById('ffb-budget-wrapper');
            if (!ffbBudgetWrapper) return;

            // Capture current scroll positions and active element
            const tableContainer = ffbBudgetWrapper.querySelector('.table-container');
            const scrollLeft = tableContainer ? tableContainer.scrollLeft : 0;
            const scrollTop = tableContainer ? tableContainer.scrollTop : 0;

            const activeEl = document.activeElement;
            const activeData = (activeEl && activeEl.dataset && activeEl.dataset.blockId) ? {
                blockId: activeEl.dataset.blockId,
                phase: activeEl.dataset.phase,
                field: activeEl.dataset.field,
                monthIdx: activeEl.dataset.monthIdx
            } : null;

            // Capture current group collapse state BEFORE clearing the DOM
            const isAlreadyRendered = !!document.getElementById('ffb-expand-all-btn');
            const collapsedGroups = new Set();
            document.body.classList.forEach(cls => {
                if (cls.startsWith('ffb-budget-toggle-group-')) {
                    collapsedGroups.add(cls);
                }
            });

            ffbBudgetWrapper.innerHTML = '';

            const year = state.activeViewValue;
            if (!state.ffbBudget || !state.ffbBudget[year] || state.ffbBudget[year].length === 0) {
                ffbBudgetWrapper.innerHTML = '<p style="padding: 2rem;">No FFB Budget data found for this year. Please import data first.</p>';
                return;
            }

            const data = state.ffbBudget[year];

            // Group the data by phase
            const groupedData = {};
            data.forEach(row => {
                const p = row.phase || "Unassigned";
                if (!groupedData[p]) groupedData[p] = { rows: [], tHa: 0, tMonths: new Array(12).fill(0) };
                groupedData[p].rows.push(row);
                groupedData[p].tHa += row.ha || 0;
                row.months.forEach((m, i) => {
                    groupedData[p].tMonths[i] += (m || 0);
                });
            });

            const wrapper = document.createElement('div');
            wrapper.style.marginBottom = '3rem';
            wrapper.style.padding = '0';

            let grandTotalHa = 0;
            let grandTotalMonths = new Array(12).fill(0);
            let tbodyHtml = '';

            Object.keys(groupedData).sort().forEach((phaseName, index) => {
                const group = groupedData[phaseName];
                grandTotalHa += group.tHa;

                let groupRowTotal = 0;
                let subTMonthsHtml = '';
                group.tMonths.forEach((m, i) => {
                    grandTotalMonths[i] += m;
                    groupRowTotal += m;
                    subTMonthsHtml += `<td class="text-right" style="padding: 0.4rem; font-weight: 600;">${Math.round(m)}</td>`;
                });

                // Add the Group Header Row (now combined with Subtotal)
                const toggleId = `ffb-budget-toggle-group-${index}`;
                tbodyHtml += `
                <tr class="row-group-header" onclick="document.body.classList.toggle('${toggleId}')" style="cursor: pointer; background: var(--bg-overlay, var(--group-bg));">
                    <td colspan="5" style="position: sticky; left: 0; width: 340px; min-width: 340px; max-width: 340px; background-color: var(--bg-secondary); z-index: 6; border-right: 1px solid var(--border-color); padding: 0 1rem;">
                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                            <div style="display: flex; align-items: center; gap: 0.8rem;">
                                <span class="group-toggle" id="${toggleId}-icon">▼</span>
                                <span class="text-muted" style="font-weight: normal; font-size: 0.9em; white-space: nowrap;">(${group.rows.length} blocks)</span>
                            </div>
                            <div class="font-bold text-right" style="white-space: nowrap;">SUBTOTAL ${phaseName}</div>
                        </div>
                    </td>
                    <td class="text-right font-bold" style="position: sticky; left: 340px; width: 100px; min-width: 100px; max-width: 100px; background-color: var(--bg-secondary); z-index: 6; border-right: 2px solid var(--border-color);">${group.tHa.toFixed(2)}</td>
                    ${subTMonthsHtml}
                    <td class="text-right font-bold col-total" style="border-left: 2px solid var(--border-color);">${Math.round(groupRowTotal)}</td>
                </tr>
            `;

                // Add individual block rows
                group.rows.forEach(row => {
                    let rowTotal = 0;
                    let monthsHtml = '';
                    row.months.forEach((m, mIdx) => {
                        rowTotal += (m || 0);
                        monthsHtml += `
                        <td style="padding: 0;">
                            <input type="number" step="1" class="edit-input ffb-input text-right" style="width: 100%; border: none; background: transparent; padding: 0.4rem;" 
                                data-field="month" data-month-idx="${mIdx}" data-block-id="${row.block_id}" data-phase="${row.phase}"
                                value="${Math.round(m || 0)}"
                            />
                        </td>
                    `;
                    });

                    tbodyHtml += `
                    <tr class="row-block ffb-budget-row-block ffb-budget-group-${index} ${toggleId}-hideable">
                        <td style="padding: 0; position: sticky; left: 0; width: 60px; min-width: 60px; max-width: 60px; background-color: var(--bg-primary); z-index: 5; border-right: 1px solid var(--border-color); text-align: center; font-weight: 500;">
                            ${row.block_id}
                        </td>
                        <td style="padding: 0; position: sticky; left: 60px; width: 70px; min-width: 70px; max-width: 70px; background-color: var(--bg-primary); z-index: 5; border-right: 1px solid var(--border-color);">
                            <input type="text" class="edit-input ffb-input text-center" style="width: 100%; border: none; background: var(--bg-primary); padding: 0.4rem; font-size: 0.85em;" 
                                data-field="ageMth" data-block-id="${row.block_id}" data-phase="${row.phase}"
                                value="${row.ageMth || ''}"
                            />
                        </td>
                        <td style="padding: 0; position: sticky; left: 130px; width: 70px; min-width: 70px; max-width: 70px; background-color: var(--bg-primary); z-index: 5; border-right: 1px solid var(--border-color);">
                            <input type="number" step="0.01" class="edit-input ffb-input text-center" style="width: 100%; border: none; background: var(--bg-primary); padding: 0.4rem; font-size: 0.85em;" 
                                data-field="harvestYr" data-block-id="${row.block_id}" data-phase="${row.phase}"
                                value="${(parseFloat(row.harvestYr) || 0).toFixed(2)}"
                            />
                        </td>
                        <td style="padding: 0; position: sticky; left: 200px; width: 70px; min-width: 70px; max-width: 70px; background-color: var(--bg-primary); z-index: 5; border-right: 1px solid var(--border-color);">
                            <input type="number" step="0.01" class="edit-input ffb-input text-right" style="width: 100%; border: none; background: var(--bg-primary); padding: 0.4rem; font-size: 0.85em;" 
                                data-field="mtHaYr" data-block-id="${row.block_id}" data-phase="${row.phase}"
                                value="${(row.mtHaYr || 0).toFixed(2)}"
                            />
                        </td>
                        <td style="padding: 0; position: sticky; left: 270px; width: 70px; min-width: 70px; max-width: 70px; background-color: var(--bg-primary); z-index: 5; border-right: 1px solid var(--border-color);">
                            <input type="number" step="0.01" class="edit-input ffb-input text-right" style="width: 100%; border: none; background: var(--bg-primary); padding: 0.4rem; font-size: 0.85em;" 
                                data-field="mtHaMth" data-block-id="${row.block_id}" data-phase="${row.phase}"
                                value="${(row.mtHaMth || 0).toFixed(2)}"
                            />
                        </td>
                        <td style="padding: 0; position: sticky; left: 340px; width: 100px; min-width: 100px; max-width: 100px; background-color: var(--bg-primary); z-index: 5; border-right: 2px solid var(--border-color);">
                            <input type="number" step="0.01" class="edit-input ffb-input text-right font-bold" style="width: 100%; border: none; background: var(--bg-primary); padding: 0.4rem;" 
                                data-field="ha" data-block-id="${row.block_id}" data-phase="${row.phase}"
                                value="${(row.ha || 0).toFixed(2)}"
                            />
                        </td>
                        ${monthsHtml}
                        <td class="text-right font-bold col-total" style="border-left: 2px solid var(--border-color);">${Math.round(rowTotal)}</td>
                        <td style="padding: 0.2rem 0.4rem; text-align: center; white-space: nowrap;">
                            <button class="ffb-delete-btn" data-block-id="${row.block_id}" data-phase="${row.phase}"
                                style="background: none; border: 1px solid transparent; border-radius: 4px; cursor: pointer; color: var(--danger); padding: 0.2rem 0.5rem; font-size: 1rem; line-height: 1; transition: background 0.2s;"
                                title="Delete this block">🗑️</button>
                        </td>
                    </tr>
                `;
                });

                // Insert dynamic CSS for toggling
                if (!document.getElementById(`style-${toggleId}`)) {
                    const style = document.createElement('style');
                    style.id = `style-${toggleId}`;
                    style.innerHTML = `
                    body.${toggleId} .${toggleId}-hideable { display: none !important; }
                    body.${toggleId} #${toggleId}-icon { transform: rotate(-90deg); }
                `;
                    document.head.appendChild(style);
                }
                // Restore previous collapse state; collapse by default only on first render
                if (isAlreadyRendered) {
                    if (collapsedGroups.has(toggleId)) {
                        document.body.classList.add(toggleId);
                    } else {
                        document.body.classList.remove(toggleId);
                    }
                } else {
                    // First render for this view: default to collapsed
                    document.body.classList.add(toggleId);
                }
            });

            let grandTotalRowSum = grandTotalMonths.reduce((a, b) => a + b, 0);
            let tFootMonthsHtml = grandTotalMonths.map(m => `<td class="text-right font-bold col-total" style="font-size: 0.9em;">${Math.round(m)}</td>`).join('');

            wrapper.innerHTML = `
            <div class="performance-header">
                <h2>PROPOSED FFB ESTIMATE PRODUCTION FOR YEAR ${year}</h2>
            </div>
            <div class="summary-table-container" style="margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
                 <div class="toolbar-left" style="display: flex; gap: 0.5rem; align-items: center;">
                     <button class="btn-secondary" id="ffb-expand-all-btn" style="padding: 0.5rem 1rem; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer;">
                        <span>+</span> Expand All
                     </button>
                     <button class="btn-secondary" id="ffb-collapse-all-btn" style="padding: 0.5rem 1rem; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer;">
                        <span>-</span> Collapse All
                     </button>
                 </div>
                 <div class="toolbar-right" style="display: flex; gap: 0.5rem; align-items: center;">
                     <button class="btn-danger" id="clear-budget-btn"><span>🗑️</span> Clear Budget for ${year}</button>
                     <button class="btn-primary" id="add-ffb-block-btn"><span>➕</span> Add Block</button>
                     <button class="btn-primary" id="save-ffb-btn" style="background-color: #10b981; border-color: #10b981;" title="Save all changes"><span>💾</span> Save</button>
                 </div>
            </div>
            <div class="table-container" style="overflow-x: auto; padding-bottom: 2rem;">
                <table class="grouped-table" style="min-width: 1600px;">
                    <thead>
                        <tr>
                            <th style="width: 60px; min-width: 60px; max-width: 60px; position: sticky; left: 0; background-color: var(--bg-secondary); z-index: 7; border-right: 1px solid var(--border-color);">BLK</th>
                            <th style="width: 70px; min-width: 70px; max-width: 70px; position: sticky; left: 60px; background-color: var(--bg-secondary); z-index: 7; border-right: 1px solid var(--border-color);">Age<br/>(mth)</th>
                            <th style="width: 70px; min-width: 70px; max-width: 70px; position: sticky; left: 130px; background-color: var(--bg-secondary); z-index: 7; border-right: 1px solid var(--border-color);">Harvest<br/>Yr.</th>
                            <th style="width: 70px; min-width: 70px; max-width: 70px; position: sticky; left: 200px; background-color: var(--bg-secondary); z-index: 7; border-right: 1px solid var(--border-color);">Mt/ha/yr</th>
                            <th style="width: 70px; min-width: 70px; max-width: 70px; position: sticky; left: 270px; background-color: var(--bg-secondary); z-index: 7; border-right: 1px solid var(--border-color);">Mt/ha/mth</th>
                            <th style="width: 100px; min-width: 100px; max-width: 100px; position: sticky; left: 340px; background-color: var(--bg-secondary); z-index: 7; border-right: 2px solid var(--border-color);">HA</th>
                            ${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].map((m) => `<th style="min-width: 60px; text-align: right; padding: 0.4rem; font-size: 0.85em;">${m}</th>`).join('')}
                            <th style="min-width: 80px; text-align: right; border-left: 2px solid var(--border-color);" class="col-total">TOTAL</th>
                            <th style="min-width: 40px; text-align: center;"></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tbodyHtml}
                    </tbody>
                    <tfoot>
                        <tr class="row-grand-total">
                            <td colspan="5" class="grand-total-label" style="position: sticky; left: 0; width: 340px; min-width: 340px; max-width: 340px; background-color: var(--grand-total-bg); z-index: 6; border-right: 1px solid var(--border-color); text-align: right; padding-right: 1rem;">GRAND TOTAL</td>
                            <td class="text-right font-bold" style="position: sticky; left: 340px; width: 100px; min-width: 100px; max-width: 100px; background-color: var(--grand-total-bg); z-index: 6; border-right: 2px solid var(--border-color);">${grandTotalHa.toFixed(2)}</td>
                            ${tFootMonthsHtml}
                            <td class="text-right font-bold col-total" style="border-left: 2px solid var(--border-color);">${Math.round(grandTotalRowSum)}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;

            ffbBudgetWrapper.appendChild(wrapper);

            // Global Expand/Collapse Handlers
            const expandAllBtn = document.getElementById('ffb-expand-all-btn');
            if (expandAllBtn) {
                expandAllBtn.addEventListener('click', () => {
                    Object.keys(groupedData).forEach((_, idx) => {
                        document.body.classList.remove(`ffb-budget-toggle-group-${idx}`);
                    });
                });
            }

            const collapseAllBtn = document.getElementById('ffb-collapse-all-btn');
            if (collapseAllBtn) {
                collapseAllBtn.addEventListener('click', () => {
                    Object.keys(groupedData).forEach((_, idx) => {
                        document.body.classList.add(`ffb-budget-toggle-group-${idx}`);
                    });
                });
            }

            // Restore scroll positions
            const newTableContainer = ffbBudgetWrapper.querySelector('.table-container');
            if (newTableContainer) {
                newTableContainer.scrollLeft = scrollLeft;
                newTableContainer.scrollTop = scrollTop;
            }

            // Restore focus
            if (activeData) {
                let selector = `.ffb-input[data-block-id="${activeData.blockId}"][data-phase="${activeData.phase}"][data-field="${activeData.field}"]`;
                if (activeData.monthIdx !== undefined) {
                    selector += `[data-month-idx="${activeData.monthIdx}"]`;
                }
                const elToFocus = ffbBudgetWrapper.querySelector(selector);
                if (elToFocus) {
                    elToFocus.focus();
                    // For number inputs, selecting the text usually works better on mobile/desktop
                    if (elToFocus.tagName === 'INPUT') elToFocus.select();
                }
            }

            // Helper to show modal
            const showModal = (title, bodyHtml, onConfirm) => {
                const overlay = document.getElementById('ffb-modal-overlay');
                const titleEl = document.getElementById('ffb-modal-title');
                const bodyEl = document.getElementById('ffb-modal-body');
                const confirmBtn = document.getElementById('ffb-modal-confirm');
                const cancelBtn = document.getElementById('ffb-modal-cancel');

                if (!overlay || !titleEl || !bodyEl || !confirmBtn || !cancelBtn) return;

                titleEl.textContent = title;
                bodyEl.innerHTML = bodyHtml;
                overlay.style.display = 'flex';

                // Clean up old listeners
                const newConfirmBtn = confirmBtn.cloneNode(true);
                confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
                const newCancelBtn = cancelBtn.cloneNode(true);
                cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

                newCancelBtn.onclick = () => { overlay.style.display = 'none'; };
                newConfirmBtn.onclick = () => {
                    if (onConfirm()) {
                        overlay.style.display = 'none';
                    }
                };
            };

            const clearBtn = document.getElementById('clear-budget-btn');
            if (clearBtn) {
                clearBtn.onclick = () => {
                    showModal(
                        `Clear Budget for ${year}`,
                        `<p>Are you sure you want to delete all FFB budget data for Year ${year}? This action cannot be undone.</p>`,
                        () => {
                            state.ffbBudget[year] = [];
                            renderFfbBudgetTable();
                            return true;
                        }
                    );
                };
            }

            const addFfbBlockBtn = document.getElementById('add-ffb-block-btn');
            if (addFfbBlockBtn) {
                addFfbBlockBtn.onclick = () => {
                    const bodyHtml = `
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <div>
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Phase (e.g., OP2010)</label>
                            <input type="text" id="modal-phase-input" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px;" value="OP" />
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Block ID</label>
                            <input type="text" id="modal-block-input" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px;" placeholder="e.g. BLK-1" />
                        </div>
                    </div>
                `;

                    showModal('Add New Block', bodyHtml, () => {
                        const phaseInput = document.getElementById('modal-phase-input');
                        const blockInput = document.getElementById('modal-block-input');
                        const phase = phaseInput ? phaseInput.value.trim() : "";
                        const blockId = blockInput ? blockInput.value.trim() : "";

                        if (!phase || !blockId) {
                            window.notify("Phase and Block ID are required.", 'warn');
                            return false; // don't close modal
                        }

                        state.ffbBudget[year].push({
                            phase: phase,
                            block_id: blockId,
                            ha: 0,
                            ageMth: "",
                            harvestYr: "",
                            ageYrMth: "",
                            harvestYrMth: "",
                            mtHaYr: 0,
                            mtHaMth: 0,
                            months: new Array(12).fill(0)
                        });
                        renderFfbBudgetTable();
                        return true;
                    });
                };
            }

            const saveFfbBtn = document.getElementById('save-ffb-btn');
            if (saveFfbBtn) {
                saveFfbBtn.onclick = saveState;
            }
            // Attach event listeners
            const inputs = wrapper.querySelectorAll('.ffb-input');
            inputs.forEach(input => {
                input.addEventListener('change', (e) => {
                    const target = e.target;
                    const field = target.dataset.field;
                    const blockId = target.dataset.blockId;
                    const phase = target.dataset.phase;

                    const rowData = state.ffbBudget[year].find(r => r.block_id === blockId && r.phase === phase);
                    if (!rowData) return;

                    if (field === 'month') {
                        const idx = parseInt(target.dataset.monthIdx);
                        rowData.months[idx] = parseFloat(target.value) || 0;
                    } else if (['mtHaYr', 'mtHaMth', 'ha'].includes(field)) {
                        rowData[field] = parseFloat(target.value) || 0;
                    } else {
                        rowData[field] = target.value; // string fields
                    }

                    // Re-render immediately to update subtotals
                    renderFfbBudgetTable();
                });

                if (input.type === 'number') {
                    input.addEventListener('blur', (e) => {
                        const field = e.target.dataset.field;
                        const val = parseFloat(e.target.value) || 0;
                        if (['harvestYr', 'mtHaYr', 'mtHaMth', 'ha'].includes(field)) {
                            e.target.value = val.toFixed(2);
                        } else {
                            e.target.value = Math.round(val).toString();
                        }
                    });
                }
            });

            // Attach delete button handlers
            const deleteBtns = wrapper.querySelectorAll('.ffb-delete-btn');
            deleteBtns.forEach(btn => {
                btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(239,68,68,0.1)'; btn.style.borderColor = 'var(--danger)'; });
                btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; btn.style.borderColor = 'transparent'; });
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const blockId = btn.dataset.blockId;
                    const phase = btn.dataset.phase;
                    // Remove only from the current year — other years are untouched
                    const removed = state.ffbBudget[year].filter(
                        r => r.block_id === blockId && r.phase === phase
                    );
                    if (!removed.length) return;
                    state.ffbBudget[year] = state.ffbBudget[year].filter(
                        r => !(r.block_id === blockId && r.phase === phase)
                    );
                    renderFfbBudgetTable();
                    window.notifyUndo(`Deleted block "${blockId}" (${phase}) from ${year}.`, () => {
                        state.ffbBudget[year] = state.ffbBudget[year].concat(removed);
                        renderFfbBudgetTable();
                    });
                });
            });
        };


        const renderHarvestingReportTable = (wrapper, report, fallbackTitle) => {
            if (!wrapper) return;
            wrapper.innerHTML = '';

            if (!report || !Array.isArray(report.rows) || report.rows.length === 0) {
                const message = document.createElement('p');
                message.style.padding = '1rem';
                message.textContent = 'Report data is not available yet. Please run the extraction script and refresh.';
                wrapper.appendChild(message);
                return;
            }

            const sanitized = report.rows.filter(row => row && row.some(cell => String(cell).trim()));
            if (sanitized.length === 0) {
                const message = document.createElement('p');
                message.style.padding = '1rem';
                message.textContent = 'No non-empty rows were found in this worksheet.';
                wrapper.appendChild(message);
                return;
            }

            const headerCount = Math.min(3, sanitized.length);
            const headerRows = sanitized.slice(0, headerCount);
            const bodyRows = sanitized.slice(headerCount);

            const titleEl = document.createElement('h2');
            titleEl.textContent = report.title || fallbackTitle || 'Harvesting Report';
            titleEl.style.marginBottom = '0.75rem';
            titleEl.style.fontSize = '1.1rem';
            titleEl.style.fontWeight = '700';
            wrapper.appendChild(titleEl);

            const tableContainer = document.createElement('div');
            tableContainer.className = 'table-container';
            tableContainer.style.background = 'white';
            tableContainer.style.padding = '0';
            tableContainer.style.overflowX = 'auto';

            const table = document.createElement('table');
            table.className = 'grouped-table';
            table.style.width = 'max-content';
            table.style.borderCollapse = 'collapse';
            table.style.marginBottom = '1rem';

            const buildRow = (row, isHeader = false) => {
                const tr = document.createElement('tr');
                row.forEach(cell => {
                    const cellEl = document.createElement(isHeader ? 'th' : 'td');
                    cellEl.textContent = cell;
                    cellEl.style.border = '1px solid #000';
                    cellEl.style.padding = '0.35rem 0.6rem';
                    cellEl.style.minWidth = '80px';
                    cellEl.style.textAlign = 'right';
                    if (isHeader) {
                        cellEl.style.fontWeight = '700';
                        cellEl.style.background = '#f7f7f7';
                        cellEl.style.textAlign = 'center';
                    }
                    tr.appendChild(cellEl);
                });
                return tr;
            };

            const thead = document.createElement('thead');
            headerRows.forEach(row => thead.appendChild(buildRow(row, true)));

            const tbody = document.createElement('tbody');
            if (bodyRows.length === 0) {
                const emptyRow = document.createElement('tr');
                const emptyCell = document.createElement('td');
                emptyCell.colSpan = headerRows[headerRows.length - 1]?.length || 1;
                emptyCell.style.border = '1px solid #000';
                emptyCell.style.padding = '0.5rem';
                emptyCell.style.textAlign = 'center';
                emptyCell.textContent = 'No additional rows in this report.';
                emptyRow.appendChild(emptyCell);
                tbody.appendChild(emptyRow);
            } else {
                bodyRows.forEach(row => tbody.appendChild(buildRow(row)));
            }

            table.appendChild(thead);
            table.appendChild(tbody);
            tableContainer.appendChild(table);
            wrapper.appendChild(tableContainer);

            if (state.harvestingReportsMeta) {
                const meta = document.createElement('p');
                meta.style.fontSize = '0.85rem';
                meta.style.color = '#475569';
                meta.style.margin = '0';
                meta.textContent = `Generated ${state.harvestingReportsMeta.generatedAt || ''} · Source: ${state.harvestingReportsMeta.sourceWorkbook || ''}`;
                wrapper.appendChild(meta);
            }
        };

        const renderHarvestingYtdReport = () => {
            const wrapper = document.getElementById('ytd-wrapper');
            renderHarvestingReportTable(wrapper, state.harvestingReports?.harvestingYtdByGang, 'Harvesting YTD by Gang');
        };

        const renderHarvesterComparisonReport = () => {
            const wrapper = document.getElementById('current-prev-wrapper');
            renderHarvestingReportTable(wrapper, state.harvestingReports?.harvestersMonthComparison, "Harvesters' Current vs Previous Month");
        };

        const loadHarvestingReports = async () => {
            try {
                const res = await fetch('harvesting_performance_reports.json');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                state.harvestingReports = data.reports || {};
                state.harvestingReportsMeta = {
                    generatedAt: data.generatedAt,
                    sourceWorkbook: data.sourceWorkbook
                };
            } catch (error) {
                console.error('Failed to load harvesting reports asset:', error);
                state.harvestingReports = null;
                state.harvestingReportsMeta = null;
            }
        };

        const init = async () => {
            try {
                const downloadAsExcel = async (filename, templateKey) => {
                    try {
                        const bStr = window.AppTemplates[templateKey];
                        if (!bStr) throw new Error(`Template base64 data not found in templates.js for key ${templateKey}`);

                        // Convert base64 to raw binary data held in a string
                        const byteCharacters = atob(bStr);
                        const byteNumbers = new Array(byteCharacters.length);
                        for (let i = 0; i < byteCharacters.length; i++) {
                            byteNumbers[i] = byteCharacters.charCodeAt(i);
                        }
                        const byteArray = new Uint8Array(byteNumbers);

                        // Create a Blob with the Excel MIME type and trigger download using Object URL
                        const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                        const blobUrl = URL.createObjectURL(blob);

                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = blobUrl;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        setTimeout(() => {
                            document.body.removeChild(a);
                            URL.revokeObjectURL(blobUrl);
                        }, 100);
                    } catch (error) {
                        console.error("Download error:", error);
                        window.notify("Failed to download " + filename + ". " + error.message, 'error');
                    }
                };

                const tBtnInterval = document.getElementById('sidebar-download-template');
                const tBtnFfb = document.getElementById('sidebar-download-ffb-template');

                if (tBtnInterval) {
                    tBtnInterval.addEventListener('click', (e) => {
                        e.preventDefault();
                        downloadAsExcel('Harvesting_Template.xlsx', 'harvestingInterval');
                    });
                }

                if (tBtnFfb) {
                    tBtnFfb.addEventListener('click', (e) => {
                        e.preventDefault();
                        downloadAsExcel('FFB_Budget_Template.xlsx', 'ffbBudget');
                    });
                }
                const addBlockBtn = document.getElementById('add-block-btn');
                if (addBlockBtn) {
                    addBlockBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        handleGlobalAddBlock();
                    });
                }

                // Add Year (Duplicate) button is rendered dynamically in renderSidebar
                // (its onclick is bound inline there), so no static binding is needed here.

                const deleteYearBtn = document.getElementById('delete-year-btn');
                if (deleteYearBtn) {
                    deleteYearBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        handleDeleteYear();
                    });
                }

                const importExcelBtn = document.getElementById('sidebar-import-excel');
                const importExcelInput = document.getElementById('sidebar-import-input');

                if (importExcelBtn && importExcelInput) {
                    importExcelBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        importExcelInput.click();
                    });
                    importExcelInput.onchange = handleImportExcel;
                }

                const importFfbBtn = document.getElementById('sidebar-import-ffb');
                const importFfbInput = document.getElementById('sidebar-import-ffb-input');

                if (importFfbBtn && importFfbInput) {
                    importFfbBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        importFfbInput.click();
                    });
                    importFfbInput.onchange = handleImportFfbBudget;
                }

                // Download Template — Spraying Maintenance
                const dlSprayTplBtn = document.getElementById('sidebar-download-spray-template');
                if (dlSprayTplBtn) {
                    dlSprayTplBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        const year = (window.state && window.state.sprayingYear)
                            || Object.keys((window.state && window.state.spraying) || {}).sort().reverse()[0]
                            || String(new Date().getFullYear());
                        if (typeof downloadSprayingTemplate === 'function') {
                            downloadSprayingTemplate(year);
                        } else {
                            window.notify('Spraying template function not loaded yet.', 'error');
                        }
                    });
                }

                // Download Template — Manuring
                const dlManuringTplBtn = document.getElementById('sidebar-download-manuring-template');
                if (dlManuringTplBtn) {
                    dlManuringTplBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        if (typeof window._manuringDownloadTemplate === 'function') {
                            window._manuringDownloadTemplate();
                        } else {
                            window.notify('Manuring template function not loaded yet.', 'error');
                        }
                    });
                }

                // Download Template — Iron Horse Expenses
                const dlIronHorseTplBtn = document.getElementById('sidebar-download-ironhorse-template');
                if (dlIronHorseTplBtn) {
                    dlIronHorseTplBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        const year = (window.state && window.state.ihExpensesYear)
                            || Object.keys((window.state && window.state.ironHorse && window.state.ironHorse.expenses) || {})
                                .filter(k => /^\d{4}$/.test(k)).sort().reverse()[0]
                            || String(new Date().getFullYear());
                        const month = (window.state && window.state.ihExpensesMonth) || '';
                        if (typeof downloadIronHorseTemplate === 'function') {
                            downloadIronHorseTemplate(year, month);
                        } else {
                            window.notify('Iron Horse template function not loaded yet.', 'error');
                        }
                    });
                }

                // Import Excel — Spraying Maintenance
                const importSprayBtn = document.getElementById('sidebar-import-spray');
                const importSprayInput = document.getElementById('sidebar-import-spray-input');
                if (importSprayBtn && importSprayInput) {
                    importSprayBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        importSprayInput.value = '';
                        importSprayInput.click();
                    });
                    importSprayInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const year = (window.state && window.state.sprayingYear)
                            || Object.keys((window.state && window.state.spraying) || {}).sort().reverse()[0]
                            || String(new Date().getFullYear());
                        if (typeof importSprayingFromExcel === 'function') {
                            importSprayingFromExcel(file, year);
                        } else {
                            window.notify('Spraying import function not loaded yet.', 'error');
                        }
                    };
                }

                // Import Excel — Manuring
                const importManuringBtn = document.getElementById('sidebar-import-manuring');
                const importManuringInput = document.getElementById('sidebar-import-manuring-input');
                if (importManuringBtn && importManuringInput) {
                    importManuringBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        importManuringInput.value = '';
                        importManuringInput.click();
                    });
                    importManuringInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (typeof window._manuringImportExcel === 'function') {
                            window._manuringImportExcel(file);
                        } else {
                            window.notify('Manuring import function not loaded yet.', 'error');
                        }
                    };
                }

                // (Google Drive helpers and backup utilities are defined at runMainApplication scope above)

                // Backup & Restore
                const exportBackupBtn = document.getElementById('sidebar-export-backup');
                const importBackupBtn = document.getElementById('sidebar-import-backup');
                const importBackupInput = document.getElementById('sidebar-import-backup-input');

                if (exportBackupBtn) {
                    exportBackupBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        triggerBackup(false);
                    });
                }

                if (importBackupBtn && importBackupInput) {
                    importBackupBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        importBackupInput.click();
                    });
                    importBackupInput.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        if (!confirm('Restoring a backup will overwrite ALL current data. This cannot be undone.\n\nAre you sure you want to continue?')) {
                            e.target.value = '';
                            return;
                        }
                        const reader = new FileReader();
                        reader.onload = async (ev) => {
                            try {
                                const restored = JSON.parse(ev.target.result);
                                window.state = restored;
                                await saveState(false);
                                window.notify('Backup restored successfully! The page will now reload.', 'success');
                                setTimeout(() => location.reload(), 1200);
                            } catch (err) {
                                window.notify('Failed to restore backup: ' + err.message, 'error');
                            }
                        };
                        reader.readAsText(file);
                        e.target.value = '';
                    });
                }

                // Backup Settings nav handler
                const sidebarBackupSettings = document.getElementById('sidebar-backup-settings');
                if (sidebarBackupSettings) {
                    sidebarBackupSettings.addEventListener('click', (e) => {
                        e.preventDefault();
                        renderBackupSettingsPanel();
                    });
                }

                // User Management nav handler
                const sidebarUserMgmt = document.getElementById('sidebar-user-mgmt');
                if (sidebarUserMgmt) {
                    sidebarUserMgmt.onclick = (e) => {
                        e.preventDefault();
                        state.activeViewType = 'user_mgmt';
                        renderSidebar();
                        renderTable();
                    };
                }

                // Excel Reports nav handler
                const sidebarExcelReports = document.getElementById('sidebar-excel-reports');
                if (sidebarExcelReports) {
                    sidebarExcelReports.onclick = () => {
                        state.activeViewType = 'excel_reports';
                        renderSidebar();
                        renderTable();
                    };
                }

                // ── Maintenance nav handlers ────────────────────────────
                const sidebarSpraying = document.getElementById('sidebar-spraying');
                if (sidebarSpraying) {
                    sidebarSpraying.onclick = (e) => {
                        e.preventDefault();
                        if (!state.spraying) state.spraying = {};
                        const availYears = Object.keys(state.spraying).filter(k => /^\d{4}$/.test(k));
                        if (availYears.length === 0) {
                            // Initialize with current year if none exists
                            const y = String(new Date().getFullYear());
                            state.spraying[y] = typeof getDefaultSprayingData === 'function' ? getDefaultSprayingData() : { phases: [] };
                            state.sprayingYear = y;
                        }
                        state.activeViewType = 'spraying';
                        state.activeViewValue = 'spraying';
                        renderSidebar();
                        renderTable();
                    };
                }

                const sidebarManuring = document.getElementById('sidebar-manuring');
                if (sidebarManuring) {
                    sidebarManuring.onclick = (e) => {
                        e.preventDefault();
                        if (!state.manuring) state.manuring = {};
                        if (!state.manuring['2025'] && typeof window._manuringDefault2025 !== 'undefined') {
                            state.manuring['2025'] = JSON.parse(JSON.stringify(window._manuringDefault2025));
                        }
                        if (!state.manuringYear) state.manuringYear = '2025';
                        state.activeViewType = 'manuring';
                        state.activeViewValue = 'manuring';
                        renderSidebar();
                        renderTable();
                    };
                }

                // ── Iron Horse nav handlers ─────────────────────────────
                const sidebarIronHorseAssets = document.getElementById('sidebar-ironhorse-assets');
                if (sidebarIronHorseAssets) {
                    sidebarIronHorseAssets.onclick = (e) => {
                        e.preventDefault();
                        if (!state.ironHorse) state.ironHorse = {};
                        if (!state.ironHorse.assets) state.ironHorse.assets = {};
                        if (!state.ironHorse.expenses) state.ironHorse.expenses = {};
                        const availYears = Object.keys(state.ironHorse.assets).filter(k => /^\d{4}$/.test(k));
                        if (availYears.length === 0) {
                            const y = String(new Date().getFullYear());
                            if (typeof getDefaultIronHorseAssets === 'function') {
                                state.ironHorse.assets[y] = getDefaultIronHorseAssets();
                            }
                            state.ihAssetsYear = y;
                        }
                        state.activeViewType = 'ironhorse_assets';
                        renderSidebar(); renderTable();
                    };
                }

                const sidebarIronHorseExpenses = document.getElementById('sidebar-ironhorse-expenses');
                if (sidebarIronHorseExpenses) {
                    sidebarIronHorseExpenses.onclick = (e) => {
                        e.preventDefault();
                        if (!state.ironHorse) state.ironHorse = {};
                        if (!state.ironHorse.expenses) state.ironHorse.expenses = {};
                        state.activeViewType = 'ironhorse_expenses';
                        renderSidebar(); renderTable();
                    };
                }

                const sidebarIronHorseCostPerHa = document.getElementById('sidebar-ironhorse-costperha');
                if (sidebarIronHorseCostPerHa) {
                    sidebarIronHorseCostPerHa.onclick = (e) => {
                        e.preventDefault();
                        state.activeViewType = 'ironhorse_costperha';
                        renderSidebar(); renderTable();
                    };
                }

                // ── Weekly Activity nav handler ─────────────────────────
                const sidebarWeekly = document.getElementById('sidebar-weekly');
                if (sidebarWeekly) {
                    sidebarWeekly.onclick = (e) => {
                        e.preventDefault();
                        if (!state.weekly) state.weekly = {};
                        state.activeViewType = 'weekly_activity';
                        renderSidebar(); renderTable();
                    };
                }

                // ── Rate of Wages nav handler ───────────────────────────
                const sidebarWages = document.getElementById('sidebar-wages');
                if (sidebarWages) {
                    sidebarWages.onclick = (e) => {
                        e.preventDefault();
                        if (!state.wages) state.wages = {};
                        state.activeViewType = 'wages';
                        renderSidebar(); renderTable();
                    };
                }

                // ── Wage Ledger nav handler ─────────────────────────────
                const sidebarWagesLedger = document.getElementById('sidebar-wages-ledger');
                if (sidebarWagesLedger) {
                    sidebarWagesLedger.onclick = (e) => {
                        e.preventDefault();
                        if (!state.wagesLedger) state.wagesLedger = {};
                        state.activeViewType = 'wages_ledger';
                        renderSidebar(); renderTable();
                    };
                }

                // ── Audit Log nav handler ───────────────────────────────
                const sidebarAuditLog = document.getElementById('sidebar-audit-log');
                if (sidebarAuditLog) {
                    sidebarAuditLog.onclick = (e) => {
                        e.preventDefault();
                        state.activeViewType = 'audit_log';
                        renderSidebar();
                        renderTable();
                    };
                }

                // Iron Horse Expenses import via Data Management sidebar
                const sidebarImportIH = document.getElementById('sidebar-import-ironhorse-expenses');
                const sidebarImportIHInput = document.getElementById('sidebar-import-ironhorse-input');
                if (sidebarImportIH && sidebarImportIHInput) {
                    sidebarImportIH.onclick = (e) => { e.preventDefault(); sidebarImportIHInput.click(); };
                    sidebarImportIHInput.onchange = async () => {
                        const file = sidebarImportIHInput.files[0];
                        if (!file) return;
                        const yr = prompt('Import to year:', state.ihExpensesYear || String(new Date().getFullYear()));
                        if (!yr || !yr.trim()) return;
                        const mn = prompt('Import to month (e.g. JAN):', state.ihExpensesMonth || 'JAN');
                        if (!mn || !mn.trim()) return;
                        if (!state.ironHorse) state.ironHorse = {};
                        if (!state.ironHorse.expenses) state.ironHorse.expenses = {};
                        if (typeof importIronHorseExpenses === 'function') {
                            await importIronHorseExpenses(file, yr.trim(), mn.trim().toUpperCase());
                        }
                        sidebarImportIHInput.value = '';
                    };
                }
                // ── End Iron Horse nav handlers ─────────────────────────

                // Slashing / Pruning are now expandable menus; their activity-specific
                // Gantt sub-links are rendered dynamically in renderSidebar.

                const sidebarHarvestingGangs = document.getElementById('sidebar-harvesting-gangs');
                if (sidebarHarvestingGangs) {
                    sidebarHarvestingGangs.onclick = (e) => {
                        e.preventDefault();
                        state.activeViewType = 'gang_overview';
                        renderSidebar();
                        renderTable();
                    };
                }

                const sidebarMntGangs = document.getElementById('sidebar-mnt-gangs');
                if (sidebarMntGangs) {
                    sidebarMntGangs.onclick = (e) => {
                        e.preventDefault();
                        state.activeViewType = 'maintenance_gangs';
                        renderSidebar();
                        renderTable();
                    };
                }

                // Planting Phase Record — opens the main report (report_year) with a year-selector bar
                const sidebarPlanting = document.getElementById('sidebar-planting');
                if (sidebarPlanting) {
                    sidebarPlanting.onclick = (e) => {
                        e.preventDefault();
                        const years = Object.keys(state.reports || {}).filter(k => /^\d{4}$/.test(k)).sort((a, b) => parseInt(a) - parseInt(b));
                        let year = state.selectedReportYear;
                        if (!year || !years.includes(year)) year = years.length ? years[years.length - 1] : year;
                        state.selectedReportYear = year;
                        state.activeViewType = 'report_year';
                        state.activeViewValue = year;
                        renderSidebar();
                        renderTable();
                        if (typeof recalculateTotals === 'function') recalculateTotals();
                    };
                }

                // ── Selector landing pages (year/month picker in main panel) ──
                [
                    ['sidebar-interval',     'interval_month'],
                    ['sidebar-perf',         'perf_month'],
                    ['sidebar-current-prev', 'current_prev'],
                    ['sidebar-ytd',          'ytd'],
                    ['sidebar-rainfall',     'rainfall_record'],
                    ['sidebar-ffb-budget',   'ffb_budget']
                ].forEach(([linkId, target]) => {
                    const el = document.getElementById(linkId);
                    if (el) el.onclick = (e) => {
                        e.preventDefault();
                        state.activeViewType = 'selector';
                        state.selectorTarget = target;
                        renderSidebar();
                        renderTable();
                    };
                });

                const sidebarMntWorklog = document.getElementById('sidebar-mnt-worklog');
                if (sidebarMntWorklog) {
                    sidebarMntWorklog.onclick = (e) => {
                        e.preventDefault();
                        state.activeViewType = 'maintenance_worklog';
                        renderSidebar();
                        renderTable();
                    };
                }

                const sidebarMntGantt = document.getElementById('sidebar-mnt-gantt');
                if (sidebarMntGantt) {
                    sidebarMntGantt.onclick = (e) => {
                        e.preventDefault();
                        state.maintGanttFilter = '__all__';   // single Gantt link → show all activities
                        state.activeViewType = 'maintenance_gantt';
                        renderSidebar();
                        renderTable();
                    };
                }

                // Generic programmatic navigation used by in-panel section tabs
                // (e.g. Maintenance Work Log <-> Gantt). Sets state then re-renders.
                window._navTo = (viewType, patch) => {
                    if (patch) Object.assign(state, patch);
                    state.activeViewType = viewType;
                    renderSidebar();
                    renderTable();
                };

                // Dashboard home nav handler
                const sidebarDashboard = document.getElementById('sidebar-dashboard');
                if (sidebarDashboard) {
                    sidebarDashboard.onclick = (e) => {
                        e.preventDefault();
                        state.activeViewType = 'dashboard';
                        renderSidebar();
                        renderTable();
                    };
                }

                // The standalone Maintenance → Gantt Chart item was removed; the Gantt is
                // now reached via the activity menus (Slashing / Pruning → Gantt Chart).
                // ── End Maintenance nav handlers ────────────────────────

                // Bind Global Save button for Planting Phase Record
                const saveMainBtn = document.getElementById('save-main-btn');
                if (saveMainBtn) {
                    saveMainBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        saveState();
                    });
                }

                // --- RIGHT-CLICK CONTEXT MENU ---
                const ctxMenu = document.getElementById('nav-context-menu');
                const ctxNewTab = document.getElementById('nav-ctx-newtab');
                let ctxTargetHash = null;

                if (ctxMenu && ctxNewTab) {
                    document.addEventListener('contextmenu', (ev) => {
                        const navLink = ev.target.closest('[data-view-hash]');
                        if (!navLink) {
                            ctxMenu.style.display = 'none';
                            return;
                        }
                        ev.preventDefault();
                        ctxTargetHash = navLink.getAttribute('data-view-hash');
                        // Keep menu within viewport
                        const menuWidth = 160, menuHeight = 40;
                        const left = Math.min(ev.clientX, window.innerWidth - menuWidth - 8);
                        const top = Math.min(ev.clientY, window.innerHeight - menuHeight - 8);
                        ctxMenu.style.left = left + 'px';
                        ctxMenu.style.top = top + 'px';
                        ctxMenu.style.display = 'block';
                    });

                    document.addEventListener('click', () => { ctxMenu.style.display = 'none'; });
                    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') ctxMenu.style.display = 'none'; });

                    ctxNewTab.onmouseenter = () => { ctxNewTab.style.background = 'var(--group-bg)'; };
                    ctxNewTab.onmouseleave = () => { ctxNewTab.style.background = ''; };
                    ctxNewTab.onclick = () => {
                        if (ctxTargetHash) {
                            window.open(window.location.pathname + ctxTargetHash, '_blank');
                        }
                        ctxMenu.style.display = 'none';
                    };
                }

                console.log("Listeners bound. Checking cloud storage...");

                // Helper function to hydrate gangs and render
                const finishInit = () => {
                    if (!state.ffbBudget || Object.keys(state.ffbBudget).length === 0) {
                        state.ffbBudget = {};
                        if (typeof INITIAL_FFB_BUDGET !== 'undefined') {
                            state.ffbBudget["2026"] = JSON.parse(JSON.stringify(INITIAL_FFB_BUDGET));
                        }
                    }
                    if (!state.rainfall) state.rainfall = {};
                    if (!state.rainfall["2025"] && typeof INITIAL_RAINFALL_2025 !== 'undefined') {
                        state.rainfall["2025"] = JSON.parse(JSON.stringify(INITIAL_RAINFALL_2025));
                    }
                    if (!state.rainfall["2026"] && typeof INITIAL_RAINFALL_2026 !== 'undefined') {
                        state.rainfall["2026"] = JSON.parse(JSON.stringify(INITIAL_RAINFALL_2026));
                    }
                    if (!state.reports) state.reports = {};
                    if (!state.gangsByYear) state.gangsByYear = {};

                    Object.keys(state.reports).forEach(year => {
                        if (!state.gangsByYear[year] || state.gangsByYear[year].length === 0) {
                            const yearBlocks = state.reports[year] || [];
                            const uniqueGangs = [...new Set(yearBlocks.map(b => b.gang))].filter(g => g && g !== "Unassigned");
                            if (year === "2025" && typeof predefinedGangs !== 'undefined') {
                                const baseGangs = Object.keys(predefinedGangs);
                                state.gangsByYear[year] = [...new Set([...baseGangs, ...uniqueGangs])].sort();
                            } else {
                                state.gangsByYear[year] = uniqueGangs.sort();
                            }
                        }
                    });

                    // Land on the Dashboard home by default. Deep links via the
                    // URL hash (handled just below) still override this.
                    if (!window.location.hash) state.activeViewType = 'dashboard';

                    renderSidebar();
                    renderTable();
                    recalculateTotals();

                    // Apply URL hash for "Open in New Tab" deep linking
                    const hash = window.location.hash.substring(1);
                    if (hash) {
                        const params = {};
                        hash.split('&').forEach(p => {
                            const [k, v] = p.split('=');
                            if (k && v !== undefined) params[decodeURIComponent(k)] = decodeURIComponent(v);
                        });
                        if (params.view) {
                            if (params.year) state.selectedReportYear = params.year;
                            if (params.month) state.activePerfMonth = params.month;
                            state.activeViewType = params.view;
                            if (params.view === 'gang' && params.gang) state.activeViewValue = params.gang;
                            else if (params.year) state.activeViewValue = params.year;
                            renderSidebar();
                            renderTable();
                        }
                    }

                    loadingEl.classList.add('hidden');
                    // renderTable owns table visibility; only the report views show
                    // the table container (dashboard and others keep it hidden).
                    if (state.activeViewType === 'report_year' || state.activeViewType === 'gang') {
                        tableContainer.classList.remove('hidden');
                    }

                    // Load user role and apply permissions
                    loadUserRole(auth.currentUser.uid).then(() => {
                        applyRolePermissions();
                        checkFirstLogin();
                        autoBackupCheck();
                        setupActivityBackupListener();
                    });
                };

                const loadFreshData = async () => {
                    const res = await fetch('grouped_data.json');
                    if (!res.ok) throw new Error("Failed to load block data.");
                    const data = await res.json();

                    state.reports = {};
                    state.reports["2025"] = [];

                    if (data.groups) {
                        data.groups.forEach(group => {
                            const opYear = group.op_year;
                            if (group.blocks) {
                                group.blocks.forEach(b => {
                                    state.reports["2025"].push({
                                        block_id: b.block_id,
                                        ha: b.ha,
                                        op_year: opYear,
                                        gang: getGangForBlock(b.block_id)
                                    });
                                });
                            }
                        });
                    }

                    state.selectedReportYear = "2025";
                    state.activeViewType = 'report_year';
                    state.activeViewValue = "2025";

                    finishInit();
                    saveState(true); // Push fresh data to cloud
                };

                const loadLocalOrFresh = async () => {
                    const savedStateStr = localStorage.getItem('harvesting_app_state');
                    if (savedStateStr) {
                        try {
                            Object.assign(state, JSON.parse(savedStateStr));
                            finishInit();
                            saveState(true); // Migrate local data to cloud
                        } catch (e) {
                            console.error("Local storage Parse error", e);
                            await loadFreshData();
                        }
                    } else {
                        await loadFreshData();
                    }
                };

                // Main DB Fetch — shared across all users
                try {
                    let snapshot = await db.ref('shared/app_state').once('value');
                    let cloudData = snapshot.val();

                    // Check if shared state has real data (not just an empty shell written by a new user)
                    const sharedParsed = cloudData ? (() => { try { return JSON.parse(cloudData); } catch(e) { return null; } })() : null;
                    const sharedHasData = sharedParsed &&
                        (Object.keys(sharedParsed.performance || {}).length > 0 ||
                         Object.keys(sharedParsed.reports    || {}).length > 0 ||
                         Object.keys(sharedParsed.rainfall   || {}).length > 0);

                    if (!sharedHasData) {
                        // Migration: pull from old per-user path and promote to shared
                        const oldSnap = await db.ref('users/' + auth.currentUser.uid + '/app_state').once('value');
                        const oldData = oldSnap.val();
                        if (oldData) {
                            console.log("Migrating user data to shared path...");
                            await db.ref('shared/app_state').set(oldData);
                            cloudData = oldData;
                        }
                    }

                    if (cloudData) {
                        console.log("Loading shared cloud state...");
                        Object.assign(state, JSON.parse(cloudData));
                        finishInit();
                    } else {
                        console.log("No cloud state found. Checking local storage for migration...");
                        await loadLocalOrFresh();
                    }
                } catch (e) {
                    console.error("Firebase read error:", e);
                    // Fallback completely to local if offline or error
                    await loadLocalOrFresh();
                }

                // Load Spraying data (shared across all users)
                try {
                    let spraySnap = await db.ref('shared/spraying_data').once('value');
                    let sprayData = spraySnap.val();

                    // Check if shared spraying data has real content
                    const sharedSprayParsed = sprayData ? (() => { try { return JSON.parse(sprayData); } catch(e) { return null; } })() : null;
                    const sharedSprayHasData = sharedSprayParsed &&
                        Object.keys(sharedSprayParsed).some(k => /^\d{4}$/.test(k) &&
                            (sharedSprayParsed[k].phases || []).some(p => (p.blocks || []).length > 0));

                    if (!sharedSprayHasData) {
                        // Migration: pull from old per-user path
                        const oldSpraySnap = await db.ref('users/' + auth.currentUser.uid + '/spraying_data').once('value');
                        const oldSprayData = oldSpraySnap.val();
                        if (oldSprayData) {
                            console.log("Migrating spraying data to shared path...");
                            await db.ref('shared/spraying_data').set(oldSprayData);
                            sprayData = oldSprayData;
                        }
                    }
                    if (sprayData) {
                        state.spraying = JSON.parse(sprayData);
                        // Reinitialize only if the year truly has no block/phase structure
                        if (typeof getDefaultSprayingData === 'function') {
                            Object.keys(state.spraying).filter(k => /^\d{4}$/.test(k)).forEach(yr => {
                                const yd = state.spraying[yr];
                                const hasStructure = yd && yd.phases && yd.phases.length > 0 &&
                                    yd.phases.some(p => (p.blocks || []).length > 0);
                                if (!hasStructure) state.spraying[yr] = getDefaultSprayingData();
                            });
                        }
                        console.log("Spraying data loaded from cloud.");
                    } else {
                        if (!state.spraying) state.spraying = {};
                    }
                } catch (e) {
                    console.warn("Could not load spraying data:", e.message);
                    if (!state.spraying) state.spraying = {};
                }

                // Load Manuring data (shared across all users)
                try {
                    const manuringSnap = await db.ref('shared/manuring_data').once('value');
                    const manuringData = manuringSnap.val();
                    if (manuringData) {
                        state.manuring = JSON.parse(manuringData);
                        console.log("Manuring data loaded from cloud.");
                    } else {
                        if (!state.manuring) state.manuring = {};
                    }
                    // Always ensure 2025 default is present
                    if (!state.manuring['2025'] && typeof window._manuringDefault2025 !== 'undefined') {
                        state.manuring['2025'] = JSON.parse(JSON.stringify(window._manuringDefault2025));
                    }
                    window._manuringDb = db;
                } catch (e) {
                    console.warn("Could not load manuring data:", e.message);
                    if (!state.manuring) state.manuring = {};
                }

                // Load Iron Horse data (shared across all users)
                try {
                    const ihSnap = await db.ref('shared/ironhorse_data').once('value');
                    const ihData = ihSnap.val();
                    if (ihData) {
                        state.ironHorse = JSON.parse(ihData);
                        console.log("Iron Horse data loaded from cloud.");
                    } else {
                        if (!state.ironHorse) state.ironHorse = { assets: {}, expenses: {} };
                    }
                } catch (e) {
                    console.warn("Could not load Iron Horse data:", e.message);
                    if (!state.ironHorse) state.ironHorse = { assets: {}, expenses: {} };
                }

                // Load Weekly Activity data (track-driven field reports — shared).
                // Images live separately under shared/weekly_images and are loaded
                // lazily by render_weekly.js (no Firebase Storage — Blaze-only now).
                window._weeklyDb = db;
                try {
                    const wkSnap = await db.ref('shared/weekly_activity_data').once('value');
                    const wkData = wkSnap.val();
                    if (wkData) {
                        state.weekly = JSON.parse(wkData);
                        console.log("Weekly Activity data loaded from cloud.");
                    } else if (!state.weekly) {
                        state.weekly = {};
                    }
                } catch (e) {
                    console.warn("Could not load Weekly Activity data:", e.message);
                    if (!state.weekly) state.weekly = {};
                }

                // Load Rate of Wages data (payment calc — shared across all users)
                window._wagesDb = db;
                try {
                    const wgSnap = await db.ref('shared/wages_data').once('value');
                    const wgData = wgSnap.val();
                    if (wgData) {
                        state.wages = JSON.parse(wgData);
                        console.log("Wages data loaded from cloud.");
                    } else if (!state.wages) {
                        state.wages = {};
                    }
                } catch (e) {
                    console.warn("Could not load Wages data:", e.message);
                    if (!state.wages) state.wages = {};
                }

                // Load Wage Ledger data (detailed actuals import — shared across all users)
                window._wagesLedgerDb = db;
                try {
                    const wlSnap = await db.ref('shared/wages_ledger_data').once('value');
                    const wlData = wlSnap.val();
                    if (wlData) {
                        state.wagesLedger = JSON.parse(wlData);
                        console.log("Wage ledger data loaded from cloud.");
                    } else if (!state.wagesLedger) {
                        state.wagesLedger = {};
                    }
                } catch (e) {
                    console.warn("Could not load Wage Ledger data:", e.message);
                    if (!state.wagesLedger) state.wagesLedger = {};
                }

                // Load Maintenance data (gangs, work log, gantt — shared across all users)
                window._maintenanceDb = db;
                try {
                    const mntSnap = await db.ref('shared/maintenance_data').once('value');
                    const mntData = mntSnap.val();
                    if (mntData) {
                        state.maintenance = JSON.parse(mntData);
                        console.log("Maintenance data loaded from cloud.");
                    } else if (!state.maintenance) {
                        state.maintenance = {};
                    }
                } catch (e) {
                    console.warn("Could not load Maintenance data:", e.message);
                    if (!state.maintenance) state.maintenance = {};
                }

                // Sync backup settings from Firebase so all devices share the same policy
                window._backupSettingsDb = db;
                await syncBackupSettingsFromFirebase(db);

            } catch (error) {
                console.error(error);
                loadingEl.innerHTML = `< p style = "color:var(--danger)" > Error initializing dashboard: ${error.message}</p > `;
            }
        }; // end init

        init();
}; // end runMainApplication
window.runMainApplication = runMainApplication;
