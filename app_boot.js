// =====================================================================
// app_boot.js — login shell (Phase 9 split, extracted from script.js)
// Firebase init, login/logout, remember-me, idle timer. Exposes the
// auth/db handles on window._fb and starts the app by calling
// window.runMainApplication() (defined in script.js) after login.
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
    // --- FIREBASE INIT ---
    const firebaseConfig = {
        apiKey: "AIzaSyAavuTK1wjzYRqw54GAS5QW8ku0ahREN10",
        authDomain: "ffb-harvesting-report.firebaseapp.com",
        databaseURL: "https://ffb-harvesting-report-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "ffb-harvesting-report",
        storageBucket: "ffb-harvesting-report.firebasestorage.app",
        messagingSenderId: "783684002527",
        appId: "1:783684002527:web:f0a5396d9495ebaf5abf6a"
    };

    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.database();
    window._fb = { auth, db }; // shared with script.js (Phase 9 split)

    // --- LOGIN UI HANDLERS ---
    const loginOverlay = document.getElementById('login-overlay');
    const appLayout = document.getElementById('app-layout-main');
    const emailInp = document.getElementById('login-email');
    const passInp = document.getElementById('login-pass');
    const loginErr = document.getElementById('login-error');

    [emailInp, passInp].forEach(el => {
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('btn-login').click(); });
    });

    document.getElementById('btn-login').onclick = () => {
        loginErr.textContent = '';
        const email = emailInp.value.trim();
        const password = passInp.value;
        const rememberMe = document.getElementById('remember-me').checked;
        const persistence = rememberMe
            ? firebase.auth.Auth.Persistence.LOCAL
            : firebase.auth.Auth.Persistence.SESSION;
        auth.setPersistence(persistence)
            .then(() => auth.signInWithEmailAndPassword(email, password))
            .then(() => {
                if (rememberMe) {
                    const expiry = Date.now() + 90 * 24 * 60 * 60 * 1000; // 3 months
                    localStorage.setItem('rm_expiry_' + email, String(expiry));
                } else {
                    localStorage.removeItem('rm_expiry_' + email);
                }
            })
            .catch(e => { loginErr.textContent = e.message; });
    };

    // Forgot password handlers
    const forgotPwOverlay = document.getElementById('forgot-pw-overlay');
    document.getElementById('btn-forgot-password').onclick = (e) => {
        e.preventDefault();
        loginErr.textContent = '';
        document.getElementById('forgot-pw-email').value = emailInp.value;
        document.getElementById('forgot-pw-msg').textContent = '';
        forgotPwOverlay.style.display = 'flex';
    };
    document.getElementById('btn-forgot-pw-cancel').onclick = () => {
        forgotPwOverlay.style.display = 'none';
    };
    document.getElementById('btn-forgot-pw-send').onclick = () => {
        const fpEmail = document.getElementById('forgot-pw-email').value.trim();
        const msgEl = document.getElementById('forgot-pw-msg');
        if (!fpEmail) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = 'Please enter your email.'; return; }
        auth.sendPasswordResetEmail(fpEmail)
            .then(() => { msgEl.style.color = '#10b981'; msgEl.textContent = 'Reset link sent! Check your inbox.'; })
            .catch(e => { msgEl.style.color = 'var(--danger)'; msgEl.textContent = e.message; });
    };

    // Logout sidebar handler
    const sidebarLogout = document.getElementById('sidebar-logout');
    if (sidebarLogout) {
        sidebarLogout.onclick = (e) => {
            e.preventDefault();
            auth.signOut();
        };
    }



    // --- IDLE TIMEOUT LOGIC ---
    let idleTimer;
    let warningCountdownTimer;
    const IDLE_LIMIT = 15 * 60 * 1000; // 15 minutes
    const WARNING_LIMIT = 30; // 30 seconds

    const startIdleTimer = () => {
        if (!auth.currentUser) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(showIdleWarning, IDLE_LIMIT);
    };

    const showIdleWarning = () => {
        const modal = document.getElementById('idle-modal-overlay');
        const countdownEl = document.getElementById('idle-countdown');
        if (!modal) return;

        modal.style.display = 'flex';
        let remaining = WARNING_LIMIT;
        countdownEl.textContent = remaining;

        clearInterval(warningCountdownTimer);
        warningCountdownTimer = setInterval(() => {
            remaining--;
            countdownEl.textContent = remaining;
            if (remaining <= 0) {
                clearInterval(warningCountdownTimer);
                auth.signOut();
            }
        }, 1000);
    };

    const resetIdleState = () => {
        const modal = document.getElementById('idle-modal-overlay');
        if (modal && modal.style.display === 'flex') {
            modal.style.display = 'none';
            clearInterval(warningCountdownTimer);
            startIdleTimer();
        } else {
            startIdleTimer();
        }
    };

    // Listen for activity
    ['mousemove', 'mousedown', 'keypress', 'touchstart', 'scroll'].forEach(evt => {
        window.addEventListener(evt, () => {
            if (auth.currentUser) startIdleTimer();
        }, true);
    });

    const btnStayIn = document.getElementById('btn-stay-logged-in');
    if (btnStayIn) btnStayIn.onclick = resetIdleState;


    let isAppRunning = false;
    auth.onAuthStateChanged(user => {
        if (user) {
            // Check remember me expiry
            const rmKey = 'rm_expiry_' + user.email;
            const rmExpiry = localStorage.getItem(rmKey);
            if (rmExpiry && Date.now() > parseInt(rmExpiry)) {
                localStorage.removeItem(rmKey);
                auth.signOut();
                return;
            }
            loginOverlay.style.display = 'none';
            appLayout.style.display = 'grid';
            startIdleTimer();
            if (!isAppRunning) {
                isAppRunning = true;
                window.runMainApplication();
            }
        } else {
            loginOverlay.style.display = 'flex';
            appLayout.style.display = 'none';
            clearTimeout(idleTimer);
            clearInterval(warningCountdownTimer);
            if (isAppRunning) {
                window.location.reload(); // Reload to reset state on logout
            }
        }
    });

});
