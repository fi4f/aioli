import { Data } from './data.js';
import { Promises } from './promises.js';

const __instances__ = new WeakSet();
const __promise__ = (work) => Promises.registerPromise(Promise.resolve().then(work));
function __check__(store) {
  if (!__instances__.has(store) || store.__closed__)
    throw new Error('Expected a live storage instance');
}
function __sessionKey__(store, key) {
  __check__(store);
  if (typeof key !== 'string' || !key) throw new TypeError('Session storage key must be a string');
  return `hg-storage:${encodeURIComponent(store.name)}:${encodeURIComponent(key)}`;
}
export const Storage = Data.registerHostData({
  readSession(store, key) {
    return sessionStorage.getItem(__sessionKey__(store, key));
  },
  writeSession(store, key, value) {
    const address = __sessionKey__(store, key);
    if (typeof value !== 'string') throw new TypeError('Session storage value must be a string');
    sessionStorage.setItem(address, value);
  },
  removeSession(store, key) {
    sessionStorage.removeItem(__sessionKey__(store, key));
  },
  new(name) {
    if (typeof name !== 'string' || !name) throw new TypeError('Storage name must be a string');
    const store = Data.registerHostData({
      name,
      version: 0,
      __closed__: false,
      __tail__: Promise.resolve(),
    });
    __instances__.add(store);
    store.ready = __promise__(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open(`hg-storage:${name}`, 1);
          request.onupgradeneeded = () => {
            request.result.createObjectStore('records');
            request.result.createObjectStore('meta');
          };
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('Storage is blocked by another page'));
          request.onsuccess = () => {
            store.__db__ = request.result;
            store.__db__.onversionchange = () => Storage.close(store);
            if (store.__closed__) {
              store.__db__.close();
              reject(new Error('Storage is closed'));
              return;
            }
            resolve(store);
          };
        }),
    );
    return store;
  },
  records(store) {
    return __promise__(async () => {
      __check__(store);
      await store.ready;
      await store.__tail__.catch(() => {});
      return new Promise((resolve, reject) => {
        const tx = store.__db__.transaction(['records', 'meta']);
        const records = tx.objectStore('records');
        const keys = records.getAllKeys(),
          values = records.getAll(),
          version = tx.objectStore('meta').get('version');
        tx.oncomplete = () => {
          store.version = version.result ?? 0;
          resolve(Object.fromEntries(keys.result.map((key, i) => [key, values.result[i]])));
        };
        tx.onabort = () => reject(tx.error || new Error('Unable to read storage'));
      });
    });
  },
  commit(store, expectedVersion, operations) {
    return __promise__(async () => {
      __check__(store);
      await store.ready;
      const pending = store.__tail__
        .catch(() => {})
        .then(
          () =>
            new Promise((resolve, reject) => {
              __check__(store);
              const tx = store.__db__.transaction(['records', 'meta'], 'readwrite');
              const meta = tx.objectStore('meta'),
                records = tx.objectStore('records');
              const read = meta.get('version');
              let failure, next;
              read.onsuccess = () => {
                try {
                  if (
                    !Number.isSafeInteger(expectedVersion) ||
                    expectedVersion !== (read.result ?? 0)
                  )
                    throw new Error(
                      'Stored project changed in another page; refresh before saving',
                    );
                  for (const operation of operations) {
                    if (typeof operation.key !== 'string')
                      throw new TypeError('Storage keys must be strings');
                    if (operation.kind === 'put') records.put(operation.value, operation.key);
                    else if (operation.kind === 'remove') records.delete(operation.key);
                    else throw new TypeError('Unknown storage operation');
                  }
                  next = expectedVersion + 1;
                  meta.put(next, 'version');
                } catch (error) {
                  failure = error;
                  tx.abort();
                }
              };
              tx.oncomplete = () => {
                store.version = next;
                resolve(next);
              };
              tx.onabort = () =>
                reject(failure || tx.error || new Error('Storage transaction aborted'));
            }),
        );
      store.__tail__ = pending;
      return pending;
    });
  },
  close(store) {
    if (!__instances__.has(store) || store.__closed__) return;
    store.__closed__ = true;
    store.__db__?.close();
  },
});
