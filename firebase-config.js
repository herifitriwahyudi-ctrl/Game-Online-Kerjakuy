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

// Persistensi offline — aman untuk multi-tab
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code === 'failed-precondition') {
        console.warn('Persistence failed: multiple tabs open');
    } else if (err.code === 'unimplemented') {
        console.warn('Persistence not available');
    }
});

window.FB = {
    auth,
    db,

    // ===== AUTH =====
    requireAuth(redirectTo) {
        return new Promise((resolve) => {
            const unsub = auth.onAuthStateChanged((user) => {
                unsub();
                if (!user) {
                    const next = redirectTo || window.location.pathname.split('/').pop();
                    window.location.href = 'login.html?next=' + encodeURIComponent(next);
                    resolve(null);
                } else {
                    resolve(user);
                }
            });
        });
    },

    // ===== USER DATA =====
    async getUserData(uid) {
        try {
            const doc = await db.collection('users').doc(uid).get();
            return doc.exists ? { uid, ...doc.data() } : null;
        } catch (e) {
            console.error('getUserData error:', e);
            return null;
        }
    },

    // ===== BALANCE (atomic increment) =====
    async updateBalance(uid, delta) {
        if (!uid) throw new Error('UID wajib diisi');
        if (typeof delta !== 'number' || isNaN(delta)) throw new Error('Delta tidak valid');

        // Validasi UID aktif — cegah salah user
        const currentUid = auth.currentUser ? auth.currentUser.uid : null;
        if (!currentUid) throw new Error('User tidak login');
        if (currentUid !== uid) {
            throw new Error('UID mismatch: tidak boleh update saldo user lain');
        }

        const userRef = db.collection('users').doc(uid);
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(delta),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    async setBalance(uid, value) {
        if (!uid) throw new Error('UID wajib diisi');
        const userRef = db.collection('users').doc(uid);
        await userRef.update({
            balance: value,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    // ===== TRANSACTION LOG =====
    async logTransaction({ uid, username, type, amount, note, extra }) {
        if (!uid) throw new Error('UID wajib untuk log transaksi');

        // Validasi UID aktif
        const currentUid = auth.currentUser ? auth.currentUser.uid : null;
        if (!currentUid) throw new Error('User tidak login');
        if (currentUid !== uid) {
            throw new Error('UID mismatch pada log transaksi');
        }

        return db.collection('transactions').add({
            uid: uid,
            username: username || 'unknown',
            type,
            amount: Number(amount),
            note: note || '',
            extra: extra || {},
            status: 'success',
            time: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    // ===== HELPERS =====
    formatRp(n) {
        return 'Rp ' + Math.round(n).toLocaleString('id-ID');
    },

    formatNumber(n) {
        return Math.round(n).toLocaleString('id-ID');
    },

    async logout() {
        await auth.signOut();
        // Hapus cache service worker
        if ('caches' in window) {
            const names = await caches.keys();
            await Promise.all(names.map(n => caches.delete(n)));
        }
        window.location.href = 'login.html';
    },

    // ===== SERVICE WORKER =====
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
