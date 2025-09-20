import { afterEach, beforeEach, vi } from 'vitest';

const storage = new Map();

const localStorageMock = {
  getItem: vi.fn(key => (storage.has(key) ? storage.get(key) : null)),
  setItem: vi.fn((key, value) => {
    storage.set(key, String(value));
  }),
  removeItem: vi.fn(key => {
    storage.delete(key);
  }),
  clear: vi.fn(() => {
    storage.clear();
  })
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  configurable: true
});

beforeEach(() => {
  storage.clear();
  Object.values(localStorageMock).forEach(method => {
    if (typeof method.mock?.clear === 'function') {
      method.mock.clear();
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
