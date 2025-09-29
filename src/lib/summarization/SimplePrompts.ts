/**
 * Prompts simplifiés pour les scripts HMM
 * Remplace les prompts complexes d'Algareth par des prompts simples
 */

export interface SimplePrompt {
  personaName: string;
  personaDescription: string;
}

export const getSimplePrompts = (language: string = 'fr'): SimplePrompt => {
  const prompts: Record<string, SimplePrompt> = {
    fr: {
      personaName: 'Assistant IA',
      personaDescription: 'Assistant intelligent spécialisé dans l\'analyse et le résumé de conversations.'
    },
    en: {
      personaName: 'AI Assistant',
      personaDescription: 'Intelligent assistant specialized in conversation analysis and summarization.'
    }
  };
  
  return prompts[language] || prompts.fr;
};