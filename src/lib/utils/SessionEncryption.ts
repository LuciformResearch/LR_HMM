/**
 * SessionEncryption - Gestionnaire de chiffrement pour les clés API dans la session
 * Permet de stocker de manière sécurisée les clés API dans la session du navigateur
 */

import CryptoJS from 'crypto-js';

export interface EncryptedApiKeys {
  [provider: string]: string; // Clé chiffrée
}

export interface ApiKeyConfig {
  openrouter: string;
  gemini: string;
  openai: string;
  anthropic: string;
  supabase: string;
  supabaseUrl: string;
}

/**
 * Générateur de clé de chiffrement basé sur des données du navigateur
 * Utilise une combinaison d'informations du navigateur pour créer une clé unique
 */
class SessionKeyGenerator {
  private static instance: SessionKeyGenerator;
  private sessionKey: string | null = null;

  private constructor() {}

  public static getInstance(): SessionKeyGenerator {
    if (!SessionKeyGenerator.instance) {
      SessionKeyGenerator.instance = new SessionKeyGenerator();
    }
    return SessionKeyGenerator.instance;
  }

  /**
   * Génère une clé de chiffrement basée sur les données du navigateur
   */
  public generateSessionKey(): string {
    if (this.sessionKey) {
      return this.sessionKey;
    }

    try {
      // Collecter des données du navigateur pour créer une clé unique
      const browserData = {
        userAgent: navigator.userAgent || 'unknown',
        language: navigator.language || 'en',
        platform: navigator.platform || 'unknown',
        screen: `${screen.width || 1920}x${screen.height || 1080}`,
        timezone: Intl?.DateTimeFormat?.()?.resolvedOptions?.()?.timeZone || 'UTC',
        // Utiliser une date fixe pour la session (pas timestamp)
        sessionDate: new Date().toDateString()
      };

      // Créer une clé de base stable
      const baseKey = Object.values(browserData).join('|');
      
      // Ajouter une graine fixe basée sur l'URL et la date
      const fixedSeed = window.location.hostname + new Date().toDateString();
      
      // Hasher le tout pour créer une clé de chiffrement stable
      this.sessionKey = CryptoJS.SHA256(baseKey + fixedSeed).toString();
      
      // Vérifier que la clé est valide
      if (!this.sessionKey || this.sessionKey.length < 32) {
        throw new Error('Clé de session générée invalide');
      }
      
      return this.sessionKey;
    } catch (error) {
      console.error('Erreur lors de la génération de la clé de session:', error);
      // Fallback avec une clé fixe (moins sécurisé mais fonctionnel)
      this.sessionKey = CryptoJS.SHA256('fallback-session-key-' + Date.now()).toString();
      return this.sessionKey;
    }
  }

  /**
   * Réinitialise la clé de session (utile pour les tests)
   */
  public resetSessionKey(): void {
    this.sessionKey = null;
  }
}

/**
 * Gestionnaire de chiffrement des clés API pour la session
 */
export class SessionApiKeyManager {
  private keyGenerator: SessionKeyGenerator;
  private readonly STORAGE_KEY = 'lr_tchatagent_encrypted_api_keys';
  private readonly SESSION_KEY = 'lr_tchatagent_session_key';

  constructor() {
    this.keyGenerator = SessionKeyGenerator.getInstance();
  }

  /**
   * Chiffre une clé API
   */
  private encryptApiKey(apiKey: string): string {
    if (!apiKey) return '';
    
    const sessionKey = this.keyGenerator.generateSessionKey();
    return CryptoJS.AES.encrypt(apiKey, sessionKey).toString();
  }

  /**
   * Déchiffre une clé API
   */
  private decryptApiKey(encryptedKey: string): string {
    if (!encryptedKey) return '';
    
    try {
      const sessionKey = this.keyGenerator.generateSessionKey();
      
      // Vérifier que la clé de session est valide
      if (!sessionKey || sessionKey.length < 32) {
        console.error('Clé de session invalide');
        return '';
      }
      
      // Vérifier que les données chiffrées sont valides
      if (!encryptedKey || encryptedKey.length < 10) {
        console.error('Données chiffrées invalides');
        return '';
      }
      
      const bytes = CryptoJS.AES.decrypt(encryptedKey, sessionKey);
      
      // Vérifier que le déchiffrement a réussi
      if (!bytes || bytes.sigBytes <= 0) {
        console.error('Échec du déchiffrement - données corrompues ou clé incorrecte');
        return '';
      }
      
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      
      // Vérifier que le résultat n'est pas vide
      if (!decrypted || decrypted.trim().length === 0) {
        console.error('Résultat du déchiffrement vide');
        return '';
      }
      
      return decrypted;
    } catch (error) {
      console.error('Erreur lors du déchiffrement de la clé API:', error);
      return '';
    }
  }

  /**
   * Sauvegarde les clés API chiffrées dans la session
   */
  public saveApiKeys(apiKeys: Partial<ApiKeyConfig>): boolean {
    try {
      const encryptedKeys: EncryptedApiKeys = {};
      
      // Chiffrer chaque clé API
      Object.entries(apiKeys).forEach(([provider, key]) => {
        if (key && key.trim()) {
          encryptedKeys[provider] = this.encryptApiKey(key);
        }
      });

      // Sauvegarder dans sessionStorage (plus sécurisé que localStorage)
      sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(encryptedKeys));
      
      // En mode développement, sauvegarder aussi dans localStorage pour persistance
      if (process.env.NODE_ENV === 'development') {
        try {
          const { devPersistence } = require('@/lib/dev/DevPersistence');
          devPersistence.autoSaveApiKeys(apiKeys);
        } catch (error) {
          // Ignore si le module dev n'est pas disponible
        }
      }
      
      return true;
    } catch (error) {
      console.error('Erreur lors de la sauvegarde des clés API:', error);
      return false;
    }
  }

  /**
   * Charge les clés API déchiffrées depuis la session
   */
  public loadApiKeys(): Partial<ApiKeyConfig> {
    try {
      const encryptedData = sessionStorage.getItem(this.STORAGE_KEY);
      if (!encryptedData) {
        // En mode développement, essayer de restaurer depuis localStorage
        if (process.env.NODE_ENV === 'development') {
          try {
            const { devPersistence } = require('@/lib/dev/DevPersistence');
            const restoredKeys = devPersistence.getRestoredApiKeys();
            if (Object.keys(restoredKeys).length > 0) {
              console.log('🔄 Clés API restaurées depuis la persistance de dev');
              return restoredKeys;
            }
          } catch (error) {
            // Ignore si le module dev n'est pas disponible
          }
        }
        return {};
      }

      const encryptedKeys: EncryptedApiKeys = JSON.parse(encryptedData);
      const decryptedKeys: Partial<ApiKeyConfig> = {};
      let corruptedKeys = 0;

      // Déchiffrer chaque clé API
      Object.entries(encryptedKeys).forEach(([provider, encryptedKey]) => {
        try {
          const decryptedKey = this.decryptApiKey(encryptedKey);
          if (decryptedKey) {
            decryptedKeys[provider as keyof ApiKeyConfig] = decryptedKey;
          } else {
            corruptedKeys++;
            console.warn(`Clé ${provider} corrompue ou impossible à déchiffrer`);
          }
        } catch (error) {
          corruptedKeys++;
          console.error(`Erreur lors du déchiffrement de ${provider}:`, error);
        }
      });

      // Si plus de la moitié des clés sont corrompues, nettoyer tout
      if (corruptedKeys > Object.keys(encryptedKeys).length / 2) {
        console.warn('Trop de clés corrompues, nettoyage du système...');
        this.resetCorruptedData();
        return {};
      }

      return decryptedKeys;
    } catch (error) {
      console.error('Erreur lors du chargement des clés API:', error);
      // En cas d'erreur majeure, nettoyer les données
      this.resetCorruptedData();
      return {};
    }
  }

  /**
   * Vérifie si une clé API est présente (sans la révéler)
   */
  public hasApiKey(provider: keyof ApiKeyConfig): boolean {
    const apiKeys = this.loadApiKeys();
    return !!(apiKeys[provider] && apiKeys[provider]!.trim());
  }

  /**
   * Obtient une clé API déchiffrée
   */
  public getApiKey(provider: keyof ApiKeyConfig): string {
    const apiKeys = this.loadApiKeys();
    return apiKeys[provider] || '';
  }

  /**
   * Supprime toutes les clés API de la session
   */
  public clearApiKeys(): boolean {
    try {
      sessionStorage.removeItem(this.STORAGE_KEY);
      return true;
    } catch (error) {
      console.error('Erreur lors de la suppression des clés API:', error);
      return false;
    }
  }

  /**
   * Nettoie les données corrompues et réinitialise le système
   */
  public resetCorruptedData(): boolean {
    try {
      console.log('🧹 Nettoyage des données corrompues...');
      
      // Supprimer toutes les données de session
      sessionStorage.removeItem(this.STORAGE_KEY);
      
      // Réinitialiser la clé de session
      this.keyGenerator.resetSessionKey();
      
      console.log('✅ Données corrompues nettoyées');
      return true;
    } catch (error) {
      console.error('❌ Erreur lors du nettoyage:', error);
      return false;
    }
  }

  /**
   * Obtient un aperçu masqué d'une clé API
   */
  public getApiKeyPreview(provider: keyof ApiKeyConfig): string {
    const key = this.getApiKey(provider);
    if (!key) return 'absent';
    
    if (key.length < 10) return 'set';
    
    return `${key.slice(0, 4)}...${key.slice(-3)}`;
  }

  /**
   * Obtient le statut de toutes les clés API
   */
  public getApiKeysStatus(): Record<keyof ApiKeyConfig, { present: boolean; preview: string }> {
    const providers: (keyof ApiKeyConfig)[] = ['openrouter', 'gemini', 'openai', 'anthropic', 'supabase'];
    const status: Record<keyof ApiKeyConfig, { present: boolean; preview: string }> = {} as any;

    providers.forEach(provider => {
      const present = this.hasApiKey(provider);
      const preview = present ? this.getApiKeyPreview(provider) : 'absent';
      status[provider] = { present, preview };
    });

    return status;
  }

  /**
   * Teste la validité d'une clé API (format basique)
   */
  public validateApiKey(provider: keyof ApiKeyConfig, key: string): { valid: boolean; message: string } {
    if (!key || !key.trim()) {
      return { valid: false, message: 'Clé API vide' };
    }

    // Validation basique selon le provider
    switch (provider) {
      case 'openrouter':
        if (!key.startsWith('sk-or-')) {
          return { valid: false, message: 'Clé OpenRouter doit commencer par "sk-or-"' };
        }
        break;
      case 'openai':
        if (!key.startsWith('sk-')) {
          return { valid: false, message: 'Clé OpenAI doit commencer par "sk-"' };
        }
        break;
      case 'anthropic':
        if (!key.startsWith('sk-ant-')) {
          return { valid: false, message: 'Clé Anthropic doit commencer par "sk-ant-"' };
        }
        break;
      case 'gemini':
        if (key.length < 20) {
          return { valid: false, message: 'Clé Gemini semble trop courte' };
        }
        break;
      case 'supabase':
        if (!key.startsWith('eyJ') && !key.startsWith('sb-')) {
          return { valid: false, message: 'Clé Supabase doit être un JWT ou commencer par "sb-"' };
        }
        break;
      case 'supabaseUrl':
        if (!key.startsWith('https://') || !key.includes('.supabase.co')) {
          return { valid: false, message: 'URL Supabase doit commencer par "https://" et contenir ".supabase.co"' };
        }
        break;
    }

    return { valid: true, message: 'Clé API valide' };
  }
}

/**
 * Instance singleton du gestionnaire de clés API
 */
export const sessionApiKeyManager = new SessionApiKeyManager();

/**
 * Fonctions de commodité pour l'utilisation simple
 */
export const sessionApiKeys = {
  /**
   * Sauvegarde une clé API
   */
  save: (provider: keyof ApiKeyConfig, key: string): boolean => {
    const currentKeys = sessionApiKeyManager.loadApiKeys();
    return sessionApiKeyManager.saveApiKeys({
      ...currentKeys,
      [provider]: key
    });
  },

  /**
   * Charge une clé API
   */
  load: (provider: keyof ApiKeyConfig): string => {
    return sessionApiKeyManager.getApiKey(provider);
  },

  /**
   * Vérifie la présence d'une clé API
   */
  has: (provider: keyof ApiKeyConfig): boolean => {
    return sessionApiKeyManager.hasApiKey(provider);
  },

  /**
   * Supprime une clé API
   */
  remove: (provider: keyof ApiKeyConfig): boolean => {
    const currentKeys = sessionApiKeyManager.loadApiKeys();
    delete currentKeys[provider];
    return sessionApiKeyManager.saveApiKeys(currentKeys);
  },

  /**
   * Obtient le statut de toutes les clés
   */
  status: () => {
    return sessionApiKeyManager.getApiKeysStatus();
  },

  /**
   * Supprime toutes les clés
   */
  clear: () => {
    return sessionApiKeyManager.clearApiKeys();
  },

  /**
   * Nettoie les données corrompues
   */
  reset: () => {
    return sessionApiKeyManager.resetCorruptedData();
  },

  /**
   * Charge toutes les clés API
   */
  loadApiKeys: () => {
    return sessionApiKeyManager.loadApiKeys();
  }
};

/**
 * Test de la fonctionnalité de chiffrement
 */
export function testSessionEncryption(): void {
  console.log('🧪 Test SessionEncryption');
  
  // Test de sauvegarde et chargement
  const testKeys: Partial<ApiKeyConfig> = {
    openrouter: 'sk-REDACTED',
    gemini: 'SyTestKey123456789',
    supabase: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'
  };

  // Sauvegarder
  const saved = sessionApiKeyManager.saveApiKeys(testKeys);
  console.log(`✅ Sauvegarde: ${saved ? 'SUCCESS' : 'FAILED'}`);

  // Charger
  const loaded = sessionApiKeyManager.loadApiKeys();
  console.log(`✅ Chargement: ${Object.keys(loaded).length} clés chargées`);

  // Vérifier le statut
  const status = sessionApiKeyManager.getApiKeysStatus();
  console.log('📊 Statut des clés:');
  Object.entries(status).forEach(([provider, info]) => {
    console.log(`  ${provider}: ${info.present ? '✅' : '❌'} ${info.preview}`);
  });

  // Test de validation
  const validation = sessionApiKeyManager.validateApiKey('openrouter', 'sk-REDACTED');
  console.log(`✅ Validation OpenRouter: ${validation.valid ? 'SUCCESS' : 'FAILED'} - ${validation.message}`);

  // Nettoyer
  sessionApiKeyManager.clearApiKeys();
  console.log('🧹 Test terminé, clés supprimées');
}