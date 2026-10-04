import { MAX_RECORDS, MAX_TOTAL } from "./core.js";
let database;
export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("law-ai-literature-library-v1", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("papers", { keyPath: "id" });
      db.createObjectStore("originals", { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        new Error(
          "Storage upgrade blocked. Close other library tabs and reload.",
        ),
      );
    request.onsuccess = () => {
      database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}
function transaction(stores, mode, work) {
  if (!database) return Promise.reject(new Error("Local storage unavailable"));
  return new Promise((resolve, reject) => {
    const tx = database.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () =>
      reject(tx.error || new Error("Storage transaction failed"));
    tx.onabort = () =>
      reject(tx.error || new Error("Storage transaction aborted"));
    try {
      work(tx, (value) => {
        result = value;
      });
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}
export const listPapers = () =>
  transaction(["papers"], "readonly", (tx, done) => {
    const req = tx.objectStore("papers").getAll();
    req.onsuccess = () => done(req.result);
  });
export const getOriginal = (id) =>
  transaction(["originals"], "readonly", (tx, done) => {
    const req = tx.objectStore("originals").get(id);
    req.onsuccess = () => done(req.result?.blob || null);
  });
export function saveRecords(papers, originals = new Map()) {
  return transaction(["papers", "originals"], "readwrite", (tx) => {
    // Check capacity inside the same read/write transaction so another tab cannot race the limits.
    const paperStore = tx.objectStore("papers");
    const req = paperStore.getAll();
    req.onsuccess = () => {
      const combined = new Map(req.result.map((p) => [p.id, p]));
      for (const p of papers) combined.set(p.id, p);
      if (
        combined.size > MAX_RECORDS ||
        [...combined.values()].reduce((sum, p) => sum + (p.size || 0), 0) >
          MAX_TOTAL
      ) {
        tx.abort();
        return;
      }
      for (const paper of papers) paperStore.put(paper);
      for (const [id, blob] of originals)
        tx.objectStore("originals").put({ id, blob });
    };
  });
}
export const removePaper = (id) =>
  transaction(["papers", "originals"], "readwrite", (tx) => {
    tx.objectStore("papers").delete(id);
    tx.objectStore("originals").delete(id);
  });
