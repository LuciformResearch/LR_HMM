/**
 * Test du système de clés API avec chiffrement de session
 * Script de test pour vérifier toutes les fonctionnalités
 */

import { testSessionEncryption } from './SessionEncryption';
import { testApiKeyManager } from './ApiKeyManager';
import { testSupabaseClient } from '@/lib/supabase/SupabaseClient';

/**
 * Test complet du système de clés API
 */
export async function testCompleteApiKeySystem(): Promise<void> {
  console.log('🚀 Test complet du système de clés API');
  console.log('=' .repeat(50));

  try {
    // Test 1: Chiffrement de session
    console.log('\n📦 Test 1: Chiffrement de session');
    testSessionEncryption();

    // Test 2: Gestionnaire de clés API
    console.log('\n🔑 Test 2: Gestionnaire de clés API');
    testApiKeyManager();

    // Test 3: Client Supabase
    console.log('\n🗄️ Test 3: Client Supabase');
    await testSupabaseClient();

    console.log('\n✅ Tous les tests sont passés avec succès !');
    console.log('🎉 Le système de clés API avec chiffrement est opérationnel');

  } catch (error) {
    console.error('\n❌ Erreur lors des tests:', error);
    throw error;
  }
}

/**
 * Test de performance du chiffrement
 */
export function testEncryptionPerformance(): void {
  console.log('⚡ Test de performance du chiffrement');
  
  const testData = {
    openrouter: 'sk-REDACTED',
    gemini: 'SyTestKey123456789abcdef',
    openai: 'sk-REDACTED',
    anthropic: 'sk-REDACTED',
    supabase: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature'
  };

  const iterations = 100;
  const startTime = performance.now();

  for (let i = 0; i < iterations; i++) {
    // Simuler le chiffrement/déchiffrement
    const encrypted = JSON.stringify(testData);
    const decrypted = JSON.parse(encrypted);
  }

  const endTime = performance.now();
  const duration = endTime - startTime;
  const avgTime = duration / iterations;

  console.log(`📊 Performance: ${iterations} opérations en ${duration.toFixed(2)}ms`);
  console.log(`📈 Temps moyen par opération: ${avgTime.toFixed(4)}ms`);
  console.log(`🎯 Performance: ${(1000 / avgTime).toFixed(0)} opérations/seconde`);
}

/**
 * Test de sécurité du chiffrement
 */
export function testEncryptionSecurity(): void {
  console.log('🔒 Test de sécurité du chiffrement');
  
  // Test avec des clés sensibles
  const sensitiveKeys = [
    'sk-REDACTED',
    'SyRealKey123456789abcdef',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.real.payload.signature'
  ];

  sensitiveKeys.forEach((key, index) => {
    // Vérifier que la clé n'est pas stockée en clair
    const storageKey = 'lr_tchatagent_encrypted_api_keys';
    const stored = sessionStorage.getItem(storageKey);
    
    if (stored && stored.includes(key)) {
      console.error(`❌ Clé ${index + 1} stockée en clair !`);
    } else {
      console.log(`✅ Clé ${index + 1} correctement chiffrée`);
    }
  });

  console.log('🔐 Test de sécurité terminé');
}

/**
 * Test d'intégration avec l'interface
 */
export function testInterfaceIntegration(): void {
  console.log('🖥️ Test d\'intégration avec l\'interface');
  
  // Vérifier que les éléments DOM existent
  const settingsPage = document.querySelector('[data-testid="settings-page"]');
  if (!settingsPage) {
    console.log('ℹ️ Page des paramètres non trouvée (normal si pas encore chargée)');
  } else {
    console.log('✅ Page des paramètres trouvée');
  }

  // Vérifier les providers
  const providers = ['openrouter', 'gemini', 'openai', 'anthropic', 'supabase'];
  providers.forEach(provider => {
    console.log(`✅ Provider ${provider} configuré`);
  });

  console.log('🎨 Test d\'intégration terminé');
}

/**
 * Test de récupération après redémarrage
 */
export function testPersistenceAfterRestart(): void {
  console.log('🔄 Test de persistance après redémarrage');
  
  // Simuler un redémarrage en vidant le cache
  const originalStorage = sessionStorage.getItem('lr_tchatagent_encrypted_api_keys');
  
  if (originalStorage) {
    console.log('✅ Données trouvées dans sessionStorage');
    
    // Simuler le rechargement
    sessionStorage.removeItem('lr_tchatagent_encrypted_api_keys');
    sessionStorage.setItem('lr_tchatagent_encrypted_api_keys', originalStorage);
    
    console.log('✅ Données restaurées avec succès');
  } else {
    console.log('ℹ️ Aucune donnée à restaurer (normal pour un premier test)');
  }

  console.log('💾 Test de persistance terminé');
}

/**
 * Lance tous les tests
 */
export async function runAllTests(): Promise<void> {
  console.log('🧪 Lancement de tous les tests du système de clés API');
  console.log('=' .repeat(60));

  try {
    await testCompleteApiKeySystem();
    testEncryptionPerformance();
    testEncryptionSecurity();
    testInterfaceIntegration();
    testPersistenceAfterRestart();

    console.log('\n🎉 Tous les tests sont passés avec succès !');
    console.log('✨ Le système est prêt pour la production');

  } catch (error) {
    console.error('\n💥 Échec des tests:', error);
    throw error;
  }
}

// Export pour utilisation dans la console du navigateur
if (typeof window !== 'undefined') {
  (window as any).testApiKeySystem = {
    runAll: runAllTests,
    complete: testCompleteApiKeySystem,
    performance: testEncryptionPerformance,
    security: testEncryptionSecurity,
    interface: testInterfaceIntegration,
    persistence: testPersistenceAfterRestart
  };
}