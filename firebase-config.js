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

db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    console.warn('Persistence error:', err.code);
});

window.FB = {
    auth,
    db,

    requireAuth(redirectTo) {
        return new Promise((resolve) => {
            auth.onAuthStateChanged((user) => {
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

    async getUserData(uid) {
        try {
            const doc = await db.collection('users').doc(uid).get();
            return doc.exists ? doc.data() : null;
        } catch (e) {
            console.error('getUserData error:', e);
            return null;
        }
    },

    async updateBalance(uid, delta) {
        const userRef = db.collection('users').doc(uid);
        await userRef.update({
            balance: firebase.firestore.FieldValue.increment(delta),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    async setBalance(uid, value) {
        const userRef = db.collection('users').doc(uid);
        await userRef.update({
            balance: value,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    async logTransaction({ uid, username, type, amount, note, extra }) {
        return db.collection('transactions').add({
            uid: uid || null,
            username: username || 'guest',
            type,
            amount,
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
        window.location.href = 'login.html';
    }
};

console.log('🔥 Firebase initialized');
