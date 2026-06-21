// =====================================================================
// demo_firebase_mock.js — DEMO MODE backend shim (NOT the real app)
//
// This file makes the DEMO build completely self-contained: it replaces the
// real Firebase compat SDK (firebase-app / auth / database) with a tiny
// drop-in that is backed entirely by the browser's localStorage. Nothing
// here ever talks to the cloud, so the demo can never read or overwrite the
// real plantation data.
//
// It mimics exactly the slice of the Firebase API the app uses:
//   firebase.apps / initializeApp / app / auth() / database()
//   auth: currentUser, onAuthStateChanged, setPersistence,
//         signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
//         createUserWithEmailAndPassword
//   database: ref(path) -> set / update / remove / push / once / on /
//             child / orderByChild / limitToLast / endAt / startAt / equalTo
//   snapshot: val / exists / key / numChildren / forEach / child / ref
//
// OPEN ACCESS: on page load it seeds demo data (once) and auto-signs-in a
// demo admin user, so the login screen is skipped entirely.
//
// Loaded FIRST (before app_boot.js). The real Firebase <script> CDN tags are
// removed from DEMO/index.html — this provides window.firebase instead.
// =====================================================================
(function () {
    'use strict';

    var DB_KEY = 'demo_fb_db_v1';
    var DEMO_USER = { uid: 'demo-user', email: 'demo@antigravity.example' };

    // ---- localStorage-backed JSON tree -----------------------------------
    var tree;
    try { tree = JSON.parse(localStorage.getItem(DB_KEY) || '{}'); } catch (e) { tree = {}; }

    function persist() {
        try { localStorage.setItem(DB_KEY, JSON.stringify(tree)); }
        catch (e) { console.warn('[DEMO] could not persist to localStorage:', e && e.message); }
    }
    function clone(v) {
        if (v === undefined || v === null) return v;
        try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
    }
    function parts(path) { return String(path || '').split('/').filter(Boolean); }

    function getPath(path) {
        var p = parts(path), n = tree;
        for (var i = 0; i < p.length; i++) {
            if (n == null || typeof n !== 'object') return undefined;
            n = n[p[i]];
        }
        return n;
    }
    function setPath(path, val) {
        var p = parts(path), n = tree;
        for (var i = 0; i < p.length - 1; i++) {
            if (n[p[i]] == null || typeof n[p[i]] !== 'object') n[p[i]] = {};
            n = n[p[i]];
        }
        if (p.length) n[p[p.length - 1]] = val; else tree = val;
        persist();
    }
    function removePath(path) {
        var p = parts(path), n = tree;
        for (var i = 0; i < p.length - 1; i++) {
            if (n[p[i]] == null || typeof n[p[i]] !== 'object') return;
            n = n[p[i]];
        }
        if (p.length) { delete n[p[p.length - 1]]; persist(); }
    }

    // ---- Snapshot --------------------------------------------------------
    function makeSnap(val, key, path) {
        return {
            key: key != null ? key : null,
            ref: makeRef(path || ''),
            val: function () { return val === undefined ? null : val; },
            exists: function () { return val !== undefined && val !== null; },
            numChildren: function () {
                return (val && typeof val === 'object') ? Object.keys(val).length : 0;
            },
            child: function (k) {
                var cv = (val && typeof val === 'object') ? val[k] : undefined;
                return makeSnap(cv, k, (path ? path + '/' : '') + k);
            },
            forEach: function (cb) {
                if (val && typeof val === 'object') {
                    var keys = Object.keys(val);
                    for (var i = 0; i < keys.length; i++) {
                        var k = keys[i];
                        var stop = cb(makeSnap(val[k], k, (path ? path + '/' : '') + k));
                        if (stop === true) return true;
                    }
                }
                return false;
            }
        };
    }

    // ---- Query (orderByChild / limitToLast / endAt ...) ------------------
    // Light implementation — enough for the audit log. Sorting/filtering is
    // approximate; the demo's audit log is tiny so this is fine.
    function makeQuery(path, opts) {
        opts = opts || {};
        function withOpt(extra) {
            var merged = {};
            for (var k in opts) merged[k] = opts[k];
            for (var j in extra) merged[j] = extra[j];
            return makeQuery(path, merged);
        }
        function snapshot() {
            var raw = getPath(path);
            var obj = (raw && typeof raw === 'object') ? raw : {};
            var entries = Object.keys(obj).map(function (k) { return [k, obj[k]]; });
            if (opts.orderBy) {
                entries.sort(function (a, b) {
                    var av = a[1] && a[1][opts.orderBy], bv = b[1] && b[1][opts.orderBy];
                    return (av > bv ? 1 : av < bv ? -1 : 0);
                });
            }
            if (opts.endAt != null && opts.orderBy) {
                entries = entries.filter(function (e) { return (e[1] && e[1][opts.orderBy]) <= opts.endAt; });
            }
            if (opts.startAt != null && opts.orderBy) {
                entries = entries.filter(function (e) { return (e[1] && e[1][opts.orderBy]) >= opts.startAt; });
            }
            if (opts.limitToLast != null) entries = entries.slice(-opts.limitToLast);
            if (opts.limitToFirst != null) entries = entries.slice(0, opts.limitToFirst);
            var rebuilt = {};
            entries.forEach(function (e) { rebuilt[e[0]] = e[1]; });
            return makeSnap(rebuilt, parts(path).pop() || null, path);
        }
        return {
            orderByChild: function (f) { return withOpt({ orderBy: f }); },
            orderByKey: function () { return withOpt({ orderBy: null }); },
            limitToLast: function (n) { return withOpt({ limitToLast: n }); },
            limitToFirst: function (n) { return withOpt({ limitToFirst: n }); },
            endAt: function (v) { return withOpt({ endAt: v }); },
            startAt: function (v) { return withOpt({ startAt: v }); },
            equalTo: function (v) { return withOpt({ startAt: v, endAt: v }); },
            once: function (evt, cb) {
                var snap = snapshot();
                if (typeof cb === 'function') { try { cb(snap); } catch (e) { } }
                return Promise.resolve(snap);
            },
            on: function (evt, cb) {
                var snap = snapshot();
                if (typeof cb === 'function') { try { cb(snap); } catch (e) { } }
                return cb;
            },
            off: function () { }
        };
    }

    // ---- Ref -------------------------------------------------------------
    function makeRef(path) {
        var key = parts(path).pop() || null;
        var ref = {
            key: key,
            toString: function () { return 'demo://' + path; },
            child: function (k) { return makeRef((path ? path + '/' : '') + k); },
            parent: function () { var pp = parts(path); pp.pop(); return makeRef(pp.join('/')); },
            set: function (val) { setPath(path, clone(val)); return Promise.resolve(); },
            update: function (obj) {
                var cur = getPath(path);
                var merged = (cur && typeof cur === 'object') ? cur : {};
                for (var k in obj) merged[k] = clone(obj[k]);
                setPath(path, merged);
                return Promise.resolve();
            },
            remove: function () { removePath(path); return Promise.resolve(); },
            push: function (val) {
                var id = '-demo' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
                var childPath = (path ? path + '/' : '') + id;
                if (val !== undefined) setPath(childPath, clone(val));
                var r = makeRef(childPath);
                // push() returns a thenable ref (Firebase semantics)
                var p = Promise.resolve(r);
                r.then = p.then.bind(p);
                r.catch = p.catch.bind(p);
                return r;
            },
            once: function (evt, cb) {
                var snap = makeSnap(getPath(path), key, path);
                if (typeof cb === 'function') { try { cb(snap); } catch (e) { } }
                return Promise.resolve(snap);
            },
            on: function (evt, cb) {
                var snap = makeSnap(getPath(path), key, path);
                if (typeof cb === 'function') { try { cb(snap); } catch (e) { } }
                return cb;
            },
            off: function () { },
            orderByChild: function (f) { return makeQuery(path, { orderBy: f }); },
            orderByKey: function () { return makeQuery(path, {}); },
            limitToLast: function (n) { return makeQuery(path, { limitToLast: n }); },
            limitToFirst: function (n) { return makeQuery(path, { limitToFirst: n }); },
            endAt: function (v) { return makeQuery(path, { endAt: v }); },
            startAt: function (v) { return makeQuery(path, { startAt: v }); }
        };
        return ref;
    }

    var dbInstance = { ref: function (path) { return makeRef(path || ''); } };

    // ---- Auth ------------------------------------------------------------
    function makeAuth() {
        var cbs = [];
        var fired = false;
        var api = {
            currentUser: null,
            onAuthStateChanged: function (cb) {
                cbs.push(cb);
                if (fired) { try { cb(api.currentUser); } catch (e) { } }
                return function () { var i = cbs.indexOf(cb); if (i >= 0) cbs.splice(i, 1); };
            },
            setPersistence: function () { return Promise.resolve(); },
            signInWithEmailAndPassword: function (email) {
                api._signIn({ uid: 'demo-user', email: email || DEMO_USER.email });
                return Promise.resolve({ user: api.currentUser });
            },
            createUserWithEmailAndPassword: function (email) {
                return Promise.resolve({ user: { uid: 'u' + Date.now().toString(36), email: email } });
            },
            sendPasswordResetEmail: function () { return Promise.resolve(); },
            // Logout is a no-op in the demo (keeps the single demo session alive).
            signOut: function () {
                if (window.notify) window.notify('Logout is disabled in the demo.', 'info');
                return Promise.resolve();
            },
            _signIn: function (user) {
                api.currentUser = user;
                fired = true;
                cbs.slice().forEach(function (cb) { try { cb(user); } catch (e) { } });
            }
        };
        return api;
    }
    var authInstance = makeAuth();

    // ---- firebase namespace ---------------------------------------------
    function authNamespace() { return authInstance; }
    authNamespace.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };

    function databaseNamespace() { return dbInstance; }
    databaseNamespace.ServerValue = { TIMESTAMP: Date.now() };

    var defaultApp = {
        name: '[DEFAULT]',
        options: { projectId: 'demo', databaseURL: 'demo://local' },
        auth: function () { return authInstance; },
        database: function () { return dbInstance; },
        delete: function () { return Promise.resolve(); }
    };

    window.firebase = {
        apps: [defaultApp],
        initializeApp: function (config, name) {
            if (!name || name === '[DEFAULT]') return defaultApp;
            // Secondary app (used by user-management create-user flow).
            var sec = {
                name: name, options: config || {},
                auth: function () { return makeAuth(); },
                database: function () { return dbInstance; },
                delete: function () { return Promise.resolve(); }
            };
            return sec;
        },
        app: function () { return defaultApp; },
        auth: authNamespace,
        database: databaseNamespace
    };

    // ---- Seed demo data + auto-login ------------------------------------
    function bootDemo() {
        try {
            if (!getPath('shared/app_state') && typeof window.__demoBuildSeed === 'function') {
                var seed = window.__demoBuildSeed();
                Object.keys(seed).forEach(function (p) { setPath(p, seed[p]); });
                console.log('[DEMO] seeded demo data into localStorage.');
            }
        } catch (e) {
            console.error('[DEMO] seeding failed:', e);
        }
        authInstance._signIn(DEMO_USER);
    }

    // Seed + sign in once everything (render modules, app_boot) has loaded and
    // registered its auth listener. window 'load' fires after DOMContentLoaded.
    if (document.readyState === 'complete') setTimeout(bootDemo, 0);
    else window.addEventListener('load', bootDemo);

    // Expose a reset helper for convenience (clears demo edits, reloads).
    window.__demoReset = function () { localStorage.removeItem(DB_KEY); location.reload(); };
})();
