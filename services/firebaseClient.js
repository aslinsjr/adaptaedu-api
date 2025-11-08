import admin from 'firebase-admin';

export class FirebaseService {
  constructor() {
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
      });
    }

    this.bucket = admin.storage().bucket();
  }

  async getFileUrl(remotePath) {
    const file = this.bucket.file(remotePath);
    const [exists] = await file.exists();
    
    if (!exists) return null;
    
    return `https://storage.googleapis.com/${this.bucket.name}/${remotePath}`;
  }

  async getFileMetadata(remotePath) {
    const file = this.bucket.file(remotePath);
    const [metadata] = await file.getMetadata();
    return metadata;
  }

  async downloadFile(remotePath) {
    const file = this.bucket.file(remotePath);
    const [buffer] = await file.download();
    return buffer;
  }

  getGsUri(remotePath) {
    return `gs://${this.bucket.name}/${remotePath}`;
  }
}
