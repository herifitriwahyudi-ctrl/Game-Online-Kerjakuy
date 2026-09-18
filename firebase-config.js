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

// Persistensi offline — penting supaya session tetap ada saat pindah halaman
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

    // ⚠️ FUNGSI BARU: Tunggu sampai Firebase Auth selesai load session
    // Ini penting supaya tidak fire redirect ke login padahal user sudah login
    waitForAuth() {
        return new Promise((resolve) => {
            // Kalau Firebase sudah selesai load state, currentUser bisa null atau user
            // Kita pakai trick: cek apakah auth._isInitialized (internal Firebase)
            if (auth.currentUser !== undefined && auth.currentUser !== null) {
                console.log('✅ waitForAuth: user sudah ada di memory');
                resolve(auth.currentUser);
                return;
            }

            // Kalau belum, tunggu event pertama
            let resolved = false;
            const unsub = auth.onAuthStateChanged((user) => {
                if (resolved) return;
                resolved = true;
                unsub();
                console.log('✅ waitForAuth: resolved dengan', user ? user.uid : 'null');
                resolve(user);
            });

            // Fallback timeout 5 detik — kalau Firebase hang
            setTimeout(() => {
                if (resolved) return;
                resolved = true;
                unsub();
                console.warn('⚠️ waitForAuth: timeout, resolve dengan currentUser');
                resolve(auth.currentUser);
            }, 5000);
        });
    },

    // ⚠️ requireAuth diperbaiki — pakai waitForAuth
    async requireAuth(redirectTo) {
        const user = await this.waitForAuth();
        if (!user) {
            const next = redirectTo || (window.location.pathname.split('/').pop() + window.location.search);
            console.log('❌ Not authenticated, redirect to login. Next:', next);
            window.location.href = 'login.html?next=' + encodeURIComponent(next);
            return null;
        }
        return user;
    },

    async getUserData(uid) {
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

    async logTransaction({ uid, username, type, amount, note, extra }) {
        if (!uid) throw new Error('UID wajib untuk log transaksi');

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

    formatRp(n) {
        return 'Rp ' + Math.round(n).toLocaleString('id-ID');
    },

    formatNumber(n) {
        return Math.round(n).toLocaleString('id-ID');
    },

    async logout() {
        await auth.signOut();
        if ('caches' in window) {
            const names = await caches.keys();
            await Promise.all(names.map(n => caches.delete(n)));
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
