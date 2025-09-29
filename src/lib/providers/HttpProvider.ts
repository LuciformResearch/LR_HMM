/**
 * HTTP Provider pour LR_TchatAgent Web
 * Appels HTTP simples et transparents pour Ollama et Gemini
 * Migration depuis http_provider.py
 */

import { 
  ProviderType, 
  HttpResponse, 
  HttpProvider as IHttpProvider, 
  ProviderConfig,
  OllamaConfig,
  GeminiConfig 
} from '@/lib/types/Provider';
import { getApiKey, checkApiKeys } from '@/lib/utils/SecureEnvManager.browser';
import { getLogger } from '@/lib/utils/Logger';

const logger = getLogger('http_provider');

/**
 * Provider HTTP simple et transparent pour LLM
 * Support Ollama et Gemini via appels HTTP directs
 */
export class HttpProvider implements IHttpProvider {
  public providerType: ProviderType;
  public model: string;
  public timeout: number;
  private apiKey?: string;
  private baseUrl?: string;

  constructor(config: ProviderConfig) {
    this.providerType = config.providerType;
    this.model = config.model || this.getDefaultModel();
    this.timeout = config.timeout || this.getDefaultTimeout();
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;

    // Initialiser selon le type
    if (this.providerType === 'local') {
      this.initOllama();
    } else if (this.providerType === 'gemini') {
      this.initGemini();
    } else {
      throw new Error(`Provider non supporté: ${this.providerType}`);
    }
  }

  private getDefaultModel(): string {
    const defaultModels: Record<ProviderType, string> = {
      'local': 'qwen2.5:7b-instruct',
      'gemini': 'gemini-1.5-flash',
      'openai': 'gpt-3.5-turbo',
      'anthropic': 'claude-3-sonnet-20240229'
    };
    return defaultModels[this.providerType] || 'qwen2.5:7b-instruct';
  }

  private getDefaultTimeout(): number {
    const defaultTimeouts: Record<ProviderType, number> = {
      'local': 60,    // Ollama peut être lent
      'gemini': 30,   // API plus rapide
      'openai': 30,
      'anthropic': 30
    };
    return defaultTimeouts[this.providerType] || 60;
  }

  private initOllama(): void {
    this.baseUrl = 'http://localhost:11434';
    logger.info(`✅ Provider Ollama initialisé: ${this.baseUrl}`);
    logger.info(`   Modèle: ${this.model}`);
  }

  private initGemini(): void {
    this.apiKey = this.apiKey || getApiKey('gemini') || undefined;
    
    if (!this.apiKey) {
      logger.warning('⚠️ Clé API Gemini manquante');
      return;
    }

    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    logger.info(`✅ Provider Gemini initialisé: ${this.baseUrl}`);
    logger.info(`   Modèle: ${this.model}`);
    logger.info(`   API Key: ${this.apiKey.slice(0, 4)}...${this.apiKey.slice(-3)}`);
  }

  async generateResponse(prompt: string, maxTokens: number = 2000): Promise<HttpResponse> {
    if (this.providerType === 'local') {
      return await this.generateOllama(prompt, maxTokens);
    } else if (this.providerType === 'gemini') {
      return await this.generateGemini(prompt, maxTokens);
    } else {
      return {
        content: '❌ Provider non supporté',
        error: true
      };
    }
  }

  private async generateOllama(prompt: string, maxTokens: number): Promise<HttpResponse> {
    try {
      const url = `${this.baseUrl}/api/generate`;
      
      const payload = {
        model: this.model,
        prompt: prompt,
        stream: false,
        options: {
          num_predict: maxTokens,
          temperature: 0.7
        }
      };

      logger.info(`🌐 Appel Ollama: ${url}`);
      logger.info(`📤 Payload: ${JSON.stringify(payload, null, 2)}`);
      logger.info(`⏱️ Timeout: ${this.timeout}s`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout * 1000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      logger.info(`📥 Status: ${response.status}`);
      logger.info(`📥 Headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`);

      if (response.ok) {
        const data = await response.json();
        const content = data.response || 'Pas de réponse';
        logger.info(`✅ Réponse Ollama: ${content.slice(0, 100)}...`);
        return {
          content,
          error: false,
          metadata: data
        };
      } else {
        const errorText = await response.text();
        const errorMsg = `Erreur HTTP ${response.status}: ${errorText}`;
        logger.error(`❌ ${errorMsg}`);
        return {
          content: errorMsg,
          error: true
        };
      }
    } catch (error) {
      let errorMsg: string;
      if (error instanceof Error && error.name === 'AbortError') {
        errorMsg = 'Timeout Ollama';
      } else {
        errorMsg = `Erreur Ollama: ${error}`;
      }
      logger.error(`❌ ${errorMsg}`);
      return {
        content: errorMsg,
        error: true
      };
    }
  }

  private async generateGemini(prompt: string, maxTokens: number): Promise<HttpResponse> {
    if (!this.apiKey) {
      return {
        content: '❌ Clé API Gemini manquante',
        error: true
      };
    }

    try {
      const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
      
      const headers = {
        'Content-Type': 'application/json'
      };

      const payload = {
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.7,
          topP: 0.8,
          topK: 40
        }
      };

      // Masquer la clé API dans l'URL pour les logs
      const safeUrl = url.replace(
        `key=${this.apiKey}`, 
        `key=${this.apiKey.slice(0, 4)}...${this.apiKey.slice(-3)}`
      );
      
      logger.info(`🌐 Appel Gemini: ${safeUrl}`);
      logger.info(`📤 Headers: ${JSON.stringify(headers)}`);
      logger.info(`📤 Payload: ${JSON.stringify(payload, null, 2)}`);
      logger.info(`⏱️ Timeout: ${this.timeout}s`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout * 1000);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      logger.info(`📥 Status: ${response.status}`);
      logger.info(`📥 Headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`);

      if (response.ok) {
        const data = await response.json();
        try {
          const content = data.candidates[0].content.parts[0].text;
          logger.info(`✅ Réponse Gemini: ${content.slice(0, 100)}...`);
          return {
            content,
            error: false,
            metadata: data
          };
        } catch (parseError) {
          const errorMsg = `Erreur parsing Gemini: ${parseError}`;
          logger.error(`❌ ${errorMsg}`);
          return {
            content: errorMsg,
            error: true
          };
        }
      } else {
        const errorText = await response.text();
        const errorMsg = `Erreur HTTP ${response.status}: ${errorText}`;
        logger.error(`❌ ${errorMsg}`);
        return {
          content: errorMsg,
          error: true
        };
      }
    } catch (error) {
      let errorMsg: string;
      if (error instanceof Error && error.name === 'AbortError') {
        errorMsg = 'Timeout Gemini';
      } else {
        errorMsg = `Erreur Gemini: ${error}`;
      }
      logger.error(`❌ ${errorMsg}`);
      return {
        content: errorMsg,
        error: true
      };
    }
  }

  isAvailable(): boolean {
    if (this.providerType === 'local') {
      return this.baseUrl !== undefined;
    } else if (this.providerType === 'gemini') {
      return this.apiKey !== undefined && this.baseUrl !== undefined;
    }
    return false;
  }
}

/**
 * Factory pour créer des providers HTTP
 */
export class HttpProviderFactory {
  /**
   * Crée un provider HTTP
   */
  static createProvider(config: ProviderConfig): HttpProvider {
    return new HttpProvider(config);
  }

  /**
   * Liste les providers disponibles
   */
  static listAvailableProviders(): ProviderType[] {
    const available: ProviderType[] = [];
    
    // Vérifier local (Ollama) - toujours disponible côté client
    available.push('local');
    
    // Vérifier Gemini
    if (getApiKey('gemini')) {
      available.push('gemini');
    }
    
    return available;
  }

  /**
   * Teste la connectivité d'un provider
   */
  static async testProvider(providerType: ProviderType): Promise<boolean> {
    try {
      const provider = new HttpProvider({ providerType });
      if (!provider.isAvailable()) {
        return false;
      }
      
      // Test simple avec un prompt court
      const response = await provider.generateResponse('Test', 10);
      return !response.error;
    } catch {
      return false;
    }
  }
}

/**
 * Test du provider HTTP
 */
export async function testHttpProvider(): Promise<void> {
  logger.info('🌐 Test HttpProvider');
  
  // Afficher les clés API disponibles
  const apiKeys = checkApiKeys();
  logger.info('\n🔑 Clés API disponibles:');
  for (const [provider, info] of Object.entries(apiKeys)) {
    if (info.present) {
      logger.info(`   ✅ ${provider}: ${info.preview}`);
    } else {
      logger.info(`   ❌ ${provider}: absent`);
    }
  }

  // Test provider local
  logger.info('\n📱 Test Provider Ollama HTTP');
  const ollamaProvider = HttpProviderFactory.createProvider({ providerType: 'local' });
  if (ollamaProvider.isAvailable()) {
    const response = await ollamaProvider.generateResponse('Bonjour, comment ça va ?');
    if (!response.error) {
      logger.info(`✅ Réponse: ${response.content}`);
    } else {
      logger.info(`❌ Erreur: ${response.content}`);
    }
  } else {
    logger.info('❌ Provider Ollama non disponible');
  }

  // Test provider Gemini
  logger.info('\n🌐 Test Provider Gemini HTTP');
  const geminiProvider = HttpProviderFactory.createProvider({ providerType: 'gemini' });
  if (geminiProvider.isAvailable()) {
    const response = await geminiProvider.generateResponse('Bonjour, comment ça va ?');
    if (!response.error) {
      logger.info(`✅ Réponse: ${response.content}`);
    } else {
      logger.info(`❌ Erreur: ${response.content}`);
    }
  } else {
    logger.info('❌ Provider Gemini non disponible');
  }

  // Liste des providers disponibles
  const available = HttpProviderFactory.listAvailableProviders();
  logger.info(`\n📋 Providers disponibles: ${available.join(', ')}`);
}