// ===== FIREBASE CONFIG =====
const firebaseConfig = {
    apiKey: "AIzaSyCM4EmA40kcZnsNAGZKqWRqjDNAfRYXHq0",
    authDomain: "fruitcrush-486da.firebaseapp.com",
    projectId: "fruitcrush-486da",
    storageBucket: "fruitcrush-486da.firebasestorage.app",
    messagingSenderId: "656323206289",
    appId: "1:656323206289:web:05f3a4f5d851f9db3eb330"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// ===== OFFLINE PERSISTENCE (sekali saja) =====
let _persistenceEnabled = false;
(function enablePersistence() {
    if (_persistenceEnabled) return;
    _persistenceEnabled = true;
    db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
        if (err.code === 'failed-precondition') {
            console.warn('⚠️ Persistence failed: multiple tabs open');
        } else if (err.code === 'unimplemented') {
            console.warn('⚠️ Persistence not available');
        }
    });
})();

// ===== AUTH STATE CACHE (SINGLE SOURCE OF TRUTH) =====
// undefined = belum tahu, null = logged out, object = logged in
let _cachedUser = undefined;
let _authReadyPromise = null;

function _initAuthWatcher() {
    if (_authReadyPromise) return _authReadyPromise;
    _authReadyPromise = new Promise((resolve) => {
        let resolved = false;
        const unsub = auth.onAuthStateChanged((user) => {
            if (resolved) return;
            resolved = true;
            _cachedUser = user || null;
            unsub();
            resolve(_cachedUser);
        });
        // Fallback: kalau Firebase hang
        setTimeout(() => {
            if (resolved) return;
            resolved = true;
            try { unsub(); } catch (e) {}
            _cachedUser = auth.currentUser || null;
            resolve(_cachedUser);
        }, 4000);
    });
    return _authReadyPromise;
}

// Reset cache saat logout (biar halaman berikutnya re-check)
auth.onAuthStateChanged((user) => {
    if (_cachedUser !== undefined && user === null) {
        _cachedUser = null;
    }
});

window.FB = {
    auth,
    db,

    // ✅ FIX: waitForAuth pakai cache — hanya listen sekali
    waitForAuth() {
        if (_cachedUser !== undefined) {
            return Promise.resolve(_cachedUser);
        }
        return _initAuthWatcher();
    },

    // ✅ FIX: requireAuth hindari redirect loop
    async requireAuth(redirectTo) {
        const user = await this.waitForAuth();
        if (!user) {
            const next = redirectTo || (window.location.pathname.split('/').pop() + window.location.search);
            console.log('❌ Not authenticated, redirect to login. Next:', next);
            if (!window.location.pathname.endsWith('login.html')) {
                window.location.href = 'login.html?next=' + encodeURIComponent(next);
            }
            return null;
        }
        return user;
    },

    async getUserData(uid) {
        if (!uid) return null;
        try {
            const doc = await db.collection('users').doc(uid).get();
            return doc.exists ? { uid, ...doc.data() } : null;
        } catch (e) {
            console.error('getUserData error:', e);
            return null;
        }
    },

    async updateBalance(uid, delta) {
        if (!uid) throw new Error('UID wajib diisi');
        if (typeof delta !== 'number' || isNaN(delta)) throw new Error('Delta tidak valid');

        const currentUid = auth.currentUser ? auth.currentUser.uid : null;
        if (!currentUid) throw new Error('User tidak login');
        if (currentUid !== uid) throw new Error('UID mismatch: tidak boleh update saldo user lain');

        const userRef = db.collection('users').doc(uid);
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(delta),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    // ✅ setBalance dengan validasi lengkap
    async setBalance(uid, value) {
        if (!uid) throw new Error('UID wajib diisi');
        if (typeof value !== 'number' || isNaN(value)) throw new Error('Value tidak valid');
        const currentUid = auth.currentUser ? auth.currentUser.uid : null;
        if (!currentUid) throw new Error('User tidak login');
        if (currentUid !== uid) throw new Error('UID mismatch');
        const userRef = db.collection('users').doc(uid);
        await userRef.update({
            balance: value,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    async logTransaction({ uid, username, type, amount, note, extra }) {
        if (!uid) throw new Error('UID wajib untuk log transaksi');
        const currentUid = auth.currentUser ? auth.currentUser.uid : null;
        if (!currentUid) throw new Error('User tidak login');
        if (currentUid !== uid) throw new Error('UID mismatch pada log transaksi');

        return db.collection('transactions').add({
            uid,
            username: username || 'unknown',
            type,
            amount: Number(amount),
            note: note || '',
            extra: extra || {},
            status: 'success',
            time: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    // ✅ HELPER TERPUSAT: buat top up pending (dipakai qris.html & pembayaran.html)
    async createPendingTopup({ uid, username, amount, method }) {
        if (!uid || !username) throw new Error('UID & username wajib');
        if (!amount || amount < 1000) throw new Error('Nominal minimal Rp 1.000');

        const currentUid = auth.currentUser ? auth.currentUser.uid : null;
        if (currentUid !== uid) throw new Error('UID mismatch');

        const methodName = method || 'QRIS';

        // 1. Buat dokumen topup
        const topupRef = await db.collection('topups').add({
            uid,
            username,
            amount,
            total: amount,
            method: methodName,
            status: 'pending',
            time: firebase.firestore.FieldValue.serverTimestamp()
        });

        // 2. Log transaksi pending
        await db.collection('transactions').add({
            uid,
            username,
            type: 'topup',
            amount,
            note: `Top up via ${methodName} (menunggu approve admin)`,
            extra: {
                amount,
                method: methodName,
                status: 'pending',
                topupId: topupRef.id
            },
            status: 'pending',
            time: firebase.firestore.FieldValue.serverTimestamp()
        });

        return topupRef.id;
    },

    formatRp(n) {
        return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
    },

    formatNumber(n) {
        return Math.round(n || 0).toLocaleString('id-ID');
    },

    async logout() {
        try {
            await auth.signOut();
        } catch (e) {
            console.warn('signOut error:', e);
        }
        if ('caches' in window) {
            try {
                const names = await caches.keys();
                await Promise.all(names.map(n => caches.delete(n)));
            } catch (e) { /* ignore */ }
        }
        window.location.href = 'login.html';
    },

    registerSW() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('sw.js')
                    .then((reg) => console.log('✅ SW registered:', reg.scope))
                    .catch((err) => console.warn('SW register failed:', err));
            });
        }
    }
};

console.log('🔥 Firebase initialized');
