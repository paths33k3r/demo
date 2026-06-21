// =====================================================================
// app_user_mgmt.js — user management & roles (Phase 9 split, extracted
// from script.js). Runs inside the app closure via
// window._initUserMgmt({ auth, db }), called by runMainApplication;
// returns the three functions the rest of the app needs. Also defines
// window._canEdit / window._applyReadOnly as before.
// =====================================================================
window._initUserMgmt = function ({ auth, db }) {
        // USER MANAGEMENT & ROLES
        // =====================================================================
        let currentUserRole = null; // { role, allowedMenus, firstLogin, email, ... }

        // HTML-escape for user-supplied strings rendered into innerHTML (emails,
        // backup filenames). Firebase validates email format, but escape anyway.
        const H = (s) => window.escapeHtml(s);

        const ALL_MENU_KEYS = ['ffbBudget', 'planting', 'gangs', 'performance', 'rainfall', 'maintenance', 'weekly', 'wages', 'dataManagement'];

        const loadUserRole = async (uid) => {
            try {
                const snap = await db.ref('user_roles/' + uid).once('value');
                const data = snap.val();
                if (data) {
                    currentUserRole = data;
                    return;
                }
                // No record for this user. Only the very first user of the whole
                // system gets admin (bootstrap); everyone else defaults to a
                // locked-down role until an admin grants access.
                const allSnap = await db.ref('user_roles').once('value');
                const isFirstEverUser = !allSnap.exists() || allSnap.numChildren() === 0;
                if (isFirstEverUser) {
                    currentUserRole = { role: 'admin', allowedMenus: 'all', firstLogin: false, email: auth.currentUser.email, createdAt: Date.now() };
                    await db.ref('user_roles/' + uid).set(currentUserRole);
                } else {
                    currentUserRole = { role: 'user', allowedMenus: [], editableMenus: [], firstLogin: false, email: auth.currentUser.email, createdAt: Date.now() };
                    await db.ref('user_roles/' + uid).set(currentUserRole);
                }
            } catch (e) {
                // Fail closed: if we can't determine the role, assume least privilege.
                console.error('loadUserRole error:', e);
                currentUserRole = { role: 'user', allowedMenus: [], editableMenus: [], firstLogin: false };
            }
        };

        const applyRolePermissions = () => {
            if (!currentUserRole) return;
            const isAdmin = currentUserRole.role === 'admin';

            // Show current user in header
            const userInfo = document.getElementById('header-user-info');
            const userEmail = document.getElementById('header-user-email');
            const userRole = document.getElementById('header-user-role');
            if (userInfo && userEmail && userRole) {
                const email = (auth.currentUser && auth.currentUser.email) || currentUserRole.email || '';
                const role = currentUserRole.role || 'user';
                userEmail.textContent = email;
                userRole.textContent = role === 'admin' ? '⭐ Admin' : '👤 User';
                userInfo.style.display = 'flex';
            }

            const userMgmtItem = document.getElementById('nav-user-mgmt-item');
            if (userMgmtItem) userMgmtItem.style.display = isAdmin ? '' : 'none';

            const auditLogItem = document.getElementById('nav-audit-log-item');
            if (auditLogItem) auditLogItem.style.display = isAdmin ? '' : 'none';

            if (!isAdmin && Array.isArray(currentUserRole.allowedMenus)) {
                const allowed = currentUserRole.allowedMenus;
                document.querySelectorAll('.nav-menu > .nav-item[data-menu-key]').forEach(item => {
                    const key = item.getAttribute('data-menu-key');
                    item.style.display = allowed.includes(key) ? '' : 'none';
                });
            }
        };

        // editableMenus is an array, which DB security rules can't test for
        // membership — mirror it as a {key:true} map the rules can check
        const menusToMap = (arr) => {
            const m = {};
            if (Array.isArray(arr)) arr.forEach(k => { m[k] = true; });
            return m;
        };

        // ── Edit-permission helpers ─────────────────────────────────────
        window._canEdit = (menuKey) => {
            if (!currentUserRole) return false;
            if (currentUserRole.role === 'admin') return true;
            const em = currentUserRole.editableMenus;
            if (em === 'all') return true;
            if (Array.isArray(em)) return em.includes(menuKey);
            return false;
        };

        window._applyReadOnly = (wrapper, menuKey) => {
            if (!wrapper) return;
            if (!currentUserRole || currentUserRole.role === 'admin') return;
            if (window._canEdit(menuKey)) return;

            // View-only banner (insert once)
            if (!wrapper.querySelector('.view-only-banner')) {
                const banner = document.createElement('div');
                banner.className = 'view-only-banner';
                banner.style.cssText = 'background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:0.5rem 1rem;margin-bottom:1rem;font-size:0.85rem;color:#92400e;display:flex;align-items:center;gap:0.5rem;';
                banner.innerHTML = '👁 <strong>View Only</strong> — You have read-only access to this section. Contact an admin to make changes.';
                wrapper.insertBefore(banner, wrapper.firstChild);
            }

            // Disable action buttons (allow download/template/export)
            const ALLOW = /download|template|export|⬇|📊/i;
            const BLOCK = /save|delete|add|clear|remove|import|edit|create|assign|💾|🗑|➕|📤|✕|⚗|✏/i;
            wrapper.querySelectorAll('button').forEach(btn => {
                if (btn.disabled) return;
                const text = btn.textContent.trim();
                if (ALLOW.test(text)) return;
                if (BLOCK.test(text)) {
                    btn.disabled = true;
                    btn.style.opacity = '0.4';
                    btn.style.cursor = 'not-allowed';
                    btn.title = 'View only — contact admin to make changes';
                }
            });

            // Make text/number inputs read-only
            wrapper.querySelectorAll('input[type="text"], input[type="number"], textarea').forEach(el => {
                el.readOnly = true;
                el.style.background = 'var(--bg-main, #f5f5f5)';
                el.style.cursor = 'not-allowed';
            });

            // Block inline onclick handlers (e.g. manuring cell edits)
            wrapper.querySelectorAll('[onclick]').forEach(el => {
                el.removeAttribute('onclick');
                el.style.cursor = 'default';
            });
        };

        const checkFirstLogin = () => {
            if (currentUserRole && currentUserRole.firstLogin) {
                const overlay = document.getElementById('first-login-overlay');
                if (overlay) overlay.style.display = 'flex';

                document.getElementById('btn-set-new-pw').onclick = () => {
                    const pw1 = document.getElementById('new-pw-1').value;
                    const pw2 = document.getElementById('new-pw-2').value;
                    const msgEl = document.getElementById('first-login-msg');
                    if (!pw1 || pw1.length < 6) { msgEl.textContent = 'Password must be at least 6 characters.'; return; }
                    if (pw1 !== pw2) { msgEl.textContent = 'Passwords do not match.'; return; }
                    auth.currentUser.updatePassword(pw1)
                        .then(() => {
                            db.ref('user_roles/' + auth.currentUser.uid + '/firstLogin').set(false);
                            currentUserRole.firstLogin = false;
                            overlay.style.display = 'none';
                            window.notify('Password updated successfully!', 'success');
                        })
                        .catch(e => { msgEl.textContent = e.message; });
                };
            }
        };

        // ── Google Drive helpers ────────────────────────────────────────
        // Replace YOUR_GOOGLE_OAUTH_CLIENT_ID with your OAuth 2.0 Client ID.
        // You can reuse the InventoryWeb client ID by adding this app's origin
        // (e.g. http://localhost or file://) to its Authorised JavaScript origins
        // at: https://console.cloud.google.com/apis/credentials
        const GDRIVE_CLIENT_ID = '1073324997940-8nocphvtf77673hkb3v0s5v1f1tmbeh9.apps.googleusercontent.com';
        const GDRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file';
        const GDRIVE_FOLDER_NAME = 'Harvesting Report Backups';
        let gdriveTokenClient = null;

        const gdriveRequireToken = () => new Promise((resolve, reject) => {
            const saved = localStorage.getItem('gdrive_access_token');
            const exp = localStorage.getItem('gdrive_token_expires');
            if (saved && exp && Date.now() < parseInt(exp)) return resolve(saved);
            if (!window.google?.accounts?.oauth2) return reject(new Error('Google Identity SDK not loaded.'));
            if (!gdriveTokenClient) {
                gdriveTokenClient = window.google.accounts.oauth2.initTokenClient({
                    client_id: GDRIVE_CLIENT_ID,
                    scope: GDRIVE_SCOPES,
                    callback: (res) => {
                        if (res.error) { reject(res); return; }
                        localStorage.setItem('gdrive_access_token', res.access_token);
                        localStorage.setItem('gdrive_token_expires', String(Date.now() + 3500000));
                        resolve(res.access_token);
                    }
                });
            }
            gdriveTokenClient.requestAccessToken({ prompt: '' });
        });

        const gdriveLogin = () => new Promise((resolve, reject) => {
            if (!window.google?.accounts?.oauth2) return reject(new Error('Google Identity SDK not loaded.'));
            gdriveTokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: GDRIVE_CLIENT_ID,
                scope: GDRIVE_SCOPES,
                callback: (res) => {
                    if (res.error) { reject(res); return; }
                    localStorage.setItem('gdrive_access_token', res.access_token);
                    localStorage.setItem('gdrive_token_expires', String(Date.now() + 3500000));
                    resolve(res.access_token);
                }
            });
            gdriveTokenClient.requestAccessToken({ prompt: 'consent' });
        });

        const gdriveLogout = () => {
            localStorage.removeItem('gdrive_access_token');
            localStorage.removeItem('gdrive_token_expires');
            gdriveTokenClient = null;
        };

        const gdriveIsConnected = () => {
            const exp = localStorage.getItem('gdrive_token_expires');
            return !!(exp && Date.now() < parseInt(exp));
        };

        const gdriveGetOrCreateFolder = async (token) => {
            const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${GDRIVE_FOLDER_NAME}' and trashed=false`);
            const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!listRes.ok) throw new Error(`Drive folder search failed: ${listRes.statusText}`);
            const listData = await listRes.json();
            if (listData.files && listData.files.length > 0) return listData.files[0].id;
            const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: GDRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
            });
            if (!createRes.ok) throw new Error(`Drive folder creation failed: ${createRes.statusText}`);
            const folder = await createRes.json();
            return folder.id;
        };

        const gdriveUpload = async () => {
            const token = await gdriveRequireToken();
            const folderId = await gdriveGetOrCreateFolder(token);
            const json = JSON.stringify(window.state, null, 2);
            const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `harvesting_backup_${dateStr}.json`;
            const boundary = '-------314159265358979323846';
            const body =
                `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
                JSON.stringify({ name: filename, mimeType: 'application/json', parents: [folderId] }) +
                `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
                json +
                `\r\n--${boundary}--`;
            const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
                body
            });
            if (!res.ok) {
                let msg = res.statusText;
                try { const e = await res.json(); if (e.error?.message) msg = e.error.message; } catch (_) { }
                throw new Error(`Google Drive upload failed: ${msg}`);
            }
            return await res.json();
        };

        const gdriveList = async () => {
            try {
                const token = await gdriveRequireToken();
                const folderId = await gdriveGetOrCreateFolder(token);
                const q = encodeURIComponent(`'${folderId}' in parents and mimeType='application/json' and trashed=false`);
                const fields = encodeURIComponent("files(id,name,size,createdTime)");
                const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=createdTime desc`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error(`Drive list failed: ${res.statusText}`);
                const data = await res.json();
                return (data.files || []).map(f => ({ id: f.id, name: f.name, size: f.size ? parseInt(f.size) : 0, timeCreated: f.createdTime }));
            } catch (e) { console.error('gdriveList:', e); return []; }
        };

        const gdriveDownload = async (fileId) => {
            const token = await gdriveRequireToken();
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error(`Drive download failed: ${res.statusText}`);
            return await res.json();
        };

        const gdriveDelete = async (fileId) => {
            const token = await gdriveRequireToken();
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok && res.status !== 204) throw new Error(`Drive delete failed: ${res.statusText}`);
            return true;
        };

        const gdriveEnforceRetention = async (retentionDays = 7) => {
            if (!gdriveIsConnected()) return 0;
            try {
                const backups = await gdriveList();
                const now = new Date();
                let deleted = 0;
                for (const b of backups) {
                    const diffDays = (now - new Date(b.timeCreated)) / (1000 * 60 * 60 * 24);
                    if (diffDays > retentionDays) { await gdriveDelete(b.id); deleted++; }
                }
                return deleted;
            } catch (e) { console.error('gdriveEnforceRetention:', e); return 0; }
        };

        // ── Backup helpers ──────────────────────────────────────────────
        const BACKUP_SETTINGS_KEY = 'harvestingBackupSettings';
        const BACKUP_DEFAULTS = { autoBackupEnabled: false, frequencyDays: 1, retentionDays: 7, lastBackupTime: null };

        const loadBackupSettings = () => {
            try {
                const saved = localStorage.getItem(BACKUP_SETTINGS_KEY);
                const parsed = saved ? JSON.parse(saved) : {};
                return { ...BACKUP_DEFAULTS, ...parsed };
            } catch { return { ...BACKUP_DEFAULTS }; }
        };

        // Save to both localStorage (for sync access) and Firebase (so all devices share settings)
        const saveBackupSettings = (s) => {
            localStorage.setItem(BACKUP_SETTINGS_KEY, JSON.stringify(s));
            try {
                if (window._backupSettingsDb) {
                    window._backupSettingsDb.ref('shared/backup_settings').set(JSON.stringify(s));
                }
            } catch (e) { console.warn('Could not save backup settings to Firebase:', e.message); }
        };

        // Sync backup settings from Firebase into localStorage so this device uses the shared config
        const syncBackupSettingsFromFirebase = async (dbRef) => {
            try {
                const snap = await dbRef.ref('shared/backup_settings').once('value');
                const val = snap.val();
                if (val) {
                    const remote = JSON.parse(val);
                    const local  = loadBackupSettings();
                    // Merge: prefer remote for policy fields; keep local lastBackupTime if more recent
                    const merged = { ...BACKUP_DEFAULTS, ...remote };
                    if (local.lastBackupTime && remote.lastBackupTime &&
                        new Date(local.lastBackupTime) > new Date(remote.lastBackupTime)) {
                        merged.lastBackupTime = local.lastBackupTime;
                    }
                    localStorage.setItem(BACKUP_SETTINGS_KEY, JSON.stringify(merged));
                }
            } catch (e) { console.warn('Could not sync backup settings from Firebase:', e.message); }
        };

        const showToast = (msg) => {
            const t = document.createElement('div');
            t.textContent = msg;
            t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;font-size:0.9rem;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,0.25);opacity:1;transition:opacity 0.4s;';
            document.body.appendChild(t);
            setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
        };

        const triggerBackup = async (silent = false) => {
            const settings = loadBackupSettings();
            try {
                if (gdriveIsConnected()) {
                    await gdriveUpload();
                    await gdriveEnforceRetention(settings.retentionDays);
                    settings.lastBackupTime = new Date().toISOString();
                    saveBackupSettings(settings);
                    showToast(silent ? 'Auto-backup saved to Google Drive.' : 'Backup saved to Google Drive.');
                } else {
                    const dataStr = JSON.stringify(window.state, null, 2);
                    const blob = new Blob([dataStr], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    a.download = `harvesting-backup-${dateStr}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    settings.lastBackupTime = new Date().toISOString();
                    saveBackupSettings(settings);
                    if (!silent) showToast('Backup downloaded locally (Google Drive not connected).');
                    else showToast('Auto-backup downloaded locally.');
                }
            } catch (err) {
                if (!silent) window.notify('Backup failed: ' + err.message, 'error');
                else console.error('Auto-backup failed:', err);
            }
        };

        const autoBackupCheck = () => {
            if (currentUserRole?.role !== 'admin') return;
            const settings = loadBackupSettings();
            if (!settings.autoBackupEnabled) return;
            const now = Date.now();
            const lastMs = settings.lastBackupTime ? new Date(settings.lastBackupTime).getTime() : 0;
            const diffDays = (now - lastMs) / (1000 * 60 * 60 * 24);
            if (diffDays >= settings.frequencyDays) triggerBackup(true);
        };

        let _activityDebounce = null;
        let _activityListenerAdded = false;
        const setupActivityBackupListener = () => {
            if (_activityListenerAdded || currentUserRole?.role !== 'admin') return;
            _activityListenerAdded = true;
            window.addEventListener('harvesting:activity', () => {
                if (_activityDebounce) clearTimeout(_activityDebounce);
                _activityDebounce = setTimeout(() => autoBackupCheck(), 15000);
            });
        };

        const renderBackupSettingsPanel = async () => {
            const wrapper = document.getElementById('user-mgmt-wrapper');
            if (!wrapper) return;

            ['main-report-wrapper', 'interval-wrapper', 'performance-wrapper',
                'ytd-wrapper', 'current-prev-wrapper', 'ffb-budget-wrapper', 'rainfall-wrapper']
                .forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
            wrapper.classList.remove('hidden');

            const settings = loadBackupSettings();
            const connected = gdriveIsConnected();
            const lastLabel = settings.lastBackupTime ? new Date(settings.lastBackupTime).toLocaleString() : 'Never';

            const fmtDate = (iso) => { const d = new Date(iso); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
            const fmtSize = (b) => { if (!b) return '—'; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; };

            const renderConnectView = () => {
                wrapper.innerHTML = `
            <div style="padding:1.5rem; max-width:680px;">
                <h2 style="margin-top:0; margin-bottom:1.5rem;">Backup Settings</h2>
                <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:2.5rem; text-align:center;">
                    <div style="font-size:3rem; margin-bottom:0.75rem;">☁️</div>
                    <h3 style="margin:0 0 0.5rem; color:var(--text-secondary);">Connect Google Drive</h3>
                    <p style="font-size:0.9rem; color:var(--text-muted); max-width:380px; margin:0 auto 1.5rem;">
                        Sign in with Google to enable cloud backups. All harvesting data will be saved to your Google Drive.
                    </p>
                    <button id="btn-gdrive-connect" class="btn-primary" style="padding:0.6rem 1.6rem;">Sign in with Google</button>
                    <p id="gdrive-connect-msg" style="margin-top:0.75rem; font-size:0.85rem; color:#ef4444; min-height:1.2rem;"></p>
                </div>
            </div>`;
                wrapper.querySelector('#btn-gdrive-connect').onclick = async () => {
                    const msg = wrapper.querySelector('#gdrive-connect-msg');
                    try {
                        msg.textContent = 'Connecting…';
                        msg.style.color = 'var(--text-secondary)';
                        await gdriveLogin();
                        renderBackupSettingsPanel();
                    } catch (e) {
                        msg.style.color = '#ef4444';
                        msg.textContent = 'Failed to connect: ' + (e.details || e.message || 'Unknown error. Check that the OAuth Client ID is configured.');
                    }
                };
            };

            const renderConnectedView = async () => {
                wrapper.innerHTML = `<div style="padding:1.5rem; max-width:680px;"><p style="color:var(--text-secondary);">Loading backups…</p></div>`;
                const backups = await gdriveList();

                const backupRows = backups.length === 0
                    ? `<tr><td colspan="3" style="padding:1.5rem; text-align:center; color:var(--text-muted); font-size:0.9rem;">No backups found in Google Drive.</td></tr>`
                    : backups.map(b => `
                    <tr data-id="${H(b.id)}" data-name="${H(b.name)}" style="border-bottom:1px solid var(--border-color);">
                        <td style="padding:10px 8px; font-size:0.88rem;">${H(fmtDate(b.timeCreated))}</td>
                        <td style="padding:10px 8px; font-size:0.88rem; color:var(--text-secondary);">${fmtSize(b.size)}</td>
                        <td style="padding:10px 8px; display:flex; gap:6px;">
                            <button class="btn-restore-backup btn-secondary" data-id="${H(b.id)}" data-name="${H(b.name)}" style="padding:3px 10px; font-size:0.8rem;">Restore</button>
                            <button class="btn-delete-backup" data-id="${H(b.id)}" data-name="${H(b.name)}" style="padding:3px 10px; font-size:0.8rem; background:#dc3545; color:#fff; border:none; border-radius:4px; cursor:pointer;">Delete</button>
                        </td>
                    </tr>`).join('');

                wrapper.innerHTML = `
            <div style="padding:1.5rem; max-width:680px;">
                <h2 style="margin-top:0; margin-bottom:1.5rem;">Backup Settings</h2>

                <!-- Drive status bar -->
                <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:1rem 1.5rem; margin-bottom:1.5rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                    <span style="font-size:0.9rem;">☁️ <strong>Google Drive</strong> connected &nbsp;<span style="color:#22c55e;">●</span></span>
                    <div style="display:flex; gap:8px;">
                        <button id="btn-backup-now" class="btn-primary" style="padding:0.4rem 1rem; font-size:0.85rem;">Backup Now</button>
                        <button id="btn-gdrive-disconnect" class="btn-secondary" style="padding:0.4rem 1rem; font-size:0.85rem;">Disconnect</button>
                    </div>
                </div>

                <div style="display:flex; gap:1.5rem; flex-wrap:wrap; align-items:flex-start;">
                    <!-- Settings column -->
                    <div style="flex:1; min-width:220px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:1.5rem;">
                        <h3 style="margin-top:0; margin-bottom:1rem; font-size:1rem;">Automation</h3>
                        <label style="display:flex; align-items:center; gap:8px; margin-bottom:1rem; cursor:pointer; font-size:0.9rem;">
                            <input type="checkbox" id="auto-backup-enabled" ${settings.autoBackupEnabled ? 'checked' : ''} style="width:15px;height:15px;" />
                            Auto-Backup on Login
                        </label>
                        <div style="margin-bottom:1rem;">
                            <label style="font-size:0.82rem; color:var(--text-secondary); display:block; margin-bottom:4px;">Frequency</label>
                            <select id="auto-backup-frequency" class="edit-input" style="width:100%; padding:0.4rem 0.6rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card);" ${!settings.autoBackupEnabled ? 'disabled' : ''}>
                                <option value="1" ${settings.frequencyDays === 1 ? 'selected' : ''}>Every Day</option>
                                <option value="3" ${settings.frequencyDays === 3 ? 'selected' : ''}>Every 3 Days</option>
                                <option value="7" ${settings.frequencyDays === 7 ? 'selected' : ''}>Weekly</option>
                            </select>
                        </div>
                        <div style="margin-bottom:1rem;">
                            <label style="font-size:0.82rem; color:var(--text-secondary); display:block; margin-bottom:4px;">Retention Policy</label>
                            <select id="backup-retention" class="edit-input" style="width:100%; padding:0.4rem 0.6rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card);">
                                <option value="3"  ${settings.retentionDays === 3 ? 'selected' : ''}>Keep 3 Days</option>
                                <option value="7"  ${settings.retentionDays === 7 ? 'selected' : ''}>Keep 7 Days</option>
                                <option value="14" ${settings.retentionDays === 14 ? 'selected' : ''}>Keep 14 Days</option>
                                <option value="30" ${settings.retentionDays === 30 ? 'selected' : ''}>Keep 30 Days</option>
                            </select>
                        </div>
                        <div style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:1rem;">
                            Last backup:<br><strong style="color:var(--text-primary);">${lastLabel}</strong>
                        </div>
                        <button id="btn-save-backup-settings" class="btn-primary" style="width:100%; padding:0.45rem;">Save Settings</button>
                        <p id="backup-settings-msg" style="margin:0.5rem 0 0; font-size:0.82rem; color:#22c55e; min-height:1rem;"></p>
                    </div>

                    <!-- History column -->
                    <div style="flex:2; min-width:280px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:1.5rem;">
                        <h3 style="margin-top:0; margin-bottom:1rem; font-size:1rem;">Google Drive Backups</h3>
                        <table style="width:100%; border-collapse:collapse; font-size:0.88rem;">
                            <thead>
                                <tr style="border-bottom:2px solid var(--border-color);">
                                    <th style="text-align:left; padding:6px 8px; color:var(--text-secondary); font-weight:600;">Date / Time</th>
                                    <th style="text-align:left; padding:6px 8px; color:var(--text-secondary); font-weight:600;">Size</th>
                                    <th style="text-align:left; padding:6px 8px; color:var(--text-secondary); font-weight:600;">Actions</th>
                                </tr>
                            </thead>
                            <tbody>${backupRows}</tbody>
                        </table>
                    </div>
                </div>
            </div>`;

                // Toggle frequency on checkbox change
                const enabledCb = wrapper.querySelector('#auto-backup-enabled');
                const freqSel = wrapper.querySelector('#auto-backup-frequency');
                enabledCb.addEventListener('change', () => { freqSel.disabled = !enabledCb.checked; });

                // Save settings
                wrapper.querySelector('#btn-save-backup-settings').onclick = () => {
                    const s = loadBackupSettings();
                    s.autoBackupEnabled = enabledCb.checked;
                    s.frequencyDays = parseInt(freqSel.value);
                    s.retentionDays = parseInt(wrapper.querySelector('#backup-retention').value);
                    saveBackupSettings(s);
                    const msg = wrapper.querySelector('#backup-settings-msg');
                    msg.textContent = 'Settings saved!';
                    setTimeout(() => { msg.textContent = ''; }, 2500);
                };

                // Backup Now
                wrapper.querySelector('#btn-backup-now').onclick = async () => {
                    const btn = wrapper.querySelector('#btn-backup-now');
                    btn.disabled = true; btn.textContent = 'Backing up…';
                    await triggerBackup(false);
                    await renderBackupSettingsPanel();
                };

                // Disconnect
                wrapper.querySelector('#btn-gdrive-disconnect').onclick = () => {
                    gdriveLogout();
                    renderBackupSettingsPanel();
                };

                // Restore buttons
                wrapper.querySelectorAll('.btn-restore-backup').forEach(btn => {
                    btn.onclick = async () => {
                        const name = btn.getAttribute('data-name');
                        if (!confirm(`Restoring "${name}" will overwrite ALL current data.\n\nAre you sure?`)) return;
                        btn.disabled = true; btn.textContent = 'Restoring…';
                        try {
                            const data = await gdriveDownload(btn.getAttribute('data-id'));
                            Object.keys(state).forEach(k => delete state[k]);
                            Object.assign(state, data);
                            window.state = state;
                            await window.saveState(false);
                            window.notify('Backup restored! The page will now reload.', 'success');
                            setTimeout(() => location.reload(), 1200);
                        } catch (e) {
                            window.notify('Restore failed: ' + e.message, 'error');
                            btn.disabled = false; btn.textContent = 'Restore';
                        }
                    };
                });

                // Delete buttons
                wrapper.querySelectorAll('.btn-delete-backup').forEach(btn => {
                    btn.onclick = async () => {
                        const name = btn.getAttribute('data-name');
                        if (!confirm(`Delete backup "${name}"? This cannot be undone.`)) return;
                        btn.disabled = true;
                        try {
                            await gdriveDelete(btn.getAttribute('data-id'));
                            await renderBackupSettingsPanel();
                        } catch (e) {
                            window.notify('Delete failed: ' + e.message, 'error');
                            btn.disabled = false;
                        }
                    };
                });
            };

            if (connected) {
                await renderConnectedView();
            } else {
                renderConnectView();
            }
        };

        const renderUserManagementPanel = async () => {
            const wrapper = document.getElementById('user-mgmt-wrapper');
            if (!wrapper) return;

            // the sidebar entry is hidden for non-admins, but the view can
            // still be reached directly (e.g. #nav= deep link) — hard gate it
            if (!currentUserRole || currentUserRole.role !== 'admin') {
                wrapper.classList.remove('hidden');
                wrapper.innerHTML = '<div style="padding:2.5rem; text-align:center; color:var(--text-secondary);">🔒 User Management requires an admin account.</div>';
                return;
            }

            // Hide all other wrappers
            ['main-report-wrapper', 'interval-wrapper', 'performance-wrapper',
                'ytd-wrapper', 'current-prev-wrapper', 'ffb-budget-wrapper', 'rainfall-wrapper']
                .forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
            wrapper.classList.remove('hidden');

            wrapper.innerHTML = '<div style="padding:1rem; color:var(--text-secondary);">Loading users...</div>';

            let usersData = {};
            try {
                const snap = await db.ref('user_roles').once('value');
                usersData = snap.val() || {};
            } catch (e) {
                // Permission denied on parent node — fall back to empty and continue
                console.warn('Could not read all user_roles:', e.message);
                usersData = {};
            }

            // Always ensure the currently logged-in user appears in the list.
            // This handles first-time setup or cases where the write was blocked.
            const currentUid = auth.currentUser && auth.currentUser.uid;
            if (currentUid && !usersData[currentUid]) {
                const entry = {
                    email: (auth.currentUser && auth.currentUser.email) || (currentUserRole && currentUserRole.email) || '(unknown)',
                    role: (currentUserRole && currentUserRole.role) || 'admin',
                    allowedMenus: (currentUserRole && currentUserRole.allowedMenus) || 'all',
                    firstLogin: (currentUserRole && currentUserRole.firstLogin) || false
                };
                usersData[currentUid] = entry;
                // Try to persist the entry so future reads have it
                db.ref('user_roles/' + currentUid).set(entry).catch(() => { });
            }

            const allMenuOptions = [
                { key: 'ffbBudget', label: 'FFB Budget Estimate' },
                { key: 'planting', label: 'Planting Phase Record' },
                { key: 'gangs', label: 'Harvesting Gangs' },
                { key: 'performance', label: 'Harvesting Performance' },
                { key: 'ironhorse', label: 'Iron Horse' },
                { key: 'rainfall', label: 'Rainfall Record' },
                { key: 'weekly', label: 'Weekly Activity' },
                { key: 'wages', label: 'Rate of Wages' },
                { key: 'maintenance', label: 'Maintenance' },
                { key: 'reports', label: 'Reports' },
                { key: 'dataManagement', label: 'Data Management' }
            ];

            wrapper.innerHTML = `
        <div style="padding:1.5rem;">
            <h2 style="margin-top:0; margin-bottom:1.5rem;">User Management</h2>

            <!-- Create New User -->
            <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:1.5rem; margin-bottom:2rem;">
                <h3 style="margin-top:0; margin-bottom:1rem; font-size:1rem;">Create New User</h3>
                <div style="display:flex; gap:1rem; align-items:flex-end; flex-wrap:wrap;">
                    <div style="flex:1; min-width:200px;">
                        <label style="font-size:0.85rem; color:var(--text-secondary); display:block; margin-bottom:4px;">Email Address</label>
                        <input type="email" id="new-user-email" placeholder="user@example.com" class="edit-input" style="width:100%; padding:0.6rem; border:1px solid var(--border-color); border-radius:4px;" />
                    </div>
                    <div style="min-width:130px;">
                        <label style="font-size:0.85rem; color:var(--text-secondary); display:block; margin-bottom:4px;">Role</label>
                        <select id="new-user-role" class="edit-input" style="width:100%; padding:0.6rem; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card);">
                            <option value="user">Normal User</option>
                            <option value="admin">Admin</option>
                        </select>
                    </div>
                    <button id="btn-create-user" class="btn-primary" style="padding:0.6rem 1.5rem; white-space:nowrap;">Create User</button>
                </div>
                <div style="margin-top:1rem;">
                    <label style="font-size:0.85rem; color:var(--text-secondary); display:block; margin-bottom:6px;">Allowed Menus (for Normal User role):</label>
                    <div style="display:flex; flex-wrap:wrap; gap:8px;">
                        ${allMenuOptions.map(m => `
                            <div class="menu-perm-card" style="padding:6px 10px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-secondary);min-width:160px;">
                                <label style="display:flex;align-items:center;gap:5px;font-size:0.85rem;cursor:pointer;">
                                    <input type="checkbox" class="new-user-menu-cb" value="${m.key}" checked /> ${m.label}
                                </label>
                                <label style="display:flex;align-items:center;gap:5px;font-size:0.76rem;cursor:pointer;color:#2563eb;margin-top:4px;padding-left:2px;">
                                    <input type="checkbox" class="new-user-edit-cb" value="${m.key}" /> ✏ Can Edit
                                </label>
                            </div>`).join('')}
                    </div>
                </div>
                <p id="create-user-msg" style="margin-top:0.75rem; min-height:1.2rem; font-size:0.9rem;"></p>
            </div>

            <!-- Existing Users Table -->
            <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:1.5rem;">
                <h3 style="margin-top:0; margin-bottom:1rem; font-size:1rem;">Existing Users</h3>
                <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                    <thead>
                        <tr style="border-bottom:2px solid var(--border-color);">
                            <th style="text-align:left; padding:8px; color:var(--text-secondary); font-weight:600;">Email</th>
                            <th style="text-align:left; padding:8px; color:var(--text-secondary); font-weight:600;">Role</th>
                            <th style="text-align:left; padding:8px; color:var(--text-secondary); font-weight:600;">Allowed Menus</th>
                            <th style="text-align:left; padding:8px; color:var(--text-secondary); font-weight:600;">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="user-table-body">
                        ${Object.entries(usersData).map(([uid, u]) => `
                            <tr data-uid="${uid}" style="border-bottom:1px solid var(--border-color);">
                                <td style="padding:10px 8px;">${H(u.email || '(unknown)')}</td>
                                <td style="padding:10px 8px;">
                                    <select class="user-role-select edit-input" data-uid="${uid}" style="padding:4px 8px; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-card); font-size:0.85rem;">
                                        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                                        <option value="user" ${u.role === 'user' ? 'selected' : ''}>Normal User</option>
                                    </select>
                                </td>
                                <td style="padding:10px 8px; font-size:0.8rem; color:var(--text-secondary);">
                                    ${u.role === 'admin' ? 'All' : (Array.isArray(u.allowedMenus) ? u.allowedMenus.join(', ') : 'All')}
                                </td>
                                <td style="padding:10px 8px; display:flex; gap:6px;">
                                    <button class="btn-edit-user btn-primary" data-uid="${uid}" style="padding:4px 10px; font-size:0.8rem;">Edit</button>
                                    <button class="btn-reset-pw btn-secondary" data-uid="${uid}" data-email="${H(u.email || '')}" style="padding:4px 10px; font-size:0.8rem;">Reset PW</button>
                                    <button class="btn-delete-user" data-uid="${uid}" data-email="${H(u.email || '')}" style="padding:4px 10px; font-size:0.8rem; background:#dc3545; color:#fff; border:none; border-radius:4px; cursor:pointer;">Delete</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;

            // Edit User — opens inline edit modal
            wrapper.querySelectorAll('.btn-edit-user').forEach(btn => {
                btn.onclick = () => {
                    const uid = btn.getAttribute('data-uid');
                    const userData = usersData[uid];
                    if (!userData) return;
                    showEditUserModal(uid, userData, allMenuOptions, () => renderUserManagementPanel());
                };
            });

            // Reset Password
            wrapper.querySelectorAll('.btn-reset-pw').forEach(btn => {
                btn.onclick = () => {
                    const email = btn.getAttribute('data-email');
                    if (!email) { window.notify('No email address on record for this user.', 'error'); return; }
                    if (confirm(`Send password reset email to ${email}?`)) {
                        auth.sendPasswordResetEmail(email)
                            .then(() => window.notify(`Reset email sent to ${email}.`, 'success'))
                            .catch(e => window.notify('Error: ' + e.message, 'error'));
                    }
                };
            });

            // Delete User
            wrapper.querySelectorAll('.btn-delete-user').forEach(btn => {
                btn.onclick = async () => {
                    const uid = btn.getAttribute('data-uid');
                    const email = btn.getAttribute('data-email');
                    if (uid === currentUid) {
                        window.notify('You cannot delete your own account.', 'error');
                        return;
                    }
                    if (!confirm(`Delete user "${email}"?\n\nThis will remove their access permanently. The Firebase Auth account will remain but they will no longer be able to log in.`)) return;
                    try {
                        await db.ref('user_roles/' + uid).remove();
                        window.notify(`User "${email}" has been removed.`, 'success');
                        renderUserManagementPanel();
                    } catch (e) {
                        window.notify('Error deleting user: ' + e.message, 'error');
                    }
                };
            });

            // Sync menu ↔ Can Edit checkboxes in Create User form
            wrapper.querySelectorAll('.new-user-menu-cb').forEach(menuCb => {
                const editCb = wrapper.querySelector(`.new-user-edit-cb[value="${menuCb.value}"]`);
                const syncEdit = () => {
                    if (editCb) { editCb.disabled = !menuCb.checked; if (!menuCb.checked) editCb.checked = false; }
                };
                syncEdit();
                menuCb.addEventListener('change', syncEdit);
            });

            // Create User
            document.getElementById('btn-create-user').onclick = () => createNewUser(allMenuOptions);
        };

        const showEditUserModal = (uid, userData, allMenuOptions, onSaved) => {
            const existing = document.getElementById('edit-user-modal-overlay');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'edit-user-modal-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:10000;display:flex;justify-content:center;align-items:center;';
            overlay.innerHTML = `
            <div style="background:var(--bg-card);padding:2rem;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.2);width:480px;max-width:95vw;">
                <h3 style="margin-top:0;">Edit User: ${H(userData.email || uid)}</h3>
                <div style="margin-bottom:1rem;">
                    <label style="font-size:0.85rem;color:var(--text-secondary);display:block;margin-bottom:4px;">Role</label>
                    <select id="edit-role-select" style="padding:0.6rem;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);width:200px;">
                        <option value="user" ${userData.role === 'user' ? 'selected' : ''}>Normal User</option>
                        <option value="admin" ${userData.role === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                </div>
                <div id="edit-menu-section" style="${userData.role === 'admin' ? 'opacity:0.4;pointer-events:none;' : ''}">
                    <label style="font-size:0.85rem;color:var(--text-secondary);display:block;margin-bottom:6px;">Allowed Menus:</label>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        ${allMenuOptions.map(m => {
                const checked  = userData.role === 'admin' || userData.allowedMenus === 'all' || (Array.isArray(userData.allowedMenus) && userData.allowedMenus.includes(m.key));
                const editable = userData.role === 'admin' || userData.editableMenus === 'all' || (Array.isArray(userData.editableMenus) && userData.editableMenus.includes(m.key));
                return `<div class="menu-perm-card" style="padding:6px 10px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-secondary);min-width:160px;">
                                <label style="display:flex;align-items:center;gap:5px;font-size:0.85rem;cursor:pointer;">
                                    <input type="checkbox" class="edit-menu-cb" value="${m.key}" ${checked ? 'checked' : ''} /> ${m.label}
                                </label>
                                <label style="display:flex;align-items:center;gap:5px;font-size:0.76rem;cursor:pointer;color:#2563eb;margin-top:4px;padding-left:2px;">
                                    <input type="checkbox" class="edit-edit-cb" value="${m.key}" ${editable ? 'checked' : ''} ${!checked ? 'disabled' : ''} /> ✏ Can Edit
                                </label>
                            </div>`;
            }).join('')}
                    </div>
                </div>
                <div style="display:flex;gap:0.75rem;margin-top:1.5rem;justify-content:flex-end;">
                    <button id="edit-user-cancel" class="btn-secondary" style="padding:0.6rem 1.5rem;">Cancel</button>
                    <button id="edit-user-save" class="btn-primary" style="padding:0.6rem 1.5rem;">Save</button>
                </div>
                <p id="edit-user-msg" style="margin-top:0.5rem;min-height:1.2rem;font-size:0.85rem;color:var(--danger);"></p>
            </div>`;
            document.body.appendChild(overlay);

            const roleSelect = document.getElementById('edit-role-select');
            const menuSection = document.getElementById('edit-menu-section');
            roleSelect.onchange = () => {
                menuSection.style.opacity = roleSelect.value === 'admin' ? '0.4' : '1';
                menuSection.style.pointerEvents = roleSelect.value === 'admin' ? 'none' : '';
            };

            // Sync menu ↔ Can Edit checkboxes in Edit modal
            overlay.querySelectorAll('.edit-menu-cb').forEach(menuCb => {
                const editCb = overlay.querySelector(`.edit-edit-cb[value="${menuCb.value}"]`);
                const syncEdit = () => {
                    if (editCb) { editCb.disabled = !menuCb.checked; if (!menuCb.checked) editCb.checked = false; }
                };
                syncEdit();
                menuCb.addEventListener('change', syncEdit);
            });

            document.getElementById('edit-user-cancel').onclick = () => overlay.remove();
            document.getElementById('edit-user-save').onclick = async () => {
                const newRole = roleSelect.value;
                const checkedMenus  = [...overlay.querySelectorAll('.edit-menu-cb:checked')].map(cb => cb.value);
                const editableMenus = [...overlay.querySelectorAll('.edit-edit-cb:checked')].map(cb => cb.value);
                const allowedMenus  = newRole === 'admin' ? 'all' : checkedMenus;
                const editPerms     = newRole === 'admin' ? 'all' : editableMenus;
                try {
                    await db.ref('user_roles/' + uid).update({ role: newRole, allowedMenus, editableMenus: editPerms, editableMenusMap: menusToMap(editableMenus) });
                    overlay.remove();
                    if (onSaved) onSaved();
                } catch (e) {
                    document.getElementById('edit-user-msg').textContent = 'Error: ' + e.message;
                }
            };
        };

        const createNewUser = (allMenuOptions) => {
            const emailVal = document.getElementById('new-user-email').value.trim();
            const roleVal = document.getElementById('new-user-role').value;
            const msgEl = document.getElementById('create-user-msg');
            const checkedMenus = [...document.querySelectorAll('.new-user-menu-cb:checked')].map(cb => cb.value);
            const checkedEditMenus = [...document.querySelectorAll('.new-user-edit-cb:checked')].map(cb => cb.value);

            if (!emailVal) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = 'Please enter an email address.'; return; }
            msgEl.style.color = 'var(--text-secondary)'; msgEl.textContent = 'Creating user...';

            // Use secondary Firebase app so admin doesn't get logged out
            let secondaryApp;
            try {
                secondaryApp = firebase.app('secondary');
            } catch (e) {
                secondaryApp = firebase.initializeApp(firebase.app().options, 'secondary');
            }
            const secondaryAuth = secondaryApp.auth();

            // Random per-user temporary password (not a shared default like
            // "user1234"). The user is forced to change it on first login.
            const tempPassword = (() => {
                const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
                const buf = new Uint32Array(12);
                (window.crypto || window.msCrypto).getRandomValues(buf);
                return Array.from(buf, n => chars[n % chars.length]).join('') + '#7';
            })();
            secondaryAuth.createUserWithEmailAndPassword(emailVal, tempPassword)
                .then(async (cred) => {
                    const newUid = cred.user.uid;
                    const allowedMenus = roleVal === 'admin' ? 'all' : checkedMenus;
                    const editableMenus = roleVal === 'admin' ? 'all' : checkedEditMenus;
                    await db.ref('user_roles/' + newUid).set({
                        email: emailVal,
                        role: roleVal,
                        allowedMenus,
                        editableMenus,
                        editableMenusMap: menusToMap(checkedEditMenus),
                        firstLogin: true,
                        createdAt: Date.now()
                    });
                    await secondaryAuth.signOut();

                    // Build welcome email via mailto
                    const appUrl = window.location.href.split('#')[0];
                    const emailBody = encodeURIComponent(
                        `Hello,\n\nYour account for the Harvesting Performance Dashboard has been created.\n\nLogin URL: ${appUrl}\nEmail: ${emailVal}\nTemporary Password: ${tempPassword}\n\nPlease login and change your password when prompted.\n\nThank you.`
                    );
                    const mailtoLink = `mailto:${emailVal}?subject=Your%20Dashboard%20Account&body=${emailBody}`;

                    msgEl.style.color = '#10b981';
                    msgEl.textContent = `User "${emailVal}" created successfully!`;
                    document.getElementById('new-user-email').value = '';

                    const sendNow = confirm(`User "${emailVal}" created!\nTemp password: ${tempPassword}\n\nClick OK to open your email client to send the welcome email, or Cancel to skip.`);
                    if (sendNow) window.open(mailtoLink, '_blank');

                    renderUserManagementPanel(); // Refresh list
                })
                .catch(e => {
                    secondaryAuth.signOut().catch(() => { });
                    msgEl.style.color = 'var(--danger)';
                    msgEl.textContent = 'Error: ' + e.message;
                });
        };
        return {
            loadUserRole, applyRolePermissions, renderUserManagementPanel,
            checkFirstLogin, autoBackupCheck, setupActivityBackupListener,
            syncBackupSettingsFromFirebase, renderBackupSettingsPanel, triggerBackup
        };
};
