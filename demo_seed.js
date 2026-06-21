// =====================================================================
// demo_seed.js — DEMO MODE fake dataset builder (NOT the real app)
//
// Defines window.__demoBuildSeed(), called once by demo_firebase_mock.js on
// first load to populate the in-browser (localStorage) database. Every figure
// here is INVENTED for demonstration only — it is NOT the real plantation
// data. Real worker/gang names are replaced with neutral call-sign names.
//
// Strategy: reuse the app's OWN default-data generators (getDefaultSprayingData,
// _manuringDefault2025, INITIAL_FFB_BUDGET, INITIAL_RAINFALL_2025, the Iron
// Horse constants) as structural templates so the shapes are guaranteed
// correct, then scramble the numbers and swap in demo gang names. Modules with
// no baked default (Planting, Harvesting Performance, Iron Horse expenses,
// Wages, Maintenance) are generated from scratch in the correct shape.
//
// Returns a map of  { '<db path>': <value> }  where shared/* blobs are JSON
// strings (the app JSON.parses them) and user_roles is a plain object.
// =====================================================================
(function () {
    'use strict';

    // ---- deterministic PRNG (so the demo looks identical every fresh load)
    function mulberry32(seed) {
        return function () {
            seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
            var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    var rnd = mulberry32(20260621);
    function rRange(a, b) { return a + (b - a) * rnd(); }
    function rInt(a, b) { return Math.floor(rRange(a, b + 1)); }
    function r2(n) { return Math.round(n * 100) / 100; }
    function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }

    var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    var MONTHS_2026 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN']; // current month is Jun 2026
    var YEARS = ['2025', '2026'];

    // ---- demo gang names (replace real worker/gang names) ----------------
    var GANGS = ['Gang Alpha', 'Gang Bravo', 'Gang Charlie', 'Gang Delta', 'Gang Echo', 'Gang Foxtrot'];
    // block -> demo gang
    var BLOCK_GANG = {
        '1': 'Gang Alpha', '3': 'Gang Alpha', '14': 'Gang Alpha',
        '15': 'Gang Bravo', '16': 'Gang Bravo', '17': 'Gang Bravo', '19': 'Gang Bravo',
        '20': 'Gang Bravo', '21': 'Gang Bravo', '22': 'Gang Bravo', '32': 'Gang Bravo',
        '2': 'Gang Charlie', '11': 'Gang Charlie', '29': 'Gang Charlie',
        '4': 'Gang Delta', '5': 'Gang Delta', '6': 'Gang Delta', '7': 'Gang Delta',
        '23': 'Gang Delta', '24': 'Gang Delta',
        '8': 'Gang Echo', '9': 'Gang Echo', '12': 'Gang Echo', '10': 'Gang Echo',
        '13': 'Gang Echo', '18': 'Gang Echo',
        '25': 'Gang Foxtrot', '26A': 'Gang Foxtrot', '26B': 'Gang Foxtrot', '27': 'Gang Foxtrot',
        '28': 'Gang Foxtrot', '30': 'Gang Foxtrot', '31': 'Gang Foxtrot', '33': 'Gang Foxtrot', '39': 'Gang Foxtrot'
    };
    function gangFor(block) { return BLOCK_GANG[String(block)] || 'Gang Alpha'; }

    // ---- block info (block -> ha, op_year, phase) from the spraying default
    function buildBlockInfo() {
        var info = {}, order = [];
        try {
            if (typeof getDefaultSprayingData === 'function') {
                var sd = getDefaultSprayingData();
                (sd.phases || []).forEach(function (ph) {
                    (ph.blocks || []).forEach(function (b) {
                        var id = String(b.blockNo);
                        info[id] = { ha: b.haPresent || b.haPrevious || 0, op_year: String(b.plantYear), phase: ph.phaseName };
                        order.push(id);
                    });
                });
            }
        } catch (e) { console.warn('[DEMO] blockInfo from spraying default failed', e); }
        if (!order.length) { // fallback minimal set
            ['1', '2', '3', '4', '5'].forEach(function (id) { info[id] = { ha: 50, op_year: '2010', phase: 'OP2010' }; order.push(id); });
        }
        return { info: info, order: order };
    }
    // Computed lazily inside __demoBuildSeed() — the app's default generators
    // (getDefaultSprayingData etc.) are only defined once their <body> scripts
    // have loaded, which is AFTER this file is parsed in <head>.
    var BLOCKS = null;

    // =====================================================================
    // 1) Planting Phase Record (reports) + gang list
    // =====================================================================
    function buildReports() {
        var reports = {}, gangsByYear = {};
        YEARS.forEach(function (yr) {
            reports[yr] = BLOCKS.order.map(function (id) {
                var bi = BLOCKS.info[id];
                return { block_id: id, ha: r2(bi.ha * rRange(0.97, 1.03)), op_year: bi.op_year, gang: gangFor(id) };
            });
            gangsByYear[yr] = GANGS.slice();
        });
        return { reports: reports, gangsByYear: gangsByYear };
    }

    // =====================================================================
    // 2) FFB Budget — scramble the baked INITIAL_FFB_BUDGET per year
    // =====================================================================
    function buildFfbBudget() {
        var out = {};
        var base = (typeof INITIAL_FFB_BUDGET !== 'undefined') ? INITIAL_FFB_BUDGET : [];
        YEARS.forEach(function (yr, yi) {
            var yearFactor = yr === '2026' ? rRange(1.02, 1.12) : rRange(0.85, 0.98);
            out[yr] = base.map(function (b) {
                var months = (b.months || []).map(function (m) { return r2((m || 0) * yearFactor * rRange(0.9, 1.1)); });
                var ha = b.ha || 1;
                var annual = months.reduce(function (s, m) { return s + m; }, 0);
                return {
                    phase: b.phase, block_id: b.block_id, ageMth: b.ageMth, harvestYr: b.harvestYr,
                    ageYrMth: b.ageYrMth, harvestYrMth: b.harvestYrMth,
                    mtHaYr: r2(annual / ha), mtHaMth: r2(annual / ha / 12), ha: ha, months: months
                };
            });
        });
        return out;
    }

    // =====================================================================
    // 3) Rainfall — scramble the baked INITIAL_RAINFALL per year
    // =====================================================================
    function buildRainfall() {
        var out = {};
        var base = (typeof INITIAL_RAINFALL_2025 !== 'undefined') ? INITIAL_RAINFALL_2025 : null;
        function emptyYear() { var o = {}; MONTHS.forEach(function (m) { o[m] = { days: 0, mm: 0 }; }); return o; }
        YEARS.forEach(function (yr) {
            var y = emptyYear();
            var months = yr === '2026' ? MONTHS_2026 : MONTHS;
            months.forEach(function (m) {
                var b = base && base[m] ? base[m] : { days: 15, mm: 250 };
                y[m] = { days: Math.min(28, Math.max(0, Math.round((b.days || 0) * rRange(0.8, 1.15)))), mm: r2((b.mm || 0) * rRange(0.75, 1.25)) };
            });
            out[yr] = y;
        });
        return out;
    }

    // =====================================================================
    // 4) Harvesting Performance — generated in the canonical import shape
    //    performance[year][month] = { gangAssignments:{block:gang},
    //      [gang]: { manpower, leave, blocks:{ [block]: {ha,budget,manday,r1..r4,days[31]} } } }
    // =====================================================================
    function buildDays(intensity) {
        var days = [];
        var window = rInt(6, 12);             // harvesting happens over a contiguous window
        var start = rInt(0, 31 - window - 1);
        for (var d = 0; d < 31; d++) {
            if (d >= start && d < start + window) {
                days.push({ roundVal: String(rInt(1, 3)), hpVal: String(rInt(2, Math.max(3, intensity))) });
            } else {
                days.push({ roundVal: '', hpVal: '' });
            }
        }
        return days;
    }
    function buildPerformance() {
        var perf = {};
        YEARS.forEach(function (yr) {
            perf[yr] = {};
            var months = yr === '2026' ? MONTHS_2026 : MONTHS;
            months.forEach(function (mon, mi) {
                var partial = (yr === '2026' && mon === 'JUN'); // current month, not finished
                var month = { gangAssignments: {} };
                GANGS.forEach(function (gang) { month[gang] = { manpower: 0, leave: rInt(0, 2), blocks: {} }; });
                BLOCKS.order.forEach(function (id) {
                    var bi = BLOCKS.info[id];
                    if (!bi.ha) return;                 // skip 0-ha blocks (26B / 32 baseline)
                    var gang = gangFor(id);
                    var seasonal = 0.7 + 0.6 * Math.abs(Math.sin((mi + 2) / 2)); // crude seasonality
                    var monthTotal = bi.ha * rRange(0.9, 1.7) * seasonal * (partial ? 0.45 : 1);
                    var r1 = r2(monthTotal * rRange(0.42, 0.5));
                    var r2v = r2(monthTotal * rRange(0.28, 0.34));
                    var r3 = r2(Math.max(0, monthTotal - r1 - r2v));
                    var intensity = Math.max(3, Math.round(bi.ha / 9));
                    var days = buildDays(intensity);
                    var manday = days.reduce(function (s, d) { return s + (parseFloat(d.hpVal) || 0); }, 0);
                    month[gang].blocks[id] = {
                        ha: r2(bi.ha), budget: r2(bi.ha * rRange(1.2, 1.7)),
                        manday: manday, r1: r1, r2: r2v, r3: r3, r4: 0, days: days
                    };
                    month.gangAssignments[id] = gang;
                });
                // peak manpower per gang = busiest single day across its blocks
                GANGS.forEach(function (gang) {
                    var blocks = month[gang].blocks;
                    var peak = 0;
                    for (var d = 0; d < 31; d++) {
                        var sum = 0;
                        Object.keys(blocks).forEach(function (id) { sum += parseFloat(blocks[id].days[d].hpVal) || 0; });
                        if (sum > peak) peak = sum;
                    }
                    month[gang].manpower = peak || rInt(8, 16);
                });
                // performance is keyed by Title-case month ("Jan".."Dec") — the
                // case the main app uses (script.js `months`). Other modules
                // (spraying/rainfall/iron horse/maintenance) use UPPERCASE.
                perf[yr][mon.charAt(0) + mon.slice(1).toLowerCase()] = month;
            });
        });
        return perf;
    }

    // =====================================================================
    // 5) Spraying — scramble getDefaultSprayingData() per year
    // =====================================================================
    function buildSpraying() {
        var out = {};
        YEARS.forEach(function (yr) {
            var data;
            try { data = (typeof getDefaultSprayingData === 'function') ? getDefaultSprayingData() : { phases: [] }; }
            catch (e) { data = { phases: [] }; }
            var months = yr === '2026' ? MONTHS_2026 : MONTHS;
            (data.phases || []).forEach(function (ph) {
                (ph.blocks || []).forEach(function (b) {
                    Object.keys(b.months || {}).forEach(function (m) {
                        var cell = b.months[m];
                        var filled = cell && (cell.litresGly !== '' || cell.gmAly !== '');
                        if (!filled) return;
                        if (months.indexOf(m) === -1) {           // future month in 2026 -> clear
                            b.months[m] = { roundGly: '', roundAly: '', litresGly: '', gmAly: '', haGly: '', haAly: '' };
                            return;
                        }
                        if (cell.litresGly !== '' && cell.litresGly != null) cell.litresGly = r2((+cell.litresGly) * rRange(0.8, 1.25));
                        if (cell.gmAly !== '' && cell.gmAly != null) cell.gmAly = Math.round((+cell.gmAly) * rRange(0.8, 1.25));
                    });
                });
            });
            out[yr] = data;
        });
        return out;
    }

    // =====================================================================
    // 6) Manuring — scramble _manuringDefault2025 per year
    // =====================================================================
    function buildManuring() {
        var out = {};
        var base = window._manuringDefault2025;
        if (!base) return {};
        YEARS.forEach(function (yr) {
            var data = JSON.parse(JSON.stringify(base));
            var allowedMonths = yr === '2026'
                ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jan2', 'Feb2', 'Mar2', 'Apr2', 'May2', 'Jun2']
                : null; // 2025 keeps all
            Object.keys(data).forEach(function (phase) {
                (data[phase].blocks || []).forEach(function (blk) {
                    if (blk.npalm) blk.npalm = Math.round(blk.npalm * rRange(0.95, 1.05));
                    var apps = blk.apps || {};
                    Object.keys(apps).forEach(function (mk) {
                        var baseMonth = mk.replace(/2$/, '');
                        if (allowedMonths && allowedMonths.indexOf(mk) === -1 && allowedMonths.indexOf(baseMonth) === -1) {
                            delete apps[mk]; return;
                        }
                        var a = apps[mk];
                        if (a.bags != null) a.bags = Math.round(a.bags * rRange(0.85, 1.2));
                        if (a.mt != null) a.mt = r2((a.bags || 0) * 0.05);
                    });
                });
            });
            out[yr] = data;
        });
        return out;
    }

    // =====================================================================
    // 7) Iron Horse — assets + monthly expenses (generated fresh)
    // =====================================================================
    function buildIronHorse() {
        var ASSETS = (typeof IH_DEFAULT_ASSET_NOS !== 'undefined')
            ? IH_DEFAULT_ASSET_NOS.slice()
            : ['GT06', 'GT07', 'GT08', 'GT09', 'GT10', 'GT12', 'GT13', 'GT16', 'GT17', 'GT20', 'GT22'];
        var CATS = (typeof IH_CATS !== 'undefined') ? IH_CATS.slice() : ['DC', 'FUEL', 'LUBE', 'PART', 'SR1', 'TOOL'];
        var assets = {}, expenses = {};
        YEARS.forEach(function (yr) {
            assets[yr] = ASSETS.map(function (no, i) {
                var gang = GANGS[i % GANGS.length];
                return {
                    assetNo: no, description: 'IRON HORSE',
                    gangAssignments: [{ gang: gang, from: yr + '-01-01', to: yr + '-12-31', remark: '' }]
                };
            });
            var months = yr === '2026' ? MONTHS_2026 : MONTHS;
            var mObj = {};
            months.forEach(function (mon) {
                var perAsset = {};
                ASSETS.forEach(function (no) {
                    var e = {};
                    CATS.forEach(function (c) {
                        if (c === 'FUEL') e[c] = r2(rRange(180, 520));
                        else if (c === 'DC') e[c] = r2(rRange(60, 160));
                        else if (c === 'PART') e[c] = (rnd() < 0.5) ? r2(rRange(0, 380)) : 0;
                        else if (c === 'LUBE') e[c] = r2(rRange(20, 90));
                        else if (c === 'SR1') e[c] = (rnd() < 0.3) ? r2(rRange(0, 250)) : 0;
                        else e[c] = r2(rRange(0, 60));
                    });
                    perAsset[no] = e;
                });
                mObj[mon] = perAsset;
            });
            expenses[yr] = { extraCategories: [], months: mObj };
        });
        return { assets: assets, expenses: expenses };
    }

    // =====================================================================
    // 8) Wages (Rate of Wages calculator) — a few gangs with daily lines
    // =====================================================================
    function buildWages() {
        var out = {};
        YEARS.forEach(function (yr) {
            var months = yr === '2026' ? MONTHS_2026 : ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG'];
            var gangs = {};
            GANGS.slice(0, 4).forEach(function (gang) {
                var mObj = {};
                months.forEach(function (mon) {
                    var blocksForGang = BLOCKS.order.filter(function (id) { return gangFor(id) === gang && BLOCKS.info[id].ha; });
                    var blk = blocksForGang.length ? pick(blocksForGang) : '1';
                    var dayCount = rInt(3, 6);
                    var days = [];
                    for (var d = 0; d < dayCount; d++) {
                        days.push({ date: yr + '-' + String(MONTHS.indexOf(mon) + 1).padStart(2, '0') + '-' + String(rInt(2, 26)).padStart(2, '0'), manpower: String(rInt(4, 9)) });
                    }
                    mObj[mon] = {
                        ffbRate: String(r2(rRange(45, 62))),
                        penaltyBunches: String(rInt(0, 12)),
                        grossMtOverride: '',
                        dailyLines: [{
                            workType: 'Harvesting', block: blk,
                            dailyRate: String(rInt(38, 52)), tonnageOverride: '',
                            days: days
                        }]
                    };
                });
                gangs[gang] = { months: mObj };
            });
            out[yr] = { penaltyPerBunch: 0.30, gangs: gangs };
        });
        return out;
    }

    // =====================================================================
    // 9) Maintenance — gangs + work-log entries (own gang list)
    // =====================================================================
    function buildMaintenance() {
        var out = {};
        var MGANGS = ['Maintenance Team A', 'Maintenance Team B'];
        var ACTS = ['Spraying', 'Slashing', 'Manuring', 'Pruning'];
        var METHODS = ['Manual', 'Knapsack', 'Mechanical'];
        YEARS.forEach(function (yr) {
            var months = yr === '2026' ? MONTHS_2026 : MONTHS;
            var gangs = {};
            MGANGS.forEach(function (g) {
                var mObj = {};
                months.forEach(function (mon) { mObj[mon] = { headcount: rInt(4, 8), members: [] }; });
                gangs[g] = { months: mObj };
            });
            var entries = [];
            var blocks = BLOCKS.order.filter(function (id) { return BLOCKS.info[id].ha; });
            var n = yr === '2026' ? 14 : 24;
            for (var i = 0; i < n; i++) {
                var mon = pick(months);
                var mi = MONTHS.indexOf(mon) + 1;
                var startDay = rInt(1, 22);
                var span = rInt(1, 5);
                var pad = function (x) { return String(x).padStart(2, '0'); };
                entries.push({
                    id: 'demo-mnt-' + yr + '-' + i,
                    gang: pick(MGANGS), activity: pick(ACTS), block: pick(blocks),
                    dateStart: yr + '-' + pad(mi) + '-' + pad(startDay),
                    dateEnd: yr + '-' + pad(mi) + '-' + pad(Math.min(28, startDay + span)),
                    persons: rInt(3, 7), round: String(rInt(1, 3)), method: pick(METHODS),
                    verified: rnd() < 0.6, verifiedBy: null, createdBy: 'demo@antigravity.example'
                });
            }
            out[yr] = { activityTypes: ACTS.slice(), gangs: gangs, entries: entries };
        });
        return out;
    }

    // =====================================================================
    // Assemble + return the path -> value seed map
    // =====================================================================
    window.__demoBuildSeed = function () {
        BLOCKS = buildBlockInfo();   // now safe: all module defaults are loaded
        var rep = buildReports();
        var appState = {
            reports: rep.reports,
            gangsByYear: rep.gangsByYear,
            performance: buildPerformance(),
            ffbBudget: buildFfbBudget(),
            rainfall: buildRainfall(),
            selectedReportYear: '2026',
            activeViewType: 'report_year'
        };

        var roleDemo = {
            role: 'admin', allowedMenus: 'all', editableMenus: 'all',
            firstLogin: false, email: 'demo@antigravity.example', createdAt: Date.now()
        };

        return {
            'shared/app_state': JSON.stringify(appState),
            'shared/spraying_data': JSON.stringify(buildSpraying()),
            'shared/manuring_data': JSON.stringify(buildManuring()),
            'shared/ironhorse_data': JSON.stringify(buildIronHorse()),
            'shared/wages_data': JSON.stringify(buildWages()),
            'shared/maintenance_data': JSON.stringify(buildMaintenance()),
            'user_roles': { 'demo-user': roleDemo }
        };
    };
})();
