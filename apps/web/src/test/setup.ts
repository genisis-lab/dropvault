// Node 25 exposes an incomplete experimental localStorage when no backing
// file is configured. Install a deterministic Storage implementation for unit
// tests so jsdom and local Node versions behave identically.
const values = new Map<string, string>();
const storage: Storage = {
  get length() {
    return values.size;
  },
  clear: () => values.clear(),
  getItem: (key) => values.get(String(key)) ?? null,
  key: (index) => Array.from(values.keys())[index] ?? null,
  removeItem: (key) => {
    values.delete(String(key));
  },
  setItem: (key, value) => {
    values.set(String(key), String(value));
  },
};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

// jsdom 25's Blob/File implementation predates Blob.arrayBuffer(). Browsers
// provide it, so bridge it through FileReader for encryption unit tests.
if (
  !(Blob.prototype as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> })
    .arrayBuffer
) {
  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    configurable: true,
    value(this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    },
  });
}
