const admin = require('firebase-admin');
const path = require('path');

// Try to load the service account key
// NOTE: You MUST download this from Firebase Console and place it in E:\Raagam-be\serviceAccountKey.json
const serviceAccountPath = path.join(__dirname, '../../serviceAccountKey.json');

try {
    let serviceAccount;
    if (process.env.FIREBASE_PRIVATE_KEY_BASE6 || process.env.FIREBASE_PRIVATE_KEY_BASE64) {
        serviceAccount = {
            projectId: "raagam-msc",
            clientEmail: "firebase-adminsdk-fbsvc@raagam-msc.iam.gserviceaccount.com",
            privateKey: Buffer.from((process.env.FIREBASE_PRIVATE_KEY_BASE6 || process.env.FIREBASE_PRIVATE_KEY_BASE64), 'base64').toString('utf8')
        };
    } else {
        serviceAccount = require(serviceAccountPath);
    }
    
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin initialized successfully.");
} catch (err) {
    console.error("Firebase Admin initialization FAILED. Please ensure 'serviceAccountKey.json' exists or FIREBASE_CREDENTIALS is set.", err.message);
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { db, auth };
