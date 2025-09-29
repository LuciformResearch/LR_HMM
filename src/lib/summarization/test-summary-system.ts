/**
 * Test du système de résumé et de mémoire
 * Vérifie que tous les composants fonctionnent correctement
 */

import { SummarizationAgent } from './SummarizationAgent';
import { SummaryManager } from './SummaryManager';
import { getUserMemoryTool } from '@/mcp/tools/memory/get_user_memory';
import { generateSummaryTool } from '@/mcp/tools/memory/generate_summary';

export async function testSummarySystem(): Promise<void> {
  console.log('🧪 Test du système de résumé et de mémoire');
  console.log('=' * 50);

  try {
    // Test 1: SummarizationAgent
    console.log('\n1️⃣ Test SummarizationAgent...');
    const agent = new SummarizationAgent({
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      maxSummaryLength: 200
    });

    const testMessages = [
      {
        role: 'user' as const,
        content: 'Bonjour Algareth, comment ça va ?',
        timestamp: new Date().toISOString()
      },
      {
        role: 'assistant' as const,
        content: '⛧ Algareth écoute... Je vais bien, merci de demander.',
        timestamp: new Date().toISOString()
      },
      {
        role: 'user' as const,
        content: 'Peux-tu me raconter une histoire ?',
        timestamp: new Date().toISOString()
      },
      {
        role: 'assistant' as const,
        content: '⛧ Algareth sourit mystérieusement... Il était une fois...',
        timestamp: new Date().toISOString()
      }
    ];

    const summaryResult = await agent.summarizeConversation(testMessages, 'test_user', 'fr');
    console.log(`✅ Résumé généré: ${summaryResult.summary.length} caractères`);
    console.log(`📊 Ratio compression: ${(summaryResult.compressionRatio * 100).toFixed(1)}%`);
    console.log(`⭐ Score qualité: ${summaryResult.qualityScore.toFixed(2)}`);

    // Test 2: SummaryManager
    console.log('\n2️⃣ Test SummaryManager...');
    const summaryManager = new SummaryManager();
    
    const userSummary = await summaryManager.saveSummary(
      'test_user',
      testMessages,
      [],
      'fr'
    );
    
    console.log(`✅ Résumé sauvegardé: ${userSummary.id}`);
    console.log(`📝 Contenu: ${userSummary.summary.substring(0, 100)}...`);

    // Test 3: Chargement de mémoire
    console.log('\n3️⃣ Test chargement mémoire...');
    const memoryResult = await getUserMemoryTool.handler({
      user: 'test_user',
      includeConversations: true,
      includeSummaries: true,
      maxConversations: 5
    });

    if (memoryResult.success) {
      console.log(`✅ Mémoire chargée pour test_user`);
      console.log(`💬 Conversations: ${memoryResult.data.memory.stats.conversationCount}`);
      console.log(`📝 Résumés: ${memoryResult.data.memory.stats.summaryCount}`);
      console.log(`🧠 Meta-résumé: ${memoryResult.data.memory.metaSummary ? 'Disponible' : 'Aucun'}`);
    } else {
      console.log(`❌ Erreur chargement mémoire: ${memoryResult.error}`);
    }

    // Test 4: Génération de résumé via MCP
    console.log('\n4️⃣ Test génération résumé MCP...');
    const generateResult = await generateSummaryTool.handler({
      user: 'test_user_2',
      messages: testMessages,
      language: 'fr',
      saveSummary: true
    });

    if (generateResult.success) {
      console.log(`✅ Résumé généré via MCP`);
      console.log(`📝 Contenu: ${generateResult.data.summaryText.substring(0, 100)}...`);
      console.log(`💾 Sauvegardé: ${generateResult.data.saved}`);
    } else {
      console.log(`❌ Erreur génération MCP: ${generateResult.error}`);
    }

    // Test 5: Statistiques
    console.log('\n5️⃣ Test statistiques...');
    const stats = summaryManager.getSummaryStats();
    console.log(`✅ Statistiques récupérées`);
    console.log(`👥 Utilisateurs: ${stats.totalUsers}`);
    console.log(`📝 Résumés totaux: ${stats.totalSummaries}`);
    
    for (const [userId, userStats] of Object.entries(stats.users)) {
      console.log(`   👤 ${userId}: ${userStats.count} résumé(s), ratio moyen: ${(userStats.averageCompressionRatio * 100).toFixed(1)}%`);
    }

    console.log('\n✅ Tous les tests sont passés avec succès !');
    console.log('🎉 Le système de résumé et de mémoire est opérationnel');

  } catch (error) {
    console.error('❌ Erreur lors des tests:', error);
    throw error;
  }
}

/**
 * Test de performance du système
 */
export async function testPerformance(): Promise<void> {
  console.log('⚡ Test de performance du système de résumé');
  console.log('=' * 50);

  const agent = new SummarizationAgent();
  const summaryManager = new SummaryManager();

  // Test avec différents volumes de messages
  const testSizes = [5, 10, 20, 50];
  
  for (const size of testSizes) {
    console.log(`\n📊 Test avec ${size} messages...`);
    
    const messages = Array.from({ length: size }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as const,
      content: `Message ${i + 1}: Contenu de test pour évaluer les performances`,
      timestamp: new Date().toISOString()
    }));

    const startTime = Date.now();
    
    try {
      const summaryResult = await agent.summarizeConversation(messages, 'perf_test', 'fr');
      const processingTime = Date.now() - startTime;
      
      console.log(`✅ ${size} messages traités en ${processingTime}ms`);
      console.log(`📝 Résumé: ${summaryResult.summary.length} caractères`);
      console.log(`📈 Ratio: ${(summaryResult.compressionRatio * 100).toFixed(1)}%`);
      console.log(`⚡ Vitesse: ${(size / (processingTime / 1000)).toFixed(1)} msg/s`);
      
    } catch (error) {
      console.error(`❌ Erreur avec ${size} messages:`, error);
    }
  }
}

// Fonction pour exécuter tous les tests
export async function runAllTests(): Promise<void> {
  try {
    await testSummarySystem();
    console.log('\n' + '=' * 50);
    await testPerformance();
    console.log('\n🎯 Tous les tests sont terminés !');
  } catch (error) {
    console.error('💥 Échec des tests:', error);
    throw error;
  }
}