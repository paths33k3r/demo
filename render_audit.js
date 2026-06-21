/* render_audit.js — Audit Log panel */

// HTML-escape for untrusted audit fields (entries are writable by any signed-in
// user, so user/target/details/before/after must never be injected as raw HTML).
const esc = (s) => window.escapeHtml(s);

window.renderAuditLog = function () {
    const wrapper = document.getElementById('audit-log-wrapper');
    if (!wrapper) return;

    wrapper.innerHTML = `
        <div style="padding: 1.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
                <div>
                    <h2 style="margin:0; font-size:1.3rem; font-weight:700;">Audit Log</h2>
                    <p style="margin:0.25rem 0 0; font-size:0.85rem; color:var(--text-secondary);">
                        A record of all changes made in the system. Entries are kept for 12 months.
                    </p>
                </div>
                <button id="audit-refresh-btn" class="btn-primary" style="font-size:0.85rem; padding:0.4rem 0.9rem;">
                    🔄 Refresh
                </button>
            </div>

            <!-- Filters -->
            <div style="display:flex; gap:0.75rem; flex-wrap:wrap; margin-bottom:1.25rem;">
                <select id="audit-filter-action" style="padding:0.4rem 0.6rem; border:1px solid var(--border-color); border-radius:6px; font-size:0.85rem; background:var(--bg-card);">
                    <option value="">All Actions</option>
                    <option value="save">Save</option>
                    <option value="delete">Delete</option>
                    <option value="import">Import</option>
                    <option value="download">Download</option>
                    <option value="add">Add</option>
                    <option value="edit">Edit</option>
                </select>
                <select id="audit-filter-section" style="padding:0.4rem 0.6rem; border:1px solid var(--border-color); border-radius:6px; font-size:0.85rem; background:var(--bg-card);">
                    <option value="">All Sections</option>
                    <option value="harvesting">Harvesting</option>
                    <option value="performance">Performance</option>
                    <option value="ironhorse">Iron Horse</option>
                    <option value="spraying">Spraying</option>
                    <option value="manuring">Manuring</option>
                    <option value="rainfall">Rainfall</option>
                    <option value="ffb_budget">FFB Budget</option>
                    <option value="reports">Reports</option>
                    <option value="user_mgmt">User Mgmt</option>
                    <option value="gangs">Gangs</option>
                    <option value="backup">Backup</option>
                </select>
                <input id="audit-filter-user" type="text" placeholder="Filter by user email..."
                    style="padding:0.4rem 0.6rem; border:1px solid var(--border-color); border-radius:6px; font-size:0.85rem; background:var(--bg-card); min-width:200px;" />
                <button id="audit-clear-filter" style="padding:0.4rem 0.7rem; border:1px solid var(--border-color); border-radius:6px; font-size:0.85rem; background:var(--bg-secondary); cursor:pointer;">
                    ✕ Clear
                </button>
            </div>

            <!-- Log Table -->
            <div id="audit-table-container" style="overflow-x:auto;">
                <div id="audit-loading" style="text-align:center; padding:3rem; color:var(--text-secondary);">
                    Loading audit log...
                </div>
            </div>
        </div>
    `;

    loadAuditEntries();

    document.getElementById('audit-refresh-btn').onclick = loadAuditEntries;
    document.getElementById('audit-clear-filter').onclick = () => {
        document.getElementById('audit-filter-action').value = '';
        document.getElementById('audit-filter-section').value = '';
        document.getElementById('audit-filter-user').value = '';
        renderAuditTable(window._auditAllEntries || []);
    };
    document.getElementById('audit-filter-action').onchange = applyAuditFilters;
    document.getElementById('audit-filter-section').onchange = applyAuditFilters;
    document.getElementById('audit-filter-user').oninput = applyAuditFilters;
};

function loadAuditEntries() {
    const container = document.getElementById('audit-table-container');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center; padding:3rem; color:var(--text-secondary);">Loading audit log...</div>';

    const db = window._auditDb || window._ironHorseDb;
    if (!db) {
        container.innerHTML = '<div style="padding:2rem; color:var(--danger);">Database not available.</div>';
        return;
    }

    db.ref('shared/audit_log').orderByChild('ts').limitToLast(500).once('value')
        .then(snap => {
            const entries = [];
            snap.forEach(child => {
                entries.push({ key: child.key, ...child.val() });
            });
            entries.reverse(); // newest first
            window._auditAllEntries = entries;
            renderAuditTable(entries);
        })
        .catch(err => {
            console.error('Audit log load error:', err);
            if (container) container.innerHTML = '<div style="padding:2rem; color:var(--danger);">Failed to load audit log.</div>';
        });
}

function applyAuditFilters() {
    const action = document.getElementById('audit-filter-action')?.value || '';
    const section = document.getElementById('audit-filter-section')?.value || '';
    const user = (document.getElementById('audit-filter-user')?.value || '').toLowerCase();
    const all = window._auditAllEntries || [];
    const filtered = all.filter(e => {
        if (action && e.action !== action) return false;
        if (section && e.section !== section) return false;
        if (user && !(e.user || '').toLowerCase().includes(user)) return false;
        return true;
    });
    renderAuditTable(filtered);
}

function renderAuditTable(entries) {
    const container = document.getElementById('audit-table-container');
    if (!container) return;

    if (!entries || entries.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:3rem; color:var(--text-secondary);">No audit log entries found.</div>';
        return;
    }

    const ACTION_BADGE = {
        save:     { bg: '#d1fae5', color: '#065f46', label: 'SAVE' },
        delete:   { bg: '#fee2e2', color: '#991b1b', label: 'DELETE' },
        import:   { bg: '#dbeafe', color: '#1e40af', label: 'IMPORT' },
        download: { bg: '#f3e8ff', color: '#6b21a8', label: 'DOWNLOAD' },
        add:      { bg: '#dcfce7', color: '#166534', label: 'ADD' },
        edit:     { bg: '#fef9c3', color: '#854d0e', label: 'EDIT' },
    };

    const rows = entries.map(e => {
        const badge = ACTION_BADGE[e.action] || { bg: '#f1f5f9', color: '#475569', label: (e.action || '').toUpperCase() };
        const dt = e.ts ? new Date(e.ts) : null;
        const dtStr = dt ? dt.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }) : '—';

        let beforeAfter = '';
        if (e.before !== null && e.before !== undefined && e.after !== null && e.after !== undefined) {
            beforeAfter = `
                <div style="font-size:0.75rem; margin-top:0.25rem;">
                    <span style="color:#6b7280;">Before:</span>
                    <code style="background:#f1f5f9; padding:1px 4px; border-radius:3px;">${esc(_auditTruncate(e.before, 80))}</code>
                    <span style="color:#6b7280; margin-left:0.5rem;">After:</span>
                    <code style="background:#f1f5f9; padding:1px 4px; border-radius:3px;">${esc(_auditTruncate(e.after, 80))}</code>
                </div>`;
        }

        return `
            <tr style="border-bottom:1px solid var(--border-color);">
                <td style="padding:0.65rem 0.75rem; white-space:nowrap; font-size:0.8rem; color:var(--text-secondary);">${esc(dtStr)}</td>
                <td style="padding:0.65rem 0.75rem; font-size:0.8rem;">${esc(e.user || '—')}</td>
                <td style="padding:0.65rem 0.75rem;">
                    <span style="background:${badge.bg}; color:${badge.color}; padding:2px 8px; border-radius:12px; font-size:0.72rem; font-weight:700; letter-spacing:0.05em;">
                        ${badge.label}
                    </span>
                </td>
                <td style="padding:0.65rem 0.75rem; font-size:0.8rem; color:var(--text-secondary);">${esc(_auditSectionLabel(e.section))}</td>
                <td style="padding:0.65rem 0.75rem; font-size:0.85rem;">
                    <div style="font-weight:500;">${esc(e.target || '—')}</div>
                    ${e.details ? `<div style="font-size:0.75rem; color:var(--text-secondary); margin-top:0.15rem;">${esc(e.details)}</div>` : ''}
                    ${beforeAfter}
                </td>
            </tr>`;
    }).join('');

    container.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:0.875rem;">
            <thead>
                <tr style="background:var(--bg-secondary); border-bottom:2px solid var(--border-color);">
                    <th style="padding:0.6rem 0.75rem; text-align:left; font-size:0.78rem; font-weight:600; white-space:nowrap;">DATE / TIME</th>
                    <th style="padding:0.6rem 0.75rem; text-align:left; font-size:0.78rem; font-weight:600;">USER</th>
                    <th style="padding:0.6rem 0.75rem; text-align:left; font-size:0.78rem; font-weight:600;">ACTION</th>
                    <th style="padding:0.6rem 0.75rem; text-align:left; font-size:0.78rem; font-weight:600;">SECTION</th>
                    <th style="padding:0.6rem 0.75rem; text-align:left; font-size:0.78rem; font-weight:600;">DETAILS</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:0.75rem; font-size:0.78rem; color:var(--text-secondary); text-align:right;">
            Showing ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}
        </div>
    `;
}

function _auditTruncate(str, max) {
    if (!str) return '';
    const s = String(str);
    return s.length > max ? s.slice(0, max) + '…' : s;
}

function _auditSectionLabel(section) {
    const MAP = {
        harvesting:       'Harvesting',
        performance:      'Performance',
        perf_month:       'Performance',
        interval_month:   'Harvesting',
        report_year:      'Harvesting',
        ironhorse:        'Iron Horse',
        ironhorse_assets: 'Iron Horse',
        ironhorse_expenses: 'Iron Horse',
        spraying:         'Spraying',
        manuring:         'Manuring',
        rainfall:         'Rainfall',
        rainfall_record:  'Rainfall',
        ffb_budget:       'FFB Budget',
        reports:          'Reports',
        user_mgmt:        'User Mgmt',
        gangs:            'Gangs',
        backup:           'Backup',
    };
    return MAP[section] || (section || '—');
}
