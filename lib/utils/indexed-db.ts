/**
 * IndexedDB utility for storing large files temporarily
 * This is used to pass PDF files between pages without hitting sessionStorage quota limits
 */

const DB_NAME = "PdfUploaderDB";
const STORE_NAME = "pendingFiles";
const DB_VERSION = 1;

interface PendingFileData {
  file: File;
  timestamp: number;
}

/**
 * Opens or creates the IndexedDB database
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * Stores a file in IndexedDB
 */
export async function storePendingFile(file: File): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    
    const data: PendingFileData = {
      file,
      timestamp: Date.now(),
    };
    
    const request = store.put(data, "current");

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * Retrieves the pending file from IndexedDB
 */
export async function getPendingFile(): Promise<File | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get("current");

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const data = request.result as PendingFileData | undefined;
      resolve(data?.file || null);
    };
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * Removes the pending file from IndexedDB
 */
export async function clearPendingFile(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete("current");

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    
    transaction.oncomplete = () => db.close();
  });
}

/**
 * Clears old files from IndexedDB (files older than 1 hour)
 * Call this on app initialization to clean up abandoned uploads
 */
export async function clearOldPendingFiles(): Promise<void> {
  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get("current");

    request.onsuccess = () => {
      const data = request.result as PendingFileData | undefined;
      if (data && Date.now() - data.timestamp > 60 * 60 * 1000) {
        // File is older than 1 hour, delete it
        store.delete("current");
      }
    };
    
    transaction.oncomplete = () => db.close();
  } catch (error) {
    // Silently fail - this is just cleanup
    console.error("Failed to clear old pending files:", error);
  }
}

