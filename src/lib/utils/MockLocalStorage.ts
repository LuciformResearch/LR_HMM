/**
 * Mock localStorage pour les tests côté serveur
 * Simule localStorage quand il n'est pas disponible (environnement Node.js)
 */

interface Storage {
  [key: string]: string;
}

class MockLocalStorage {
  private storage: Storage = {};

  getItem(key: string): string | null {
    return this.storage[key] || null;
  }

  setItem(key: string, value: string): void {
    this.storage[key] = value;
  }

  removeItem(key: string): void {
    delete this.storage[key];
  }

  clear(): void {
    this.storage = {};
  }

  get length(): number {
    return Object.keys(this.storage).length;
  }

  key(index: number): string | null {
    const keys = Object.keys(this.storage);
    return keys[index] || null;
  }
}

/**
 * Initialise le mock localStorage si nécessaire
 */
export function initializeMockLocalStorage(): void {
  if (typeof window === 'undefined' && typeof global !== 'undefined') {
    // Environnement Node.js - créer un mock localStorage
    const mockStorage = new MockLocalStorage();
    
    // Ajouter au global pour que les modules puissent l'utiliser
    (global as any).localStorage = mockStorage;
    
    console.log('🔧 Mock localStorage initialisé pour les tests côté serveur');
  }
}

/**
 * Nettoie le mock localStorage
 */
export function clearMockLocalStorage(): void {
  if (typeof global !== 'undefined' && (global as any).localStorage) {
    (global as any).localStorage.clear();
    console.log('🧹 Mock localStorage nettoyé');
  }
}

/**
 * Obtient les statistiques du mock localStorage
 */
export function getMockLocalStorageStats(): {
  keys: string[];
  totalItems: number;
  totalSize: number;
} {
  if (typeof global !== 'undefined' && (global as any).localStorage) {
    const storage = (global as any).localStorage;
    const keys = Object.keys(storage.storage || {});
    const totalSize = keys.reduce((size, key) => {
      const value = storage.getItem(key) || '';
      return size + key.length + value.length;
    }, 0);

    return {
      keys,
      totalItems: keys.length,
      totalSize
    };
  }

  return {
    keys: [],
    totalItems: 0,
    totalSize: 0
  };
}