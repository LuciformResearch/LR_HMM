/**
 * Provider Unifié pour LR_TchatAgent Web
 * Support OpenRouter + Providers directs (Gemini, OpenAI, Anthropic)
 */

import { HttpResponse } from '@/lib/types/Provider';
import { OpenRouterProvider } from './OpenRouterProvider';
import { OllamaProvider } from './OllamaProvider';
import { sessionApiKeys } from '@/lib/utils/SessionEncryption';

export interface UnifiedProviderConfig {
  type: 'openrouter' | 'custom' | 'ollama';
  provider: 'openrouter' | 'gemini' | 'openai' | 'anthropic' | 'ollama';
  model: string;
  apiKey?: string; // Optionnel pour Ollama
  customConfig?: {
    baseUrl?: string;
    timeout?: number;
  };
}

/**
 * Provider unifié qui peut utiliser OpenRouter ou des providers directs
 */
export class UnifiedProvider {
  private config: UnifiedProviderConfig;
  private openRouterProvider?: OpenRouterProvider;
  private ollamaProvider?: OllamaProvider;

  constructor(config: UnifiedProviderConfig) {
    this.config = config;
    
    if (config.type === 'openrouter') {
      this.openRouterProvider = new OpenRouterProvider({
        apiKey: config.apiKey!,
        model: config.model,
        timeout: config.customConfig?.timeout || 30
      });
    } else if (config.type === 'ollama') {
      this.ollamaProvider = new OllamaProvider({
        model: config.model,
        baseUrl: config.customConfig?.baseUrl,
        timeout: config.customConfig?.timeout || 30
      });
    }
  }

  /**
   * Vérifie si le provider est disponible
   */
  isAvailable(): boolean {
    if (this.config.type === 'ollama') {
      return true; // Ollama sera vérifié de manière asynchrone
    }

    if (!this.config.apiKey || this.config.apiKey.length < 10) {
      return false;
    }

    if (this.config.type === 'openrouter') {
      return this.openRouterProvider?.isAvailable() || false;
    }

    return true; // Pour les providers directs, on assume que la clé est valide
  }

  /**
   * Génère une réponse via le provider configuré
   */
  async generateResponse(prompt: string, maxTokens: number = 2000): Promise<HttpResponse> {
    if (this.config.type === 'ollama') {
      // Vérifier Ollama de manière asynchrone
      const isAvailable = await this.ollamaProvider!.isAvailable();
      if (!isAvailable) {
        return {
          content: '❌ Ollama non disponible - vérifiez que le service est démarré',
          error: true
        };
      }
      return await this.ollamaProvider!.generateResponse(prompt, maxTokens);
    }

    if (!this.isAvailable()) {
      return {
        content: '❌ Provider non configuré ou clé API manquante',
        error: true
      };
    }

    if (this.config.type === 'openrouter') {
      return await this.openRouterProvider!.generateResponse(prompt, maxTokens);
    }

    // Provider direct
    return await this.generateDirectResponse(prompt, maxTokens);
  }

  /**
   * Génère une réponse via un provider direct
   */
  private async generateDirectResponse(prompt: string, maxTokens: number): Promise<HttpResponse> {
    try {
      switch (this.config.provider) {
        case 'gemini':
          return await this.generateGeminiResponse(prompt, maxTokens);
        case 'openai':
          return await this.generateOpenAIResponse(prompt, maxTokens);
        case 'anthropic':
          return await this.generateAnthropicResponse(prompt, maxTokens);
        default:
          return {
            content: `❌ Provider non supporté: ${this.config.provider}`,
            error: true
          };
      }
    } catch (error) {
      return {
        content: `❌ Erreur ${this.config.provider}: ${error}`,
        error: true
      };
    }
  }

  /**
   * Génère une réponse via Gemini
   */
  private async generateGeminiResponse(prompt: string, maxTokens: number): Promise<HttpResponse> {
    const model = this.config.model || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    
    const headers = {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.config.apiKey
    };

    const payload = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.7,
        topP: 0.8
      }
    };

    console.log('🌐 Appel Gemini:', url);
    console.log('📤 Model:', model);
    const timeoutMs = this.config.customConfig?.timeout ?? Number(process.env.GEMINI_TIMEOUT_MS || 30000);
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      } as any);
    } finally {
      clearTimeout(to);
    }

    if (response.ok) {
      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Pas de réponse';
      
      console.log('✅ Réponse Gemini:', content.slice(0, 100) + '...');
      
      return {
        content,
        error: false,
        metadata: {
          model: this.config.model,
          provider: 'gemini'
        }
      };
    } else {
      const errorText = await response.text();
      return {
        content: `Erreur Gemini ${response.status}: ${errorText}`,
        error: true
      };
    }
  }

  /**
   * Génère une réponse via OpenAI
   */
  private async generateOpenAIResponse(prompt: string, maxTokens: number): Promise<HttpResponse> {
    const url = 'https://api.openai.com/v1/chat/completions';
    
    const headers = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json'
    };

    const payload = {
      model: this.config.model,
      messages: [{
        role: 'user',
        content: prompt
      }],
      max_tokens: maxTokens,
      temperature: 0.7
    };

    console.log('🌐 Appel OpenAI:', url);
    console.log('📤 Model:', this.config.model);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || 'Pas de réponse';
      
      console.log('✅ Réponse OpenAI:', content.slice(0, 100) + '...');
      
      return {
        content,
        error: false,
        metadata: {
          model: data.model,
          usage: data.usage,
          provider: 'openai'
        }
      };
    } else {
      const errorText = await response.text();
      return {
        content: `Erreur OpenAI ${response.status}: ${errorText}`,
        error: true
      };
    }
  }

  /**
   * Génère une réponse via Anthropic
   */
  private async generateAnthropicResponse(prompt: string, maxTokens: number): Promise<HttpResponse> {
    const url = 'https://api.anthropic.com/v1/messages';
    
    const headers = {
      'x-api-key': this.config.apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    };

    const payload = {
      model: this.config.model,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: prompt
      }]
    };

    console.log('🌐 Appel Anthropic:', url);
    console.log('📤 Model:', this.config.model);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.content?.[0]?.text || 'Pas de réponse';
      
      console.log('✅ Réponse Anthropic:', content.slice(0, 100) + '...');
      
      return {
        content,
        error: false,
        metadata: {
          model: data.model,
          usage: data.usage,
          provider: 'anthropic'
        }
      };
    } else {
      const errorText = await response.text();
      return {
        content: `Erreur Anthropic ${response.status}: ${errorText}`,
        error: true
      };
    }
  }

  /**
   * Teste la connexion
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.generateResponse('Test de connexion', 10);
      return !response.error;
    } catch {
      return false;
    }
  }

  /**
   * Met à jour la configuration
   */
  updateConfig(config: Partial<UnifiedProviderConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (config.type === 'openrouter' || config.apiKey) {
      this.openRouterProvider = new OpenRouterProvider({
        apiKey: this.config.apiKey,
        model: this.config.model,
        timeout: this.config.customConfig?.timeout || 30
      });
    }
  }

  /**
   * Récupère la configuration actuelle
   */
  getConfig(): UnifiedProviderConfig {
    return { ...this.config };
  }
}

/**
 * Factory pour créer des providers unifiés
 */
export class UnifiedProviderFactory {
  /**
   * Crée un provider depuis la configuration stockée
   */
  static createFromStorage(): UnifiedProvider | null {
    try {
      // Vérifier si on est côté client
      if (typeof window === 'undefined') {
        return null;
      }

      // Utiliser le système de gestion des clés API
      const providerConfig = localStorage.getItem('lr_tchatagent_provider_config');
      
      if (!providerConfig) {
        console.log('🔑 Aucune configuration de provider trouvée');
        return null;
      }

      const config = JSON.parse(providerConfig);
      
      // Récupérer la clé API depuis le système de gestion
      const activeKey = sessionApiKeys.load(config.provider);
      if (!activeKey) {
        console.log(`🔑 Aucune clé API trouvée pour le provider: ${config.provider}`);
        return null;
      }

      console.log(`✅ Provider créé avec succès: ${config.provider} (${config.model})`);

      return new UnifiedProvider({
        type: config.type,
        provider: config.provider,
        model: config.model,
        apiKey: activeKey,
        customConfig: config.customConfig
      });
    } catch (error) {
      console.error('❌ Erreur création provider depuis storage:', error);
      return null;
    }
  }

  /**
   * Crée un provider depuis la base de données PostgreSQL
   */
  static async createFromDatabase(userId: string): Promise<UnifiedProvider | null> {
    try {
      // Vérifier si on est côté client
      if (typeof window === 'undefined') {
        return null;
      }

      console.log(`🔑 Chargement des clés API depuis PostgreSQL pour l'utilisateur: ${userId}`);

      // Importer authenticatedGet dynamiquement pour éviter les problèmes côté serveur
      const { authenticatedGet } = await import('@/lib/utils/authenticatedFetch');

      // Charger les clés API depuis PostgreSQL avec authentification
      const response = await authenticatedGet('/api/api-keys');
      if (!response.ok) {
        console.error(`❌ Erreur chargement clés API: ${response.status}`);
        return null;
      }

      const apiKeys = await response.json();
      console.log('🔑 Clés API chargées depuis PostgreSQL:', Object.keys(apiKeys));

      // Vérifier la configuration du provider
      const providerConfig = localStorage.getItem('lr_tchatagent_provider_config');
      if (!providerConfig) {
        console.log('🔑 Aucune configuration de provider trouvée');
        return null;
      }

      const config = JSON.parse(providerConfig);
      
      // Récupérer la clé API depuis PostgreSQL
      const activeKey = apiKeys[config.provider];
      if (!activeKey) {
        console.log(`🔑 Aucune clé API trouvée dans PostgreSQL pour le provider: ${config.provider}`);
        return null;
      }

      console.log(`✅ Provider créé avec succès depuis PostgreSQL: ${config.provider} (${config.model})`);

      return new UnifiedProvider({
        type: config.type,
        provider: config.provider,
        model: config.model,
        apiKey: activeKey,
        customConfig: config.customConfig
      });
    } catch (error) {
      console.error('❌ Erreur création provider depuis PostgreSQL:', error);
      return null;
    }
  }

  /**
   * Crée un provider avec une configuration spécifique
   */
  static create(config: UnifiedProviderConfig): UnifiedProvider {
    return new UnifiedProvider(config);
  }
}
