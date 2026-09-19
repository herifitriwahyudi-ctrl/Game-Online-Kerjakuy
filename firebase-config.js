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

// ===== ATURAN BISNIS (satu sumber, dipakai semua halaman) =====
const LIMITS = {
    MIN_TOPUP: 1000,
    MAX_TOPUP: 50000000,
    MIN_WITHDRAW: 10000,
    FEE_LOW: 1500,        // tarik < 50.000
    FEE_HIGH: 2500,       // tarik >= 50.000
    FEE_THRESHOLD: 50000
};

function currentUidOrThrow(uid) {
    const cur = auth.currentUser ? auth.currentUser.uid : null;
    if (!cur) throw new Error('User tidak login');
    if (uid && cur !== uid) throw new Error('UID mismatch: tidak boleh mengubah data user lain');
    return cur;
}

window.FB = {
    auth,
    db,
    LIMITS,

    // Tunggu Firebase Auth selesai memuat session (hindari redirect ke login padahal sudah login)
    waitForAuth() {
        return new Promise((resolve) => {
            if (auth.currentUser) {
                resolve(auth.currentUser);
                return;
            }

            let resolved = false;
            const unsub = auth.onAuthStateChanged((user) => {
                if (resolved) return;
                resolved = true;
                unsub();
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

    async requireAuth(redirectTo) {
        const user = await this.waitForAuth();
        if (!user) {
            const next = redirectTo || (window.location.pathname.split('/').pop() + window.location.search);
            window.location.href = 'login.html?next=' + encodeURIComponent(next);
            return null;
        }
        return user;
    },

    // Cegah open-redirect: hanya izinkan nama file .html relatif di folder yang sama
    safeNext(next, fallback = 'index.html') {
        if (typeof next !== 'string') return fallback;
        return /^[A-Za-z0-9_\-]+\.html(\?[A-Za-z0-9_\-=&%.]*)?$/.test(next) ? next : fallback;
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

    // Dipakai game (index.html): tambah/kurangi saldo milik user yang sedang login
    async updateBalance(uid, delta) {
        if (!uid) throw new Error('UID wajib diisi');
        if (typeof delta !== 'number' || isNaN(delta)) throw new Error('Delta tidak valid');
        currentUidOrThrow(uid);

        await db.collection('users').doc(uid).update({
            balance: firebase.firestore.FieldValue.increment(delta),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    // Sebelumnya TANPA cek login/UID — sekarang sama ketatnya dengan updateBalance
    async setBalance(uid, value) {
        if (!uid) throw new Error('UID wajib diisi');
        if (typeof value !== 'number' || isNaN(value) || value < 0) throw new Error('Nilai saldo tidak valid');
        currentUidOrThrow(uid);

        await db.collection('users').doc(uid).update({
            balance: value,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    // Dipakai game (index.html) untuk mencatat transaksi yang sudah selesai
    async logTransaction({ uid, username, type, amount, note, extra, status }) {
        if (!uid) throw new Error('UID wajib untuk log transaksi');
        currentUidOrThrow(uid);

        return db.collection('transactions').add({
            uid: uid,
            username: username || 'unknown',
            type,
            amount: Number(amount),
            note: note || '',
            extra: extra || {},
            status: status || 'success',
            time: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    calcWithdrawFee(amount) {
        if (!(amount > 0)) return 0;
        return amount >= LIMITS.FEE_THRESHOLD ? LIMITS.FEE_HIGH : LIMITS.FEE_LOW;
    },

    // ===== TOP UP: satu-satunya pintu masuk (dipakai pembayaran.html & qris.html) =====
    // orderId opsional → idempotent: kirim ulang order yang sama ditolak (tidak dobel).
    // Dokumen topups & transactions dibuat ATOMIK dan saling terhubung lewat txId.
    async requestTopup({ amount, method, orderId }) {
        const uid = currentUidOrThrow();
        amount = Math.floor(Number(amount));
        if (!Number.isFinite(amount) || amount < LIMITS.MIN_TOPUP) {
            throw new Error('Minimal top up ' + FB.formatRp(LIMITS.MIN_TOPUP));
        }
        if (amount > LIMITS.MAX_TOPUP) {
            throw new Error('Maksimal top up ' + FB.formatRp(LIMITS.MAX_TOPUP));
        }

        const userData = await FB.getUserData(uid);
        if (!userData) throw new Error('Data user tidak ditemukan');

        const topupRef = orderId ? db.collection('topups').doc(orderId) : db.collection('topups').doc();
        const txRef = db.collection('transactions').doc();
        const ts = firebase.firestore.FieldValue.serverTimestamp();

        await db.runTransaction(async (tx) => {
            if (orderId) {
                const existing = await tx.get(topupRef);
                if (existing.exists) {
                    const err = new Error('Pesanan ini sudah pernah dikirim.');
                    err.code = 'order-exists';
                    throw err;
                }
            }
            tx.set(topupRef, {
                uid,
                username: userData.username,
                amount,
                total: amount,
                method,
                status: 'pending',
                txId: txRef.id,
                time: ts
            });
            tx.set(txRef, {
                uid,
                username: userData.username,
                type: 'topup',
                amount,
                note: `Top up via ${method} (menunggu approve admin)`,
                extra: { method, refId: topupRef.id },
                status: 'pending',
                time: ts
            });
        });

        return topupRef.id;
    },

    // ===== WITHDRAW: potong saldo + catat permintaan + catat transaksi dalam SATU transaksi =====
    // (sebelumnya 3 langkah terpisah: saldo terpotong tapi permintaan bisa gagal tercatat,
    //  dan pengecekan saldo bisa "balapan" sehingga saldo jadi minus)
    async requestWithdraw({ amount, method, account }) {
        const uid = currentUidOrThrow();
        amount = Math.floor(Number(amount));
        if (!Number.isFinite(amount) || amount < LIMITS.MIN_WITHDRAW) {
            throw new Error('Minimal tarik ' + FB.formatRp(LIMITS.MIN_WITHDRAW));
        }
        if (!account) throw new Error('Nomor rekening / e-wallet wajib diisi');

        const fee = FB.calcWithdrawFee(amount);
        const total = amount - fee;

        const userRef = db.collection('users').doc(uid);
        const wdRef = db.collection('withdrawals').doc();
        const txRef = db.collection('transactions').doc();
        const ts = firebase.firestore.FieldValue.serverTimestamp();

        await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) throw new Error('Data user tidak ditemukan');
            const user = snap.data();
            const balance = Number(user.balance) || 0;
            if (amount > balance) throw new Error('Saldo tidak cukup!');

            tx.update(userRef, { balance: balance - amount, updatedAt: ts });
            tx.set(wdRef, {
                uid,
                username: user.username,
                amount,
                fee,
                total,
                method,
                account,
                status: 'pending',
                txId: txRef.id,
                time: ts
            });
            tx.set(txRef, {
                uid,
                username: user.username,
                type: 'withdraw',
                amount: -amount,
                note: `Tarik via ${method} (menunggu proses admin)`,
                extra: { method, account, fee, total, refId: wdRef.id },
                status: 'pending',
                time: ts
            });
        });

        return { id: wdRef.id, fee, total };
    },

    formatRp(n) {
        return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
    },

    formatNumber(n) {
        return Math.round(Number(n) || 0).toLocaleString('id-ID');
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

