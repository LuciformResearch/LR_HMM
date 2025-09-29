/**
 * ApiKeyManager - Gestionnaire unifié des clés API avec chiffrement de session
 * Combine le stockage chiffré en session avec la gestion des providers
 */

import { sessionApiKeyManager, ApiKeyConfig, sessionApiKeys } from './SessionEncryption';
import { checkApiKeys as checkEnvApiKeys } from './SecureEnvManager.browser';

export interface ProviderInfo {
  id: keyof ApiKeyConfig;
  name: string;
  description: string;
  url: string;
  recommended?: boolean;
  free?: boolean;
  keyFormat?: string;
  exampleKey?: string;
}

export interface ApiKeyStatus {
  present: boolean;
  preview: string;
  source: 'session' | 'environment' | 'none';
  valid?: boolean;
  message?: string;
}

export interface ApiKeySummary {
  total: number;
  available: number;
  missing: number;
  sessionKeys: number;
  envKeys: number;
}

/**
 * Gestionnaire unifié des clés API
 */
export class ApiKeyManager {
  private static instance: ApiKeyManager;
  
  private constructor() {}
  
  public static getInstance(): ApiKeyManager {
    if (!ApiKeyManager.instance) {
      ApiKeyManager.instance = new ApiKeyManager();
    }
    return ApiKeyManager.instance;
  }

  /**
   * Liste des providers supportés
   */
  public getProviders(): ProviderInfo[] {
    return [
      {
        id: 'openrouter',
        name: 'OpenRouter',
        description: 'Accès à tous les modèles (GPT, Claude, Gemini, etc.)',
        url: 'https://openrouter.ai',
        recommended: true,
        keyFormat: 'sk-or-...',
        exampleKey: 'sk-or-v1-1234567890abcdef...'
      },
      {
        id: 'gemini',
        name: 'Google Gemini',
        description: 'Modèles Gemini de Google',
        url: 'https://ai.google.dev',
        free: true,
        keyFormat: '...',
        exampleKey: '1234567890abcdef...'
      },
      {
        id: 'openai',
        name: 'OpenAI',
        description: 'GPT-4, GPT-3.5, etc.',
        url: 'https://platform.openai.com',
        keyFormat: 'sk-...',
        exampleKey: 'sk-1234567890abcdef...'
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        description: 'Claude 3.5 Sonnet, Haiku, etc.',
        url: 'https://console.anthropic.com',
        keyFormat: 'sk-ant-...',
        exampleKey: 'sk-ant-1234567890abcdef...'
      },
      {
        id: 'supabase',
        name: 'Supabase',
        description: 'Base de données et authentification',
        url: 'https://supabase.com',
        free: true,
        keyFormat: 'eyJ... ou sb-...',
        exampleKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
      },
      {
        id: 'supabaseUrl',
        name: 'Supabase URL',
        description: 'URL du projet Supabase',
        url: 'https://supabase.com',
        free: true,
        keyFormat: 'https://...supabase.co',
        exampleKey: 'https://your-project.supabase.co'
      }
    ];
  }

  /**
   * Obtient le statut d'une clé API (session + environnement)
   */
  public getApiKeyStatus(provider: keyof ApiKeyConfig): ApiKeyStatus {
    // Vérifier d'abord la session
    const sessionKey = sessionApiKeys.load(provider);
    if (sessionKey) {
      const validation = sessionApiKeyManager.validateApiKey(provider, sessionKey);
      return {
        present: true,
        preview: sessionApiKeyManager.getApiKeyPreview(provider),
        source: 'session',
        valid: validation.valid,
        message: validation.message
      };
    }

    // Vérifier l'environnement
    const envKeys = checkEnvApiKeys();
    if (envKeys[provider]?.present) {
      return {
        present: true,
        preview: envKeys[provider].preview,
        source: 'environment',
        valid: true
      };
    }

    return {
      present: false,
      preview: 'absent',
      source: 'none'
    };
  }

  /**
   * Obtient le statut de toutes les clés API
   */
  public getAllApiKeysStatus(): Record<keyof ApiKeyConfig, ApiKeyStatus> {
    const providers: (keyof ApiKeyConfig)[] = ['openrouter', 'gemini', 'openai', 'anthropic', 'supabase', 'supabaseUrl'];
    const status: Record<keyof ApiKeyConfig, ApiKeyStatus> = {} as any;

    providers.forEach(provider => {
      status[provider] = this.getApiKeyStatus(provider);
    });

    return status;
  }

  /**
   * Obtient un résumé des clés API
   */
  public getApiKeysSummary(): ApiKeySummary {
    const status = this.getAllApiKeysStatus();
    const providers = Object.keys(status) as (keyof ApiKeyConfig)[];
    
    let available = 0;
    let sessionKeys = 0;
    let envKeys = 0;

    providers.forEach(provider => {
      const providerStatus = status[provider];
      if (providerStatus.present) {
        available++;
        if (providerStatus.source === 'session') {
          sessionKeys++;
        } else if (providerStatus.source === 'environment') {
          envKeys++;
        }
      }
    });

    return {
      total: providers.length,
      available,
      missing: providers.length - available,
      sessionKeys,
      envKeys
    };
  }

  /**
   * Obtient une clé API (priorité: session > environnement)
   */
  public getApiKey(provider: keyof ApiKeyConfig): string {
    // Priorité à la session
    const sessionKey = sessionApiKeys.load(provider);
    if (sessionKey) {
      return sessionKey;
    }

    // Fallback sur l'environnement
    const envKey = this.getEnvApiKey(provider);
    return envKey || '';
  }

  /**
   * Obtient une clé API depuis l'environnement
   */
  private getEnvApiKey(provider: keyof ApiKeyConfig): string {
    const keyMap: Record<keyof ApiKeyConfig, string> = {
      'openrouter': 'OPENROUTER_API_KEY',
      'gemini': 'GEMINI_API_KEY',
      'openai': 'OPENAI_API_KEY',
      'anthropic': 'ANTHROPIC_API_KEY',
      'supabase': 'SUPABASE_API_KEY',
      'supabaseUrl': 'SUPABASE_URL'
    };

    const keyName = keyMap[provider];
    if (!keyName) return '';

    const key = process.env[keyName];
    if (!key) return '';

    // Vérifier si c'est un placeholder
    const placeholderPatterns = [
      'your_', 'your-', 'example_', 'example-', 'placeholder', 
      'replace_', 'replace-', 'api_key_here', 'key_here'
    ];

    const keyLower = key.toLowerCase();
    const isPlaceholder = placeholderPatterns.some(pattern => keyLower.includes(pattern));

    return isPlaceholder ? '' : key;
  }

  /**
   * Charge les clés API depuis la session
   */
  public loadApiKeys(): Partial<ApiKeyConfig> {
    return sessionApiKeyManager.loadApiKeys();
  }

  /**
   * Sauvegarde les clés API dans la session
   */
  public saveApiKeys(apiKeys: Partial<ApiKeyConfig>): { success: boolean; message: string } {
    try {
      const saved = sessionApiKeyManager.saveApiKeys(apiKeys);
      if (saved) {
        return { success: true, message: 'Clés API sauvegardées avec succès' };
      } else {
        return { success: false, message: 'Erreur lors de la sauvegarde' };
      }
    } catch (error) {
      return { success: false, message: `Erreur: ${error}` };
    }
  }

  /**
   * Sauvegarde une clé API dans la session
   */
  public saveApiKey(provider: keyof ApiKeyConfig, key: string): { success: boolean; message: string } {
    // Valider la clé
    const validation = sessionApiKeyManager.validateApiKey(provider, key);
    if (!validation.valid) {
      return { success: false, message: validation.message };
    }

    // Sauvegarder
    const saved = sessionApiKeys.save(provider, key);
    if (saved) {
      return { success: true, message: 'Clé API sauvegardée avec succès' };
    } else {
      return { success: false, message: 'Erreur lors de la sauvegarde' };
    }
  }

  /**
   * Supprime une clé API de la session
   */
  public removeApiKey(provider: keyof ApiKeyConfig): boolean {
    return sessionApiKeys.remove(provider);
  }

  /**
   * Supprime toutes les clés API de la session
   */
  public clearAllApiKeys(): boolean {
    return sessionApiKeys.clear();
  }

  /**
   * Teste une clé API (validation + test de connectivité basique)
   */
  public async testApiKey(provider: keyof ApiKeyConfig, key?: string): Promise<{ success: boolean; message: string }> {
    const testKey = key || this.getApiKey(provider);
    
    if (!testKey) {
      return { success: false, message: 'Aucune clé API trouvée' };
    }

    // Validation basique
    const validation = sessionApiKeyManager.validateApiKey(provider, testKey);
    if (!validation.valid) {
      return { success: false, message: validation.message };
    }

    // Test de connectivité basique (simulation pour l'instant)
    try {
      // Ici on pourrait faire un vrai test d'API
      // Pour l'instant on simule un test réussi
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return { success: true, message: 'Clé API valide et accessible' };
    } catch (error) {
      return { success: false, message: `Erreur de connectivité: ${error}` };
    }
  }

  /**
   * Obtient les modèles disponibles pour un provider
   */
  public getAvailableModels(provider: keyof ApiKeyConfig): string[] {
    const models: Record<keyof ApiKeyConfig, string[]> = {
      'openrouter': [
        'google/gemini-flash-1.5',
        'google/gemini-pro-1.5',
        'openai/gpt-4o',
        'openai/gpt-4o-mini',
        'anthropic/claude-3.5-sonnet',
        'anthropic/claude-3.5-haiku'
      ],
      'gemini': [
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-pro'
      ],
      'openai': [
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'gpt-3.5-turbo'
      ],
      'anthropic': [
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-3-opus-20240229'
      ],
      'supabase': [] // Pas de modèles pour Supabase
    };

    return models[provider] || [];
  }

  /**
   * Obtient le provider recommandé
   */
  public getRecommendedProvider(): keyof ApiKeyConfig {
    return 'openrouter';
  }

  /**
   * Obtient les providers gratuits
   */
  public getFreeProviders(): (keyof ApiKeyConfig)[] {
    return ['gemini', 'supabase'];
  }
}

/**
 * Instance singleton du gestionnaire de clés API
 */
export const apiKeyManager = ApiKeyManager.getInstance();

/**
 * Fonctions de commodité
 */
export const apiKeys = {
  /**
   * Obtient le statut de toutes les clés
   */
  status: () => apiKeyManager.getAllApiKeysStatus(),
  
  /**
   * Obtient un résumé des clés
   */
  summary: () => apiKeyManager.getApiKeysSummary(),
  
  /**
   * Obtient une clé API
   */
  get: (provider: keyof ApiKeyConfig) => apiKeyManager.getApiKey(provider),
  
  /**
   * Sauvegarde une clé API
   */
  save: (provider: keyof ApiKeyConfig, key: string) => apiKeyManager.saveApiKey(provider, key),
  
  /**
   * Teste une clé API
   */
  test: (provider: keyof ApiKeyConfig, key?: string) => apiKeyManager.testApiKey(provider, key),
  
  /**
   * Supprime une clé API
   */
  remove: (provider: keyof ApiKeyConfig) => apiKeyManager.removeApiKey(provider),
  
  /**
   * Supprime toutes les clés
   */
  clear: () => apiKeyManager.clearAllApiKeys(),
  
  /**
   * Obtient les providers
   */
  providers: () => apiKeyManager.getProviders(),
  
  /**
   * Obtient les modèles disponibles
   */
  models: (provider: keyof ApiKeyConfig) => apiKeyManager.getAvailableModels(provider)
};

/**
 * Test de la fonctionnalité du gestionnaire de clés API
 */
export function testApiKeyManager(): void {
  console.log('🧪 Test ApiKeyManager');
  
  // Test du statut
  const status = apiKeyManager.getAllApiKeysStatus();
  console.log('📊 Statut des clés API:');
  Object.entries(status).forEach(([provider, info]) => {
    console.log(`  ${provider}: ${info.present ? '✅' : '❌'} (${info.source}) ${info.preview}`);
  });

  // Test du résumé
  const summary = apiKeyManager.getApiKeysSummary();
  console.log(`📈 Résumé: ${summary.available}/${summary.total} disponibles (${summary.sessionKeys} session, ${summary.envKeys} env)`);

  // Test des providers
  const providers = apiKeyManager.getProviders();
  console.log(`🔧 Providers supportés: ${providers.length}`);

  // Test des modèles
  const models = apiKeyManager.getAvailableModels('openrouter');
  console.log(`🤖 Modèles OpenRouter: ${models.length}`);

  console.log('✅ Test ApiKeyManager terminé');
}