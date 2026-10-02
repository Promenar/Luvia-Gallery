// Node 25+ 内置实验性 Web Storage：未指定 --localstorage-file 时 globalThis.localStorage 为 undefined，
// 并会遮蔽 jsdom 提供的实现。测试进程中缺失时补一个内存版 Storage，保证与浏览器语义一致。
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.has(String(key)) ? this.store.get(String(key))! : null;
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(String(key));
  }

  setItem(key: string, value: string) {
    this.store.set(String(key), String(value));
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  let current: Storage | undefined;
  try {
    current = globalThis[name];
  } catch {
    current = undefined;
  }
  if (!current) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: new MemoryStorage() });
  }
}
