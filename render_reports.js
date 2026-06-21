// render_reports.js — Excel report downloads: Harvesting YTD, Rainfall, GLY+ALLY Spraying

(function () {
    'use strict';

    const MONTHS    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const MONTHS_UP = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

    // ── Lazy-load ExcelJS from CDN ──────────────────────────────────────────
    async function ensureExcelJS() {
        if (typeof ExcelJS !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s.onload = res;
            s.onerror = () => rej(new Error('Failed to load ExcelJS library'));
            document.head.appendChild(s);
        });
    }

    async function ensureJSZip() {
        if (typeof JSZip !== 'undefined') return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
            s.onload = res;
            s.onerror = () => rej(new Error('Failed to load JSZip library'));
            document.head.appendChild(s);
        });
    }

    // Strip shared formulas from xlsx buffer to avoid ExcelJS parse errors
    // opts.stripCellStyles: also strip s="" from cells B-L rows 6-17 (needed for rainfall fill overrides)
    async function preprocessXlsx(buf, opts = {}) {
        await ensureJSZip();
        const zip = await JSZip.loadAsync(buf);

        // Fix styles.xml: cells with applyFill="0" inherit fill from the parent "Normal" style
        // (which is black). Force applyFill="1" so cells use their own fillId instead.
        const stylesFile = zip.files['xl/styles.xml'];
        if (stylesFile) {
            let stylesXml = await stylesFile.async('string');
            stylesXml = stylesXml.replace(/ applyFill="0"/g, ' applyFill="1"');
            zip.file('xl/styles.xml', stylesXml);
        }

        const sheetPaths = Object.keys(zip.files).filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
        for (const path of sheetPaths) {
            let xml = await zip.files[path].async('string');
            // Master shared formula: keep formula text, remove shared attributes
            xml = xml.replace(/<f t="shared" ref="[^"]*" si="\d+">/g, '<f>');
            // Clone shared formula (no formula text): remove the element entirely
            xml = xml.replace(/<f t="shared" si="\d+"\/>/g, '');
            // Strip column-level style attribute so cell-level fills take precedence
            xml = xml.replace(/(<col\b[^>]*?) style="[^"]*"/g, '$1');
            // Strip cell-level style only for templates that need fill overrides (e.g. rainfall)
            if (opts.stripCellStyles) {
                xml = xml.replace(/<c r="([B-L])(\d+)"([^>]*?)>/g, (match, col, row, rest) => {
                    const r = parseInt(row);
                    if (r >= 6 && r <= 17) return `<c r="${col}${row}"${rest.replace(/ s="\d+"/, '')}>`;
                    return match;
                });
            }
            zip.file(path, xml);
        }
        return zip.generateAsync({ type: 'arraybuffer' });
    }

    async function loadTemplate(filename, opts = {}) {
        const url = encodeURI('Report samples/' + filename);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Could not load template "${filename}" (${resp.status}). Make sure the app is served via HTTP, not file://.`);
        const raw = await resp.arrayBuffer();
        const buf = await preprocessXlsx(raw, opts);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        return wb;
    }

    function downloadBuffer(buf, filename) {
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        if (typeof window.logAudit === 'function') {
            window.logAudit('download', 'reports', filename, '');
        }
    }

    function setStatus(id, msg, autoClear) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = msg;
        if (autoClear) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3500);
    }

    // ── Data helpers (mirror render_ytd_report.js logic) ───────────────────
    function getYtdActual(year, blockId, mIdx) {
        let sum = 0;
        const perf = window.state.performance;
        if (!perf || !perf[year]) return 0;
        for (let i = 0; i <= mIdx; i++) {
            const mData = perf[year][MONTHS[i]];
            if (!mData) continue;
            const gang = (mData.gangAssignments || {})[String(blockId)];
            const add = (pd) => { if (!pd) return; sum += (parseFloat(pd.r1)||0)+(parseFloat(pd.r2)||0)+(parseFloat(pd.r3)||0)+(parseFloat(pd.r4)||0); };
            if (gang && mData[gang] && mData[gang].blocks) {
                add(mData[gang].blocks[String(blockId)]);
            } else {
                Object.keys(mData).forEach(k => { if (k !== 'gangAssignments' && mData[k] && mData[k].blocks) add(mData[k].blocks[String(blockId)]); });
            }
        }
        return sum;
    }

    function getYtdBudget(year, blockId, mIdx) {
        const arr = (window.state.ffbBudget && window.state.ffbBudget[year]) || [];
        const bd  = arr.find(b => String(b.block_id) === String(blockId));
        if (!bd || !Array.isArray(bd.months)) return 0;
        let s = 0;
        for (let i = 0; i <= mIdx; i++) s += parseFloat(bd.months[i] || 0);
        return s;
    }

    function getBlockHa(year, blockId) {
        const blocks = (window.state.reports && window.state.reports[year]) || [];
        const b = blocks.find(bl => String(bl.block_id) === String(blockId));
        return b ? (parseFloat(b.ha) || 0) : 0;
    }

    // ══════════════════════════════════════════════════════════════════════
    // 1. HARVESTING PERFORMANCE YTD REPORT
    //    Template: "Havesting Performance Dec 2025.xlsx"
    //    Sheet:    "OVERALL BY GANG COMPARISON YTD2"
    // ══════════════════════════════════════════════════════════════════════

    // Fixed row layout matching the template sheet (1-indexed Excel rows)
    const YTD_PHASES = [
        { op:"2010", subtotalRow:6,
          blocks:[{id:"1",r:7},{id:"2",r:8},{id:"3",r:9},{id:"4",r:10},
                  {id:"5",r:11},{id:"6",r:12},{id:"7",r:13},{id:"8",r:14},
                  {id:"9",r:15},{id:"11",r:16},{id:"12",r:17},{id:"23",r:18}] },
        { op:"2011", subtotalRow:20,
          blocks:[{id:"10",r:21},{id:"13",r:22},{id:"14",r:23},{id:"15",r:24},
                  {id:"16",r:25},{id:"17",r:26},{id:"18",r:27}] },
        { op:"2012", subtotalRow:29,
          blocks:[{id:"19",r:30},{id:"20",r:31},{id:"21",r:32},{id:"22",r:33},{id:"24",r:34}] },
        { op:"2015", subtotalRow:36,
          blocks:[{id:"25",r:37},{id:"26A",r:38},{id:"27",r:39},{id:"28",r:40},
                  {id:"29",r:41},{id:"30",r:42},{id:"31",r:43}] },
        { op:"2016", subtotalRow:45,
          blocks:[{id:"33",r:46},{id:"39",r:47}] }
    ];
    const YTD_GRAND_ROW = 49;

    window.downloadYtdReport = async (year, month) => {
        setStatus('rep-ytd-status', 'Generating…');
        try {
            await ensureExcelJS();
            const wb = await loadTemplate('Havesting Performance Dec 2025.xlsx', { stripCellStyles: false });
            const ws = wb.getWorksheet('OVERALL BY GANG COMPARISON YTD2');
            if (!ws) throw new Error('Worksheet "OVERALL BY GANG COMPARISON YTD2" not found');

            const prevYear = String(parseInt(year) - 1);
            const mIdx    = MONTHS.indexOf(month);
            const mLabel  = MONTHS_UP[mIdx];

            // Write value only — leave template numFmt and borders intact
            const setN = (r, c, v) => {
                ws.getCell(r, c).value = parseFloat(v.toFixed(2));
            };

            // Title + year headers
            ws.getCell('A1').value = `YIELD TO DATE OF CURRENT YEAR VS. PAST YEAR (UP TO ${mLabel} ${year})`;
            ws.getCell('D5').value = parseInt(year);
            ws.getCell('F5').value = parseInt(prevYear);
            ws.getCell('H5').value = `${year} vs ${prevYear}`;
            ws.getCell('I5').value = parseInt(year);
            ws.getCell('J5').value = parseInt(prevYear);

            let gHA=0, gCB=0, gCA=0, gPB=0, gPA=0;

            YTD_PHASES.forEach(phase => {
                let pHA=0, pCB=0, pCA=0, pPB=0, pPA=0;

                phase.blocks.forEach((blk, bIdx) => {
                    const ha   = getBlockHa(year, blk.id) || getBlockHa(prevYear, blk.id);
                    const cBud = getYtdBudget(year, blk.id, mIdx);
                    const cAct = getYtdActual(year, blk.id, mIdx);
                    const pBud = getYtdBudget(prevYear, blk.id, mIdx);
                    const pAct = getYtdActual(prevYear, blk.id, mIdx);
                    const varr = cAct - pAct;
                    const cMH  = ha > 0 ? cAct / ha : 0;
                    const pMH  = ha > 0 ? pAct / ha : 0;
                    const row  = blk.r;

                    ws.getCell(row, 1).value = parseInt(blk.id) || blk.id;
                    ws.getCell(row, 2).value = parseInt(phase.op);
                    setN(row, 3, ha);
                    setN(row, 4, cBud);
                    setN(row, 5, cAct);
                    setN(row, 6, pBud);
                    setN(row, 7, pAct);
                    setN(row, 8, varr);
                    setN(row, 9, cMH);
                    setN(row, 10, pMH);

                    pHA += ha; pCB += cBud; pCA += cAct; pPB += pBud; pPA += pAct;
                });

                const sr   = phase.subtotalRow;
                const pVar = pCA - pPA;
                const pCMH = pHA > 0 ? pCA / pHA : 0;
                const pPMH = pHA > 0 ? pPA / pHA : 0;

                ws.getCell(sr, 1).value = null;
                ws.getCell(sr, 2).value = parseInt(phase.op);
                setN(sr, 3, pHA);
                setN(sr, 4, pCB);
                setN(sr, 5, pCA);
                setN(sr, 6, pPB);
                setN(sr, 7, pPA);
                setN(sr, 8, pVar);
                setN(sr, 9, pCMH);
                setN(sr, 10, pPMH);

                gHA+=pHA; gCB+=pCB; gCA+=pCA; gPB+=pPB; gPA+=pPA;
            });

            const gVar = gCA - gPA;
            const gCMH = gHA > 0 ? gCA / gHA : 0;
            const gPMH = gHA > 0 ? gPA / gHA : 0;
            setN(YTD_GRAND_ROW, 3, gHA);
            setN(YTD_GRAND_ROW, 4, gCB);
            setN(YTD_GRAND_ROW, 5, gCA);
            setN(YTD_GRAND_ROW, 6, gPB);
            setN(YTD_GRAND_ROW, 7, gPA);
            setN(YTD_GRAND_ROW, 8, gVar);
            setN(YTD_GRAND_ROW, 9, gCMH);
            setN(YTD_GRAND_ROW, 10, gPMH);

            // Clear template footer notes
            for (let r = 52; r <= 55; r++) {
                for (let c = 1; c <= 10; c++) ws.getCell(r, c).value = null;
            }

            // Remove all sheets except the one we need
            wb.worksheets.filter(s => s.name !== 'OVERALL BY GANG COMPARISON YTD2')
                         .forEach(s => wb.removeWorksheet(s.id));

            const buf = await wb.xlsx.writeBuffer();
            downloadBuffer(buf, `Harvesting_YTD_${mLabel}_${year}.xlsx`);
            setStatus('rep-ytd-status', '✅ Downloaded!', true);
        } catch (e) {
            console.error('YTD report error:', e);
            setStatus('rep-ytd-status', `❌ ${e.message}`);
        }
    };

    // ══════════════════════════════════════════════════════════════════════
    // 2. RAINFALL COMPARISON REPORT
    //    Template: "Rainfall 2024 vs 2025 up to Dec 2025.xlsx"
    //    Sheet:    "Dec Rainfall 2024 vs 2025"
    // ══════════════════════════════════════════════════════════════════════

    window.downloadRainfallReport = async (year, month) => {
        setStatus('rep-rain-status', 'Generating…');
        try {
            await ensureExcelJS();
            const wb = await loadTemplate('Rainfall 2024 vs 2025 up to Dec 2025.xlsx', { stripCellStyles: false });
            const ws = wb.getWorksheet('Dec Rainfall 2024 vs 2025');
            if (!ws) throw new Error('Rainfall worksheet not found');

            const prevYear = String(parseInt(year) - 1);
            const mIdx    = MONTHS.indexOf(month);
            const mLabel  = MONTHS_UP[mIdx];
            const rfCurr  = (window.state.rainfall && window.state.rainfall[year])     || {};
            const rfPrev  = (window.state.rainfall && window.state.rainfall[prevYear]) || {};

            const BLACK_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
            const WHITE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

            // Helper — set value then immediately override fill so template black fills don't win
            const setCell = (row, col, val, fill) => {
                const c = ws.getCell(row, col);
                c.value = val != null && val !== 0 ? val : null;
                c.fill  = fill;
            };

            // Clear extra template columns (N onwards — values only, leave borders intact)
            for (let r = 1; r <= 50; r++) {
                for (let c = 14; c <= 30; c++) {
                    ws.getCell(r, c).value = null;
                }
            }

            // Title and year headers
            ws.getCell('A1').value = `SUMMARY REPORT FOR RAINFALL RECORD FOR THE YEAR ${prevYear} VS ${year} (Updated as of ${mLabel} ${year})`;
            ws.getCell('B3').value = parseInt(prevYear);
            ws.getCell('F3').value = parseInt(year);
            ws.getCell('J3').value = `${year} vs ${prevYear}`;

            let prevCum=0, currCum=0;
            let totPrevD=0, totPrevM=0, totCurrD=0, totCurrM=0;
            // YTD totals for prev year — only months 0..mIdx (for correct DIFF comparison)
            let totPrevDYtd=0, totPrevMYtd=0, prevCumYtd=0;

            for (let i = 0; i < 12; i++) {
                const row  = 6 + i;
                const mKey = MONTHS_UP[i];

                // Previous year — all 12 months always shown, white fill applied inline
                const pd    = rfPrev[mKey] || {};
                const prevD = parseFloat(pd.days) || 0;
                const prevM = parseFloat(pd.mm)   || 0;
                prevCum += prevM;
                setCell(row, 2, prevD, WHITE_FILL);
                setCell(row, 3, prevM, WHITE_FILL);
                setCell(row, 4, prevCum, WHITE_FILL);
                totPrevD += prevD; totPrevM += prevM;

                if (i <= mIdx) {
                    // Current year — fill up to selected month
                    const cd    = rfCurr[mKey] || {};
                    const currD = parseFloat(cd.days) || 0;
                    const currM = parseFloat(cd.mm)   || 0;
                    currCum += currM;
                    setCell(row, 6,  currD,          WHITE_FILL);
                    setCell(row, 7,  currM,          WHITE_FILL);
                    setCell(row, 8,  currCum,        WHITE_FILL);
                    setCell(row, 10, currD - prevD,  WHITE_FILL);
                    setCell(row, 11, currM - prevM,  WHITE_FILL);
                    setCell(row, 12, currCum - prevCum, WHITE_FILL);
                    totCurrD += currD; totCurrM += currM;
                    // Track YTD prev totals for correct DIFF in total row
                    totPrevDYtd += prevD; totPrevMYtd += prevM;
                    prevCumYtd = prevCum;
                } else {
                    // Future months — black fill, no data
                    [6, 7, 8, 10, 11, 12].forEach(c => {
                        ws.getCell(row, c).value = null;
                        ws.getCell(row, c).fill  = BLACK_FILL;
                    });
                }
            }

            // Total row (row 18)
            // Prev year shows full-year total; curr year shows YTD; DIFF compares YTD-to-YTD
            ws.getCell(18, 2).value  = totPrevD;
            ws.getCell(18, 3).value  = totPrevM;
            ws.getCell(18, 4).value  = prevCum;
            ws.getCell(18, 6).value  = totCurrD;
            ws.getCell(18, 7).value  = totCurrM;
            ws.getCell(18, 8).value  = currCum;
            ws.getCell(18, 10).value = totCurrD - totPrevDYtd;
            ws.getCell(18, 11).value = totCurrM - totPrevMYtd;

            // Summary notes (rows 22-27) — diff uses YTD of both years through selected month
            const diff = Math.round(currCum - prevCumYtd);
            ws.getCell('A22').value = `MM TO MONTH ${year} vs ${prevYear}`;
            ws.getCell('A23').value = Math.abs(diff);
            ws.getCell('A24').value = parseInt(prevYear);
            ws.getCell('B24').value = diff >= 0 ? '<' : '>';
            ws.getCell('C24').value = parseInt(year);
            ws.getCell('A26').value = `*MM TO MONTH as of ${mLabel} for both years`;
            ws.getCell('A27').value = diff >= 0
                ? `**${year} MM TO MONTH is more than ${prevYear} by ${Math.abs(diff)}`
                : `**${year} MM TO MONTH is less than ${prevYear} by ${Math.abs(diff)}`;

            // Keep only the rainfall sheet
            wb.worksheets.filter(s => s.name !== 'Dec Rainfall 2024 vs 2025')
                         .forEach(s => wb.removeWorksheet(s.id));

            const buf = await wb.xlsx.writeBuffer();
            downloadBuffer(buf, `Rainfall_${prevYear}_vs_${year}_${mLabel}_${year}.xlsx`);
            setStatus('rep-rain-status', '✅ Downloaded!', true);
        } catch (e) {
            console.error('Rainfall report error:', e);
            setStatus('rep-rain-status', `❌ ${e.message}`);
        }
    };

    // ══════════════════════════════════════════════════════════════════════
    // 3. SPRAYING GLY+ALLY ANNUAL REPORT
    //    Template: "Spraying Maintenance 2025.xlsx"
    //    Sheet:    "GLY + ALLY 20225 (2)"
    //
    //    Structure: split into JAN-JUN (rows 1-145) and JUL-DEC (rows 146-285)
    //    Each phase section: label + header + 2 empty + sub-header + blocks (3 rows each) + totals
    //    JUL-DEC section has an extra TOTAL column (cols S/T = 19/20) = full-year sum per block
    // ══════════════════════════════════════════════════════════════════════

    const SPRAY_PHASES = [
        { op: "OP2010",
          janjun: { start: 11,  nlg: 47,  ha: 48,  blocks: ["1","2","3","4","5","6","7","8","9","11","12","23"] },
          juldec: { start: 151, nlg: 187, ha: 188, blocks: ["1","2","3","4","5","6","7","8","9","11","12","23"] } },
        { op: "OP2011",
          janjun: { start: 54,  nlg: 75,  ha: 76,  blocks: ["10","13","14","15","16","17","18"] },
          juldec: { start: 194, nlg: 215, ha: 216, blocks: ["10","13","14","15","16","17","18"] } },
        { op: "OP2012",
          janjun: { start: 82,  nlg: 97,  ha: 98,  blocks: ["19","20","21","22","24"] },
          juldec: { start: 222, nlg: 237, ha: 238, blocks: ["19","20","21","22","24"] } },
        { op: "OP2015",
          janjun: { start: 104, nlg: 131, ha: 132, blocks: ["25","26A","26B","27","28","29","30","31","32"] },
          juldec: { start: 244, nlg: 271, ha: 272, blocks: ["25","26A","26B","27","28","29","30","31","32"] } },
        { op: "OP2016",
          janjun: { start: 138, nlg: 144, ha: 145, blocks: ["33","39"] },
          juldec: { start: 278, nlg: 284, ha: 285, blocks: ["33","39"] } }
    ];

    // Column numbers (1-indexed) for GLY in each month slot
    const JJ_COLS = { JAN:7, FEB:9, MAR:11, APR:13, MAY:15, JUN:17 };  // ALY = GLY+1
    const JD_COLS = { JUL:7, AUG:9, SEP:11, OCT:13, NOV:15, DEC:17 };  // ALY = GLY+1
    const TOTAL_GLY_COL = 19;  // col S in JUL-DEC section = full-year GLY total
    const TOTAL_ALY_COL = 20;  // col T in JUL-DEC section = full-year ALY total
    const JJ_MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN"];
    const JD_MONTHS = ["JUL","AUG","SEP","OCT","NOV","DEC"];

    function getSprayBlk(year, blockId) {
        if (!window.state.spraying || !window.state.spraying[year]) return null;
        for (const ph of (window.state.spraying[year].phases || [])) {
            const b = (ph.blocks || []).find(b => String(b.blockNo) === String(blockId));
            if (b) return b;
        }
        return null;
    }

    function fillHalf(ws, section, colMap, halfMonths, year) {
        const tGly={}, tAly={}, tHGly={}, tHAly={};
        halfMonths.forEach(m => { tGly[m]=0; tAly[m]=0; tHGly[m]=0; tHAly[m]=0; });
        let grandGly=0, grandAly=0, grandHGly=0, grandHAly=0;
        let totalHaPrev=0, totalHaPresent=0;
        const isJulDec = halfMonths[0] === 'JUL';

        section.blocks.forEach((blockId, bIdx) => {
            const base = section.start + bIdx * 3;
            const rRow = base, nRow = base + 1, hRow = base + 2;
            const blk  = getSprayBlk(year, blockId);

            // Clear all month data columns for this block
            halfMonths.forEach(m => {
                const g = colMap[m];
                ws.getCell(rRow, g).value   = null; ws.getCell(rRow, g+1).value = null;
                ws.getCell(nRow, g).value   = null; ws.getCell(nRow, g+1).value = null;
                ws.getCell(hRow, g).value   = null; ws.getCell(hRow, g+1).value = null;
            });
            if (isJulDec) {
                ws.getCell(nRow, TOTAL_GLY_COL).value = null; ws.getCell(nRow, TOTAL_ALY_COL).value = null;
                ws.getCell(hRow, TOTAL_GLY_COL).value = null; ws.getCell(hRow, TOTAL_ALY_COL).value = null;
            }

            if (!blk) return;

            // Update Ha Previous / Ha Present on the Round row
            const haPrev    = parseFloat(blk.haPrevious) || 0;
            const haPresent = parseFloat(blk.haPresent)  || 0;
            ws.getCell(rRow, 4).value = haPrev    || null;
            ws.getCell(rRow, 5).value = haPresent || null;
            totalHaPrev    += haPrev;
            totalHaPresent += haPresent;

            halfMonths.forEach(m => {
                const md  = (blk.months || {})[m] || {};
                const g   = colMap[m];
                const rG  = (md.roundGly !== undefined && md.roundGly !== '') ? (parseFloat(md.roundGly) || md.roundGly) : null;
                const rA  = (md.roundAly !== undefined && md.roundAly !== '') ? (parseFloat(md.roundAly) || md.roundAly) : null;
                const lG  = parseFloat(md.litresGly) || 0;
                const gA  = parseFloat(md.gmAly)     || 0;
                const hG  = parseFloat(md.haGly)     || 0;
                const hA  = parseFloat(md.haAly)     || 0;

                if (rG !== null) ws.getCell(rRow, g).value   = rG;
                if (rA !== null) ws.getCell(rRow, g+1).value = rA;
                if (lG > 0)     ws.getCell(nRow, g).value   = lG;
                if (gA > 0)     ws.getCell(nRow, g+1).value = gA;
                if (hG > 0)     ws.getCell(hRow, g).value   = hG;
                if (hA > 0)     ws.getCell(hRow, g+1).value = hA;

                tGly[m]  += lG; tAly[m]  += gA;
                tHGly[m] += hG; tHAly[m] += hA;
            });

            // For JUL-DEC section: TOTAL column = full-year sum (all 12 months)
            if (isJulDec) {
                let bGly=0, bAly=0, bHGly=0, bHAly=0;
                MONTHS_UP.forEach(m => {
                    const md = (blk.months || {})[m] || {};
                    bGly  += parseFloat(md.litresGly) || 0;
                    bAly  += parseFloat(md.gmAly)     || 0;
                    bHGly += parseFloat(md.haGly)     || 0;
                    bHAly += parseFloat(md.haAly)     || 0;
                });
                ws.getCell(nRow, TOTAL_GLY_COL).value = bGly  || null;
                ws.getCell(nRow, TOTAL_ALY_COL).value = bAly  || null;
                ws.getCell(hRow, TOTAL_GLY_COL).value = bHGly || null;
                ws.getCell(hRow, TOTAL_ALY_COL).value = bHAly || null;
                grandGly  += bGly;  grandAly  += bAly;
                grandHGly += bHGly; grandHAly += bHAly;
            }
        });

        // Phase total rows
        halfMonths.forEach(m => {
            const g = colMap[m];
            ws.getCell(section.nlg, g).value   = tGly[m]  || 0;
            ws.getCell(section.nlg, g+1).value = tAly[m]  || 0;
            ws.getCell(section.ha,  g).value   = tHGly[m] || 0;
            ws.getCell(section.ha,  g+1).value = tHAly[m] || 0;
        });
        // Ha totals in the No.Litre/GM total row (col D/E)
        ws.getCell(section.nlg, 4).value = parseFloat(totalHaPrev.toFixed(2))    || null;
        ws.getCell(section.nlg, 5).value = parseFloat(totalHaPresent.toFixed(2)) || null;

        if (isJulDec) {
            ws.getCell(section.nlg, TOTAL_GLY_COL).value = grandGly  || 0;
            ws.getCell(section.nlg, TOTAL_ALY_COL).value = grandAly  || 0;
            ws.getCell(section.ha,  TOTAL_GLY_COL).value = grandHGly || 0;
            ws.getCell(section.ha,  TOTAL_ALY_COL).value = grandHAly || 0;
        }
    }

    // Build a simple worksheet XML for extra chemicals (inline strings + numbers)
    function buildExtraChemSheetXml(year, activeMonths, extraChemicals) {
        const sprayData = window.state.spraying && window.state.spraying[year];

        function cl(n) { let s=''; while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s; }
        function esc(v) { return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
        function sCell(c,r,v){ return `<c r="${cl(c)}${r}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`; }
        function nCell(c,r,v){ const n=parseFloat(v); return isNaN(n)||n===0 ? `<c r="${cl(c)}${r}"/>` : `<c r="${cl(c)}${r}"><v>${n}</v></c>`; }

        const rows = [];
        // Header row
        let hRow = `<row r="1">${sCell(1,1,'Phase')}${sCell(2,1,'Block')}${sCell(3,1,'Month')}`;
        extraChemicals.forEach((c,i) => { hRow += sCell(4+i, 1, `${c.name} (${c.uom})`); });
        hRow += `</row>`;
        rows.push(hRow);

        let rIdx = 2;
        if (sprayData) {
            (sprayData.phases || []).forEach(ph => {
                (ph.blocks || []).forEach(blk => {
                    activeMonths.forEach(m => {
                        const extras = blk.months?.[m]?.extras || {};
                        if (!extraChemicals.some(c => extras[c.name] !== undefined && extras[c.name] !== '')) return;
                        let dRow = `<row r="${rIdx}">${sCell(1,rIdx,ph.phaseName)}${sCell(2,rIdx,blk.blockNo)}${sCell(3,rIdx,m)}`;
                        extraChemicals.forEach((c,i) => { dRow += nCell(4+i, rIdx, extras[c.name] ?? ''); });
                        dRow += `</row>`;
                        rows.push(dRow);
                        rIdx++;
                    });
                });
            });
        }

        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
            + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
            + `<sheetData>${rows.join('')}</sheetData></worksheet>`;
    }

    window.downloadSprayingReport = async (year, month) => {
        setStatus('rep-spray-status', 'Generating…');
        try {
            await ensureJSZip();

            // Bypass ExcelJS entirely — manipulate XML directly to preserve all formatting
            // (merged cells, borders, col widths, col C hidden) from the template unchanged.
            console.log('[Spraying v13] fetching template for year', year);
            const resp = await fetch(encodeURI('Report samples/Spraying Maintenance 2025.xlsx'));
            if (!resp.ok) throw new Error(`Could not load template (${resp.status})`);
            const zip = await JSZip.loadAsync(await resp.arrayBuffer());
            console.log('[Spraying v13] zip files:', Object.keys(zip.files).filter(f => f.startsWith('xl/worksheets')));
            let xml = await zip.files['xl/worksheets/sheet4.xml'].async('string');
            console.log('[Spraying v13] sheet4.xml length:', xml.length);

            // Strip shared formulas so Excel won't recalculate over our written values
            xml = xml.replace(/<f t="shared" ref="[^"]*" si="\d+">[^<]*<\/f>/g, '');
            xml = xml.replace(/<f t="shared" ref="[^"]*" si="\d+"\/>/g, '');
            xml = xml.replace(/<f t="shared" si="\d+"\/>/g, '');
            xml = xml.replace(/<f>[^<]*<\/f>/g, '');

            // Guard: require spraying data before blanking the template
            const sprayData = window.state.spraying && window.state.spraying[year];
            if (!sprayData || !(sprayData.phases || []).some(p => (p.blocks || []).length > 0)) {
                setStatus('rep-spray-status', `❌ No spraying data for ${year}. Enter data in the Spraying section first.`, true);
                return;
            }

            // Filter months up to and including the selected month
            const cutIdx     = month ? MONTHS_UP.indexOf(month.toUpperCase()) : 11;
            const activeJJ   = JJ_MONTHS.filter(m => MONTHS_UP.indexOf(m) <= cutIdx);
            const activeJD   = JD_MONTHS.filter(m => MONTHS_UP.indexOf(m) <= cutIdx);
            const activeFull = MONTHS_UP.filter((_, i) => i <= cutIdx);

            // Convert 1-indexed column number → letter(s)
            function colLetter(n) {
                let s = '';
                while (n > 0) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); }
                return s;
            }

            // Set or clear a numeric cell value directly in the sheet XML.
            // Skips string cells (t="s"). Strips any formula — we own the value.
            function setNum(row, col, value) {
                const ref = colLetter(col) + row;
                const numStr = (value !== null && value !== undefined) ? String(Math.round(value * 1e9) / 1e9) : null;
                let matched = false;

                // Self-closing cell <c r="REF" attrs/>
                xml = xml.replace(new RegExp(`<c r="${ref}"([^>]*)\\/>`), (m, attrs) => {
                    matched = true;
                    if (/t="s"/.test(attrs)) return m;
                    return numStr ? `<c r="${ref}"${attrs}><v>${numStr}</v></c>` : m;
                });

                if (!matched) {
                    // Cell with content <c r="REF" attrs>...</c>  (value, formula, or both)
                    xml = xml.replace(new RegExp(`<c r="${ref}"([^>]*)>([\\s\\S]*?)<\\/c>`), (m, attrs, _content) => {
                        matched = true;
                        if (/t="s"/.test(attrs)) return m;
                        attrs = attrs.replace(/\s+t="[^"]*"/, '');
                        return numStr ? `<c r="${ref}"${attrs}><v>${numStr}</v></c>` : `<c r="${ref}"${attrs}/>`;
                    });
                }

                // Cell absent from XML entirely (empty template cell) — insert into the row
                if (!matched && numStr) {
                    xml = xml.replace(new RegExp(`(<row\\b[^>]* r="${row}"[^>]*>)([\\s\\S]*?)(<\\/row>)`), (m, open, content, close) => {
                        const newCell = `<c r="${ref}"><v>${numStr}</v></c>`;
                        let placed = false;
                        const updated = content.replace(/<c r="([A-Z]+)\d+"/g, (cm, cRef) => {
                            if (placed) return cm;
                            const cCol = cRef.split('').reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0);
                            if (cCol > col) { placed = true; return newCell + cm; }
                            return cm;
                        });
                        return open + (placed ? updated : content + newCell) + close;
                    });
                }
            }

            // Mirror of fillHalf but writing directly to XML
            // clearMonths = full half (JAN-JUN or JUL-DEC) — always cleared to remove template data
            // activeMonths = filtered subset — only these months get data written
            function fillHalfXml(section, colMap, clearMonths, activeMonths, allActive) {
                const tGly={}, tAly={}, tHGly={}, tHAly={};
                clearMonths.forEach(m => { tGly[m]=0; tAly[m]=0; tHGly[m]=0; tHAly[m]=0; });
                let grandGly=0, grandAly=0, grandHGly=0, grandHAly=0;
                let totalHaPrev=0, totalHaPresent=0;
                const isJulDec = clearMonths[0] === 'JUL';

                section.blocks.forEach((blockId, bIdx) => {
                    const base = section.start + bIdx * 3;
                    const rRow = base, nRow = base + 1, hRow = base + 2;
                    const blk  = getSprayBlk(year, blockId);

                    // Always clear all cells for this half so template data is wiped
                    clearMonths.forEach(m => {
                        const g = colMap[m];
                        setNum(rRow, g, null); setNum(rRow, g+1, null);
                        setNum(nRow, g, null); setNum(nRow, g+1, null);
                        setNum(hRow, g, null); setNum(hRow, g+1, null);
                    });
                    if (isJulDec) {
                        setNum(nRow, TOTAL_GLY_COL, null); setNum(nRow, TOTAL_ALY_COL, null);
                        setNum(hRow, TOTAL_GLY_COL, null); setNum(hRow, TOTAL_ALY_COL, null);
                    }

                    if (!blk) return;

                    const haPrev    = parseFloat(blk.haPrevious) || 0;
                    const haPresent = parseFloat(blk.haPresent)  || 0;
                    setNum(rRow, 4, haPrev    || null);
                    setNum(rRow, 5, haPresent || null);
                    totalHaPrev    += haPrev;
                    totalHaPresent += haPresent;

                    // Only write data for months up to the selected month
                    activeMonths.forEach(m => {
                        const md = (blk.months || {})[m] || {};
                        const g  = colMap[m];
                        const rG = (md.roundGly !== undefined && md.roundGly !== '') ? (parseFloat(md.roundGly) || md.roundGly) : null;
                        const rA = (md.roundAly !== undefined && md.roundAly !== '') ? (parseFloat(md.roundAly) || md.roundAly) : null;
                        const lG = parseFloat(md.litresGly) || 0;
                        const gA = parseFloat(md.gmAly)     || 0;
                        const hG = parseFloat(md.haGly)     || 0;
                        const hA = parseFloat(md.haAly)     || 0;

                        if (rG !== null) setNum(rRow, g,   rG);
                        if (rA !== null) setNum(rRow, g+1, rA);
                        if (lG > 0)     setNum(nRow, g,   lG);
                        if (gA > 0)     setNum(nRow, g+1, gA);
                        if (hG > 0)     setNum(hRow, g,   hG);
                        if (hA > 0)     setNum(hRow, g+1, hA);

                        tGly[m] += lG; tAly[m] += gA;
                        tHGly[m] += hG; tHAly[m] += hA;
                    });

                    if (isJulDec) {
                        let bGly=0, bAly=0, bHGly=0, bHAly=0;
                        allActive.forEach(m => {
                            const md = (blk.months || {})[m] || {};
                            bGly  += parseFloat(md.litresGly) || 0;
                            bAly  += parseFloat(md.gmAly)     || 0;
                            bHGly += parseFloat(md.haGly)     || 0;
                            bHAly += parseFloat(md.haAly)     || 0;
                        });
                        setNum(nRow, TOTAL_GLY_COL, bGly);
                        setNum(nRow, TOTAL_ALY_COL, bAly);
                        setNum(hRow, TOTAL_GLY_COL, bHGly);
                        setNum(hRow, TOTAL_ALY_COL, bHAly);
                        grandGly += bGly; grandAly += bAly;
                        grandHGly += bHGly; grandHAly += bHAly;
                    }
                });

                // Write section totals for all clearMonths — inactive months write 0, clearing template values
                clearMonths.forEach(m => {
                    const g = colMap[m];
                    setNum(section.nlg, g,   tGly[m]  || 0);
                    setNum(section.nlg, g+1, tAly[m]  || 0);
                    setNum(section.ha,  g,   tHGly[m] || 0);
                    setNum(section.ha,  g+1, tHAly[m] || 0);
                });
                setNum(section.nlg, 4, parseFloat(totalHaPrev.toFixed(2))    || null);
                setNum(section.nlg, 5, parseFloat(totalHaPresent.toFixed(2)) || null);
                if (isJulDec) {
                    setNum(section.nlg, TOTAL_GLY_COL, grandGly  || 0);
                    setNum(section.nlg, TOTAL_ALY_COL, grandAly  || 0);
                    setNum(section.ha,  TOTAL_GLY_COL, grandHGly || 0);
                    setNum(section.ha,  TOTAL_ALY_COL, grandHAly || 0);
                }
            }

            let cellsWritten = 0;
            const _origSetNum = setNum;
            // patch setNum to count writes
            const _patchedSetNum = setNum;
            SPRAY_PHASES.forEach(ph => {
                fillHalfXml(ph.janjun, JJ_COLS, JJ_MONTHS, activeJJ, activeFull);
                fillHalfXml(ph.juldec, JD_COLS, JD_MONTHS, activeJD, activeFull);
            });
            console.log('[Spraying v14] xml length after writes:', xml.length);

            // Row 286: grand Ha totals
            let grandHaPrev=0, grandHaPresent=0;
            SPRAY_PHASES.forEach(ph => {
                ph.janjun.blocks.forEach(id => {
                    const blk = getSprayBlk(year, id);
                    if (!blk) return;
                    grandHaPrev    += parseFloat(blk.haPrevious) || 0;
                    grandHaPresent += parseFloat(blk.haPresent)  || 0;
                });
            });
            setNum(286, 4, parseFloat(grandHaPrev.toFixed(2)));
            setNum(286, 5, parseFloat(grandHaPresent.toFixed(2)));

            // Rows 292-293 (JAN-JUN overall) and 297-298 (JUL-DEC overall + TOTAL)
            const sumJJ = { gly:{}, aly:{}, hGly:{}, hAly:{} };
            const sumJD = { gly:{}, aly:{}, hGly:{}, hAly:{} };
            activeJJ.forEach(m => { sumJJ.gly[m]=0; sumJJ.aly[m]=0; sumJJ.hGly[m]=0; sumJJ.hAly[m]=0; });
            activeJD.forEach(m => { sumJD.gly[m]=0; sumJD.aly[m]=0; sumJD.hGly[m]=0; sumJD.hAly[m]=0; });
            let grandTotGly=0, grandTotAly=0, grandTotHGly=0, grandTotHAly=0;
            if (sprayData) {
                (sprayData.phases || []).forEach(ph => {
                    (ph.blocks || []).forEach(blk => {
                        activeJJ.forEach(m => {
                            const md = (blk.months || {})[m] || {};
                            sumJJ.gly[m]  += parseFloat(md.litresGly) || 0;
                            sumJJ.aly[m]  += parseFloat(md.gmAly)     || 0;
                            sumJJ.hGly[m] += parseFloat(md.haGly)     || 0;
                            sumJJ.hAly[m] += parseFloat(md.haAly)     || 0;
                        });
                        activeJD.forEach(m => {
                            const md = (blk.months || {})[m] || {};
                            sumJD.gly[m]  += parseFloat(md.litresGly) || 0;
                            sumJD.aly[m]  += parseFloat(md.gmAly)     || 0;
                            sumJD.hGly[m] += parseFloat(md.haGly)     || 0;
                            sumJD.hAly[m] += parseFloat(md.haAly)     || 0;
                        });
                        activeFull.forEach(m => {
                            const md = (blk.months || {})[m] || {};
                            grandTotGly  += parseFloat(md.litresGly) || 0;
                            grandTotAly  += parseFloat(md.gmAly)     || 0;
                            grandTotHGly += parseFloat(md.haGly)     || 0;
                            grandTotHAly += parseFloat(md.haAly)     || 0;
                        });
                    });
                });
            }
            // Use full month lists here so inactive months write 0, clearing any template values
            JJ_MONTHS.forEach(m => {
                const g = JJ_COLS[m];
                setNum(292, g,   sumJJ.gly[m]  || 0);
                setNum(292, g+1, sumJJ.aly[m]  || 0);
                setNum(293, g,   sumJJ.hGly[m] || 0);
                setNum(293, g+1, sumJJ.hAly[m] || 0);
            });
            JD_MONTHS.forEach(m => {
                const g = JD_COLS[m];
                setNum(297, g,   sumJD.gly[m]  || 0);
                setNum(297, g+1, sumJD.aly[m]  || 0);
                setNum(298, g,   sumJD.hGly[m] || 0);
                setNum(298, g+1, sumJD.hAly[m] || 0);
            });
            setNum(297, TOTAL_GLY_COL, grandTotGly  || 0);
            setNum(297, TOTAL_ALY_COL, grandTotAly  || 0);
            setNum(298, TOTAL_GLY_COL, grandTotHGly || 0);
            setNum(298, TOTAL_ALY_COL, grandTotHAly || 0);

            // Remove autoFilter (dropdown arrows) from sheet XML
            xml = xml.replace(/<autoFilter[^>]*\/>/g, '');
            xml = xml.replace(/<autoFilter[^>]*>[\s\S]*?<\/autoFilter>/g, '');

            zip.file('xl/worksheets/sheet4.xml', xml);

            // Keep only the GLY+ALLY sheet — strip all other sheets from zip
            let relsXml = await zip.files['xl/_rels/workbook.xml.rels'].async('string');
            // Find sheet4's actual file target from its relationship
            const sheet4TargetMatch = relsXml.match(/Id="rId4"[^>]*Target="([^"]+)"/);
            const sheet4File = sheet4TargetMatch ? sheet4TargetMatch[1].split('/').pop() : 'sheet4.xml';
            // Remove all worksheet relationships except rId4
            relsXml = relsXml.replace(/<Relationship\b[^>]*\bType="[^"]*worksheet[^"]*"[^>]*\/>/g, m =>
                /Id="rId4"/.test(m) ? m : '');
            zip.file('xl/_rels/workbook.xml.rels', relsXml);
            // Update workbook.xml: keep only sheet4 entry, rename tab, reset activeTab
            let wbXml = await zip.files['xl/workbook.xml'].async('string');
            wbXml = wbXml.replace(/<sheet\s[^>]*\/>/g, m => /r:id="rId4"/.test(m) ? m : '');
            wbXml = wbXml.replace(/name="GLY \+ ALLY [^"]*"/, `name="GLY + ALLY ${year}"`);
            wbXml = wbXml.replace(/\bactiveTab="\d+"/g, 'activeTab="0"');
            zip.file('xl/workbook.xml', wbXml);
            // Remove other worksheet XML files and their rels
            Object.keys(zip.files).forEach(f => {
                if (/^xl\/worksheets\/sheet\d+\.xml$/.test(f) && !f.endsWith(sheet4File)) zip.remove(f);
                if (/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(f) && !f.endsWith(sheet4File + '.rels')) zip.remove(f);
            });
            // Strip other sheets from Content_Types.xml
            let ctXml = await zip.files['[Content_Types].xml'].async('string');
            ctXml = ctXml.replace(/<Override\b[^>]*PartName="\/xl\/worksheets\/sheet\d+\.xml"[^>]*\/>/g, m =>
                m.includes(sheet4File) ? m : '');
            zip.file('[Content_Types].xml', ctXml);

            // Append Custom Chemicals sheet if this year has any
            const extraChemicals = (window.state.spraying[year] || {}).extraChemicals || [];
            if (extraChemicals.length > 0) {
                const chemXml = buildExtraChemSheetXml(year, activeFull, extraChemicals);
                zip.file('xl/worksheets/sheetChem.xml', chemXml);
                const updRels = relsXml.replace('</Relationships>',
                    '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheetChem.xml"/></Relationships>');
                zip.file('xl/_rels/workbook.xml.rels', updRels);
                const updWb = wbXml.replace('</sheets>',
                    '<sheet name="Custom Chemicals" sheetId="99" r:id="rId99"/></sheets>');
                zip.file('xl/workbook.xml', updWb);
                const updCt = ctXml.replace('</Types>',
                    '<Override PartName="/xl/worksheets/sheetChem.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
                zip.file('[Content_Types].xml', updCt);
            }

            const finalBuf = await zip.generateAsync({ type: 'arraybuffer' });
            console.log('[Spraying v14] final buffer size:', finalBuf.byteLength);
            downloadBuffer(finalBuf, `Spraying_GLY_ALLY_${year}.xlsx`);
            setStatus('rep-spray-status', '✅ Downloaded!', true);
        } catch (e) {
            console.error('Spraying report error:', e);
            setStatus('rep-spray-status', `❌ ${e.message}`);
        }
    };

    // ══════════════════════════════════════════════════════════════════════
    // REPORTS PANEL UI
    // ══════════════════════════════════════════════════════════════════════

    window.renderReportsPanel = () => {
        const wrapper = document.getElementById('excel-reports-wrapper');
        if (!wrapper) return;

        const perfYears    = Object.keys(window.state.performance || {}).sort((a, b) => parseInt(b) - parseInt(a));
        const rainYears    = Object.keys(window.state.rainfall    || {}).filter(k => /^\d{4}$/.test(k)).sort((a, b) => parseInt(b) - parseInt(a));
        const sprayYears   = Object.keys(window.state.spraying    || {}).sort((a, b) => parseInt(b) - parseInt(a));
        const manuringYears = Object.keys(window.state.manuring  || {}).filter(k => /^\d{4}$/.test(k)).sort((a, b) => parseInt(b) - parseInt(a));
        if (!manuringYears.includes('2025')) manuringYears.unshift('2025');
        const ironHorseYears = Object.keys((window.state.ironHorse || {}).assets || {}).filter(k => /^\d{4}$/.test(k)).sort((a, b) => parseInt(b) - parseInt(a));
        const wagesYears = [...new Set([
            ...Object.keys(window.state.wages || {}).filter(k => /^\d{4}$/.test(k)),
            ...perfYears
        ])].sort((a, b) => parseInt(b) - parseInt(a));

        const yearOpts  = years => years.map(y => `<option value="${y}">${y}</option>`).join('');
        const monthOpts = () => MONTHS.map(m => `<option value="${m}">${m}</option>`).join('');
        const SS = 'padding:0.4rem 0.6rem;border:1px solid var(--border);border-radius:4px;background:var(--bg-input,#fff);font-size:0.88rem;';
        const CARD = 'border:1px solid var(--border);border-radius:8px;padding:1.25rem;margin-bottom:1rem;background:var(--bg-card,#fff);box-shadow:0 1px 3px rgba(0,0,0,0.05);';
        const noDataMsg = '<span style="font-size:0.82rem;color:#e67e22;">⚠ No data available. Please add data first.</span>';

        const ytdControls = perfYears.length
            ? `<select id="sel-ytd-yr" style="${SS}">${yearOpts(perfYears)}</select>
               <select id="sel-ytd-mo" style="${SS}">${monthOpts()}</select>
               <button id="btn-dl-ytd" class="btn-primary" style="padding:0.4rem 1rem;">⬇ Download Excel</button>
               <span id="rep-ytd-status" style="font-size:0.82rem;color:var(--text-secondary);"></span>`
            : noDataMsg;

        const rainControls = rainYears.length
            ? `<select id="sel-rain-yr" style="${SS}">${yearOpts(rainYears)}</select>
               <select id="sel-rain-mo" style="${SS}">${monthOpts()}</select>
               <button id="btn-dl-rain" class="btn-primary" style="padding:0.4rem 1rem;">⬇ Download Excel</button>
               <span id="rep-rain-status" style="font-size:0.82rem;color:var(--text-secondary);"></span>`
            : noDataMsg;

        const sprayControls = sprayYears.length
            ? `<select id="sel-spray-yr" style="${SS}">${yearOpts(sprayYears)}</select>
               <select id="sel-spray-mo" style="${SS}">${monthOpts()}</select>
               <button id="btn-dl-spray" class="btn-primary" style="padding:0.4rem 1rem;">⬇ Download Excel</button>
               <span id="rep-spray-status" style="font-size:0.82rem;color:var(--text-secondary);"></span>`
            : noDataMsg;

        const manuringControls = `<select id="sel-manuring-yr" style="${SS}">${yearOpts(manuringYears)}</select>
               <select id="sel-manuring-mo" style="${SS}">${monthOpts()}</select>
               <button id="btn-dl-manuring" class="btn-primary" style="padding:0.4rem 1rem;">⬇ Download Excel</button>
               <span id="rep-manuring-status" style="font-size:0.82rem;color:var(--text-secondary);"></span>`;

        const ironHorseControls = ironHorseYears.length
            ? `<select id="sel-ih-cpmt-yr" style="${SS}">${yearOpts(ironHorseYears)}</select>
               <button id="btn-dl-ih-cpmt" class="btn-primary" style="padding:0.4rem 1rem;">⬇ Download Excel</button>
               <span id="rep-ih-cpmt-status" style="font-size:0.82rem;color:var(--text-secondary);"></span>`
            : noDataMsg;

        const wagesControls = wagesYears.length
            ? `<select id="sel-wages-yr" style="${SS}">${yearOpts(wagesYears)}</select>
               <select id="sel-wages-mo" style="${SS}">${monthOpts()}</select>
               <button id="btn-dl-wages" class="btn-primary" style="padding:0.4rem 1rem;">⬇ Download Excel</button>
               <span id="rep-wages-status" style="font-size:0.82rem;color:var(--text-secondary);"></span>`
            : noDataMsg;

        wrapper.innerHTML = `
        <div style="padding:1.5rem;max-width:680px;">
          <h2 style="margin:0 0 0.25rem;color:var(--text-main);">📊 Reports</h2>
          <p style="color:var(--text-secondary);margin:0 0 1.75rem;font-size:0.85rem;">
            Download formatted Excel reports matching the official templates.
          </p>

          <div style="${CARD}">
            <h3 style="margin:0 0 0.35rem;font-size:0.97rem;">📈 Harvesting Performance — Overall by Gang YTD</h3>
            <p style="margin:0 0 1rem;color:var(--text-secondary);font-size:0.82rem;">
              Yield-to-date comparison of current year vs previous year, by block and O/P phase.
              Select the year and up-to month.
            </p>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
              ${ytdControls}
            </div>
          </div>

          <div style="${CARD}">
            <h3 style="margin:0 0 0.35rem;font-size:0.97rem;">🌧 Rainfall — Current Year vs Previous Year</h3>
            <p style="margin:0 0 1rem;color:var(--text-secondary);font-size:0.82rem;">
              Previous year shows all 12 months. Current year shows up to the selected month;
              remaining months are black-filled.
            </p>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
              ${rainControls}
            </div>
          </div>

          <div style="${CARD}">
            <h3 style="margin:0 0 0.35rem;font-size:0.97rem;">🌿 Spraying — GLY + ALLY Annual Report</h3>
            <p style="margin:0 0 1rem;color:var(--text-secondary);font-size:0.82rem;">
              Full-year Glyphosate and Ally spraying schedule per block and O/P phase
              (split JAN–JUN and JUL–DEC).
            </p>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
              ${sprayControls}
            </div>
          </div>

          <div style="${CARD}">
            <h3 style="margin:0 0 0.35rem;font-size:0.97rem;">🌿 Manuring — Annual Fertilizer Application Report</h3>
            <p style="margin:0 0 1rem;color:var(--text-secondary);font-size:0.82rem;">
              Full-year fertilizer application per block and O/P phase across all 5 phases.
              Color-coded by fertilizer type (MOP, SATO, COM, SPEC).
            </p>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
              ${manuringControls}
            </div>
          </div>

          <div style="${CARD}">
            <h3 style="margin:0 0 0.35rem;font-size:0.97rem;">🐎 Iron Horse — Expenses by Cost per FFB MT</h3>
            <p style="margin:0 0 1rem;color:var(--text-secondary);font-size:0.82rem;">
              Full-year cost per FFB MT (RM/MT) per gang and asset, with FFB MT and total
              expenses sub-rows. Combines Iron Horse expenses with harvesting performance.
            </p>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
              ${ironHorseControls}
            </div>
          </div>

          <div style="${CARD}">
            <h3 style="margin:0 0 0.35rem;font-size:0.97rem;">💵 Rate of Wages — Monthly Gang Payment</h3>
            <p style="margin:0 0 1rem;color:var(--text-secondary);font-size:0.82rem;">
              Per-gang payment for the selected month: FFB tonnage × rate, less daily-rate
              blocks and unripe-bunch penalty, with a grand total.
            </p>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
              ${wagesControls}
            </div>
          </div>

          <p style="color:var(--text-secondary);font-size:0.78rem;margin-top:0.5rem;">
            ℹ️ Reports use the official Excel templates from "Report samples/" as the base.
            The app must be served via HTTP (not file://) for template loading to work.
          </p>
        </div>`;

        const btnYtd = document.getElementById('btn-dl-ytd');
        if (btnYtd) btnYtd.onclick = () => {
            const yr = document.getElementById('sel-ytd-yr').value;
            const mo = document.getElementById('sel-ytd-mo').value;
            if (yr && mo) window.downloadYtdReport(yr, mo);
        };
        const btnRain = document.getElementById('btn-dl-rain');
        if (btnRain) btnRain.onclick = () => {
            const yr = document.getElementById('sel-rain-yr').value;
            const mo = document.getElementById('sel-rain-mo').value;
            if (yr && mo) window.downloadRainfallReport(yr, mo);
        };
        const btnSpray = document.getElementById('btn-dl-spray');
        if (btnSpray) btnSpray.onclick = () => {
            const yr = document.getElementById('sel-spray-yr').value;
            const mo = document.getElementById('sel-spray-mo').value;
            if (yr && mo) window.downloadSprayingReport(yr, mo);
        };

        const btnManuring = document.getElementById('btn-dl-manuring');
        if (btnManuring) btnManuring.onclick = async () => {
            const yr = document.getElementById('sel-manuring-yr').value;
            const mo = document.getElementById('sel-manuring-mo').value;
            if (!yr || !mo) return;
            const statusEl = document.getElementById('rep-manuring-status');
            if (statusEl) statusEl.textContent = '';
            btnManuring.disabled = true;
            btnManuring.textContent = '⏳ Generating...';
            try {
                await window._downloadManuringExcel(yr, mo);
                if (statusEl) { statusEl.textContent = '✅ Downloaded!'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
            } catch (e) {
                if (statusEl) statusEl.textContent = '❌ ' + e.message;
            } finally {
                btnManuring.disabled = false;
                btnManuring.textContent = '⬇ Download Excel';
            }
        };

        const btnIhCpmt = document.getElementById('btn-dl-ih-cpmt');
        if (btnIhCpmt) btnIhCpmt.onclick = async () => {
            const yr = document.getElementById('sel-ih-cpmt-yr').value;
            if (!yr) return;
            const statusEl = document.getElementById('rep-ih-cpmt-status');
            if (statusEl) statusEl.textContent = '';
            btnIhCpmt.disabled = true;
            btnIhCpmt.textContent = '⏳ Generating...';
            try {
                await window.downloadIronHorseCostPerFFBMt(yr);
                if (statusEl) { statusEl.textContent = '✅ Downloaded!'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
            } catch (e) {
                if (statusEl) statusEl.textContent = '❌ ' + e.message;
            } finally {
                btnIhCpmt.disabled = false;
                btnIhCpmt.textContent = '⬇ Download Excel';
            }
        };

        const btnWages = document.getElementById('btn-dl-wages');
        if (btnWages) btnWages.onclick = async () => {
            const yr = document.getElementById('sel-wages-yr').value;
            const mo = document.getElementById('sel-wages-mo').value;
            if (!yr || !mo) return;
            const statusEl = document.getElementById('rep-wages-status');
            if (statusEl) statusEl.textContent = '';
            btnWages.disabled = true;
            btnWages.textContent = '⏳ Generating...';
            try {
                await window.downloadWagesReport(yr, mo);
                if (statusEl) { statusEl.textContent = '✅ Downloaded!'; setTimeout(() => { statusEl.textContent = ''; }, 3000); }
            } catch (e) {
                if (statusEl) statusEl.textContent = '❌ ' + e.message;
            } finally {
                btnWages.disabled = false;
                btnWages.textContent = '⬇ Download Excel';
            }
        };
    };

})();
