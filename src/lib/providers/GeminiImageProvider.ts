/**
 * Provider pour Gemini 2.5 Flash Image
 * Gère la génération d'images avec les prompts améliorés
 */

import { GoogleGenAI } from '@google/genai';

export interface ImageGenerationRequest {
  prompt: string;
  style?: 'photorealistic' | 'artistic' | 'cartoon' | 'abstract' | 'minimalist';
  quality?: 'standard' | 'high';
  size?: '1024x1024' | '1024x768' | '768x1024';
  count?: number;
}

export interface ImageGenerationResponse {
  success: boolean;
  images?: GeneratedImage[];
  error?: string;
  metadata?: {
    prompt: string;
    processingTime: number;
    model: string;
    timestamp: string;
  };
}

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  metadata: {
    size: string;
    quality: string;
    style: string;
    timestamp: string;
  };
}

export class GeminiImageProvider {
  private genAI: GoogleGenAI;
  private isAvailable: boolean = false;

  constructor(apiKey: string) {
    try {
      this.genAI = new GoogleGenAI({
        apiKey: apiKey,
      });
      this.isAvailable = true;
      console.log('🎨 GeminiImageProvider initialisé avec Gemini 2.5 Flash Image');
    } catch (error) {
      console.error('❌ Erreur initialisation GeminiImageProvider:', error);
      this.isAvailable = false;
    }
  }

  /**
   * Vérifie si le provider est disponible
   */
  isProviderAvailable(): boolean {
    return this.isAvailable;
  }

  /**
   * Génère des images à partir d'un prompt amélioré
   */
  async generateImages(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    try {
      if (!this.isAvailable) {
        throw new Error('Provider non disponible');
      }

      console.log(`🎨 Génération d'images avec prompt: "${request.prompt}"`);

      const startTime = Date.now();

      // Utiliser la vraie API Gemini 2.5 Flash Image
      const realResponse = await this.generateRealImages(request);

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        images: realResponse.images,
        metadata: {
          prompt: request.prompt,
          processingTime,
          model: 'gemini-2.5-flash-image-preview',
          timestamp: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('❌ Erreur génération images:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
        metadata: {
          prompt: request.prompt,
          processingTime: 0,
          model: 'gemini-2.5-flash-image-preview',
          timestamp: new Date().toISOString()
        }
      };
    }
  }

  /**
   * Génère de vraies images avec Gemini 2.5 Flash Image
   */
  private async generateRealImages(request: ImageGenerationRequest): Promise<{ images: GeneratedImage[] }> {
    try {
      console.log(`🎨 Génération d'images réelles avec Gemini 2.5 Flash Image...`);
      
      // Utiliser la vraie API Gemini 2.5 Flash Image comme dans le test
      console.log(`🔍 Tentative avec le modèle: gemini-2.5-flash-image-preview`);
      console.log(`🔍 Prompt envoyé: "${request.prompt}"`);
      
      // Utiliser la vraie API Gemini 2.5 Flash Image (Nano Banana) avec la config correcte
      const res = await this.genAI.models.generateContent({
        model: "gemini-2.5-flash-image-preview",
        contents: request.prompt,
        config: {
          // Forcer la génération d'images + texte
          responseModalities: ["TEXT", "IMAGE"],
          // Pas de safety settings - liberté créative totale
        }
      });

      console.log('✅ Réponse reçue de Gemini');

      const parts = res.candidates?.[0]?.content?.parts ?? [];
      console.log(`📊 Nombre de parts: ${parts.length}`);

      // Debug: afficher la structure des parts
      console.log('🔍 Structure des parts:', parts.map((p: any, index: number) => ({
        index,
        type: p.text ? 'text' : p.inlineData ? 'image' : 'unknown',
        content: p.text ? p.text.substring(0, 50) + '...' : p.inlineData ? `${p.inlineData.mimeType} (${p.inlineData.data?.length || 0} chars)` : 'unknown'
      })));

      const imgPart = parts.find((p: any) => p.inlineData?.data);
      if (!imgPart) {
        console.log('❌ Aucune image retournée');
        console.log('📋 Parts disponibles:', parts.map((p: any) => {
          if (p.text) return `text: "${p.text.substring(0, 200)}..."`;
          if (p.inlineData) return `inlineData: ${p.inlineData.mimeType} (data: ${p.inlineData.data ? 'présent' : 'absent'})`;
          return `unknown: ${JSON.stringify(p)}`;
        }));
        
        // Vérifier si c'est un problème de modèle non disponible
        const textParts = parts.filter((p: any) => p.text);
        if (textParts.length > 0) {
          const errorText = textParts[0].text;
          console.log('📝 Texte de réponse complet:', errorText);
          
          if (errorText.includes('model') || errorText.includes('unavailable') || errorText.includes('not available')) {
            throw new Error(`Modèle Gemini 2.5 Flash Image non disponible: ${errorText}`);
          }
          
          // Vérifier si c'est un problème de safety filters
          if (errorText.toLowerCase().includes('safety') || errorText.toLowerCase().includes('blocked') || errorText.toLowerCase().includes('policy')) {
            throw new Error(`Prompt bloqué par les safety filters: ${errorText}`);
          }
          
          // Vérifier si c'est un problème de billing
          if (errorText.toLowerCase().includes('billing') || errorText.toLowerCase().includes('quota') || errorText.toLowerCase().includes('limit')) {
            throw new Error(`Problème de facturation/quota: ${errorText}`);
          }
        }
        
        throw new Error(`Aucune image retournée par Gemini. Réponse texte: "${textParts[0]?.text?.substring(0, 200) || 'Aucun texte'}"`);
      }

      console.log('🖼️ Image trouvée dans la réponse');
      console.log(`📊 Type MIME: ${imgPart.inlineData.mimeType}`);
      console.log(`📊 Taille données: ${imgPart.inlineData.data.length} caractères`);

      // Convertir l'image base64 en buffer avec gestion d'erreur
      let buffer: Buffer;
      try {
        buffer = Buffer.from(imgPart.inlineData.data, "base64");
        console.log(`✅ Buffer créé: ${buffer.length} bytes`);
      } catch (error) {
        console.error('❌ Erreur conversion base64:', error);
        throw new Error(`Erreur conversion base64: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
      }
      
      // Créer une URL de données pour l'image
      const dataUrl = `data:image/png;base64,${imgPart.inlineData.data}`;
      
      const generatedImages: GeneratedImage[] = [{
        id: `real_${Date.now()}`,
        url: dataUrl,
        prompt: request.prompt,
        metadata: {
          size: request.size || '1024x1024',
          quality: request.quality || 'standard',
          style: request.style || 'photorealistic',
          timestamp: new Date().toISOString(),
          note: 'Image générée avec Gemini 2.5 Flash Image (nano banana)'
        }
      }];

      return { images: generatedImages };
      
    } catch (error) {
      console.error('❌ Erreur génération réelle:', error);
      throw new Error(`Erreur lors de la génération d'images: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  /**
   * Optimise un prompt pour la génération d'images
   */
  async optimizePromptForImageGeneration(prompt: string): Promise<string> {
    try {
      const optimizationPrompt = `Tu es un expert en prompt engineering pour la génération d'images. Optimise ce prompt pour obtenir les meilleurs résultats visuels.

PROMPT ORIGINAL: "${prompt}"

RÉPONDS UNIQUEMENT EN JSON avec cette structure exacte:
{
  "optimizedPrompt": "le_prompt_optimisé_complet",
  "improvements": ["amélioration1", "amélioration2", "amélioration3"],
  "technicalSpecs": "spécifications_techniques_recommandées",
  "styleRecommendations": "recommandations_de_style"
}`;

      const result = await this.genAI.models.generateContent({
        model: "gemini-1.5-flash",
        contents: optimizationPrompt,
      });
      const responseText = result.response?.text()?.trim() || '';
      
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const optimization = JSON.parse(jsonMatch[0]);
        return optimization.optimizedPrompt;
      } else {
        throw new Error('Réponse JSON invalide');
      }
    } catch (error) {
      console.error('❌ Erreur optimisation prompt:', error);
      return prompt; // Retourner le prompt original en cas d'erreur
    }
  }

  /**
   * Analyse la qualité d'un prompt pour la génération d'images
   */
  async analyzePromptQuality(prompt: string): Promise<{
    score: number;
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
  }> {
    try {
      const analysisPrompt = `Tu es un expert en prompt engineering. Analyse la qualité de ce prompt pour la génération d'images.

PROMPT: "${prompt}"

RÉPONDS UNIQUEMENT EN JSON avec cette structure exacte:
{
  "score": 0-100,
  "strengths": ["force1", "force2"],
  "weaknesses": ["faiblesse1", "faiblesse2"],
  "suggestions": ["suggestion1", "suggestion2", "suggestion3"]
}`;

      const result = await this.genAI.models.generateContent({
        model: "gemini-1.5-flash",
        contents: analysisPrompt,
      });
      const responseText = result.response?.text()?.trim() || '';
      
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Réponse JSON invalide');
      }
    } catch (error) {
      console.error('❌ Erreur analyse qualité:', error);
      return {
        score: 50,
        strengths: ['Prompt analysable'],
        weaknesses: ['Erreur d\'analyse'],
        suggestions: ['Vérifier la syntaxe du prompt']
      };
    }
  }

  /**
   * Génère des variations d'un prompt
   */
  async generatePromptVariations(prompt: string, count: number = 3): Promise<string[]> {
    try {
      const variationsPrompt = `Tu es un expert en prompt engineering. Génère ${count} variations créatives de ce prompt pour la génération d'images.

PROMPT ORIGINAL: "${prompt}"

RÉPONDS UNIQUEMENT EN JSON avec cette structure exacte:
{
  "variations": ["variation1", "variation2", "variation3"]
}`;

      const result = await this.genAI.models.generateContent({
        model: "gemini-1.5-flash",
        contents: variationsPrompt,
      });
      const responseText = result.response?.text()?.trim() || '';
      
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const variations = JSON.parse(jsonMatch[0]);
        return variations.variations;
      } else {
        throw new Error('Réponse JSON invalide');
      }
    } catch (error) {
      console.error('❌ Erreur génération variations:', error);
      return [prompt]; // Retourner le prompt original en cas d'erreur
    }
  }

  /**
   * Teste le provider
   */
  async testProvider(): Promise<boolean> {
    try {
      const testRequest: ImageGenerationRequest = {
        prompt: 'A beautiful sunset over mountains',
        style: 'photorealistic',
        quality: 'standard',
        size: '1024x1024',
        count: 1
      };

      const response = await this.generateImages(testRequest);
      return response.success;
    } catch (error) {
      console.error('❌ Erreur test provider:', error);
      return false;
    }
  }
}