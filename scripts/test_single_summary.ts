#!/usr/bin/env tsx

/**
 * Script de test pour vérifier qu'un seul résumé L1 fonctionne
 * Sans écrire dans les artefacts, juste pour tester la connectivité
 */

import 'dotenv/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { SummarizationAgent } from '@/lib/summarization/SummarizationAgent';

async function testSingleSummary() {
  console.log('🧪 Test d\'un seul résumé L1...\n');
  
  // Messages de test simples
  const testMessages = [
    {
      role: 'user' as const,
      content: 'Salut ! Comment ça va ?',
      timestamp: '2025-09-29T14:00:00Z'
    },
    {
      role: 'assistant' as const,
      content: 'Salut ! Ça va bien merci, et toi ? Je suis là pour t\'aider avec tes questions.',
      timestamp: '2025-09-29T14:00:05Z'
    },
    {
      role: 'user' as const,
      content: 'Super ! Peux-tu m\'expliquer comment fonctionne la compression mémoire hiérarchique ?',
      timestamp: '2025-09-29T14:00:10Z'
    },
    {
      role: 'assistant' as const,
      content: 'Bien sûr ! La compression mémoire hiérarchique est un système qui organise les conversations en niveaux de résumé. Le niveau L1 contient des résumés courts, le L2 des résumés plus longs, etc. Cela permet de garder le contexte sans stocker tous les détails.',
      timestamp: '2025-09-29T14:00:15Z'
    }
  ];

  try {
    // Créer l'agent de résumé
    const agent = new SummarizationAgent({
      provider: 'gemini',
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      consciousnessLevel: 0.7,
      maxSummaryLength: 200, // Résumé court pour le test
      timeoutMs: 10000 // Timeout court
    });

    console.log('✅ Agent de résumé créé');
    console.log(`📝 Modèle: ${agent.config.model}`);
    console.log(`📏 Longueur max: ${agent.config.maxSummaryLength} caractères\n`);

    // Générer le résumé
    console.log('🔄 Génération du résumé...');
    const result = await agent.summarizeConversation(testMessages, 'fr');
    
    console.log('✅ Résumé généré avec succès !\n');
    console.log('📄 Résumé:');
    console.log('─'.repeat(50));
    console.log(result.summary);
    console.log('─'.repeat(50));
    console.log(`📊 Ratio de compression: ${result.compressionRatio.toFixed(2)}`);
    console.log(`📏 Longueur: ${result.summary.length} caractères`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Erreur lors du test:', error);
    return false;
  }
}

async function main() {
  console.log('🚀 Test de connectivité HMM - Résumé unique\n');
  
  // Vérifier les variables d'environnement
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY manquante dans .env');
    process.exit(1);
  }
  
  console.log('✅ Variables d\'environnement OK');
  console.log(`🔑 API Key: ${process.env.GEMINI_API_KEY.substring(0, 10)}...`);
  console.log(`🤖 Modèle: ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}\n`);
  
  const success = await testSingleSummary();
  
  if (success) {
    console.log('\n🎉 Test réussi ! Le système HMM fonctionne correctement.');
    console.log('💡 Tu peux maintenant utiliser les scripts complets en toute confiance.');
  } else {
    console.log('\n💥 Test échoué. Vérifiez la configuration.');
    process.exit(1);
  }
}

main().catch(console.error);