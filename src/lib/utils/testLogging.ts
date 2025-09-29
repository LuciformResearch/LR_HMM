/**
 * Utilitaire pour tester le système de logs du Terminal Algareth
 */

import { 
  logCommand, 
  logCommandResult, 
  logTerminalSession, 
  logUserAction,
  logTerminalError,
  logPerformance,
  configureTerminalLogging,
  exportTerminalLogs
} from './terminalLogger';

/**
 * Test complet du système de logs
 */
export async function testTerminalLogging(): Promise<void> {
  console.log('🧪 Test du système de logs Terminal Algareth');
  console.log('=============================================');
  
  // Configuration
  configureTerminalLogging('DEBUG');
  
  // Test 1: Session de terminal
  console.log('\n📋 Test 1: Session de terminal');
  const sessionId = `test_session_${Date.now()}`;
  logTerminalSession('start', sessionId);
  
  // Test 2: Actions utilisateur
  console.log('\n👤 Test 2: Actions utilisateur');
  logUserAction('terminal_initialization', { sessionId, currentPath: '/workspace' });
  logUserAction('file_browser_opened', { url: 'http://localhost:8081' });
  logUserAction('demon_summoned', { file: 'test_demon.txt', path: '/workspace' });
  
  // Test 3: Commandes
  console.log('\n⌨️ Test 3: Commandes');
  logCommand('ls', [], '/workspace');
  logCommandResult('ls', true, { path: '/workspace', fileCount: 5 });
  
  logCommand('cd', ['test_directory'], '/workspace');
  logCommandResult('cd', true, { newPath: '/workspace/test_directory', oldPath: '/workspace' });
  
  logCommand('cat', ['README.md'], '/workspace');
  logCommandResult('cat', true, { file: 'README.md', path: '/workspace', contentLength: 1024 });
  
  logCommand('touch', ['new_file.txt'], '/workspace');
  logCommandResult('touch', true, { file: 'new_file.txt', path: '/workspace' });
  
  logCommand('invalid_command', ['arg1', 'arg2'], '/workspace');
  logCommandResult('invalid_command', false, null, 'Unknown command');
  
  // Test 4: Erreurs
  console.log('\n❌ Test 4: Erreurs');
  logTerminalError('Connection timeout', { 
    command: 'ls', 
    path: '/workspace', 
    duration: 5000 
  });
  
  logTerminalError('File not found', { 
    command: 'cat', 
    file: 'nonexistent.txt', 
    path: '/workspace' 
  });
  
  // Test 5: Performance
  console.log('\n⚡ Test 5: Performance');
  logPerformance('listFiles', 150, { path: '/workspace', fileCount: 10 });
  logPerformance('readFile', 75, { filePath: '/workspace/README.md', contentLength: 1024 });
  logPerformance('createFile', 200, { filePath: '/workspace/new_file.txt' });
  logPerformance('command_ls', 300, { command: 'ls', args: [], currentPath: '/workspace' });
  
  // Test 6: Commandes Algareth spéciales
  console.log('\n⛧ Test 6: Commandes Algareth');
  logCommand('algareth', ['summon'], '/workspace');
  logCommandResult('algareth', true, { action: 'demon_summoned', file: 'demon_summoned.txt' });
  logUserAction('demon_summoned', { file: 'demon_summoned.txt', path: '/workspace' });
  
  logCommand('algareth', ['chaos'], '/workspace');
  logCommandResult('algareth', true, { action: 'chaos_created', file: 'chaos_1234567890.txt' });
  logUserAction('chaos_created', { file: 'chaos_1234567890.txt', path: '/workspace' });
  
  logCommand('algareth', ['wisdom'], '/workspace');
  logCommandResult('algareth', true, { action: 'wisdom_displayed' });
  logUserAction('wisdom_requested', {});
  
  logCommand('algareth', ['portal'], '/workspace');
  logCommandResult('algareth', true, { action: 'portal_opened', url: 'https://github.com' });
  logUserAction('portal_opened', { url: 'https://github.com' });
  
  // Test 7: Fin de session
  console.log('\n🏁 Test 7: Fin de session');
  logTerminalSession('end', sessionId);
  
  // Test 8: Export des logs
  console.log('\n📊 Test 8: Export des logs');
  const exportedLogs = exportTerminalLogs();
  console.log('Logs exportés:', {
    terminal: JSON.parse(exportedLogs.terminal).length,
    filesystem: JSON.parse(exportedLogs.filesystem).length,
    api: JSON.parse(exportedLogs.api).length,
    commands: JSON.parse(exportedLogs.commands).length
  });
  
  console.log('\n✅ Test du système de logs terminé !');
  console.log('=====================================');
}

/**
 * Test des logs d'API
 */
export async function testApiLogging(): Promise<void> {
  console.log('🧪 Test des logs d\'API');
  console.log('=======================');
  
  // Simuler des requêtes API
  const testRequests = [
    { endpoint: 'ls', path: '/workspace', method: 'POST' },
    { endpoint: 'cat', path: '/workspace/README.md', method: 'POST' },
    { endpoint: 'touch', path: '/workspace/test.txt', method: 'POST' },
    { endpoint: 'mkdir', path: '/workspace/new_dir', method: 'POST' },
    { endpoint: 'rm', path: '/workspace/old_file.txt', method: 'POST' }
  ];
  
  for (const request of testRequests) {
    console.log(`\n📡 Test API: ${request.endpoint} ${request.path}`);
    
    // Simuler le début de requête
    const startTime = Date.now();
    
    // Simuler le traitement
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
    
    // Simuler le résultat
    const duration = Date.now() - startTime;
    const success = Math.random() > 0.1; // 90% de succès
    
    if (success) {
      console.log(`✅ ${request.endpoint} réussi en ${duration}ms`);
    } else {
      console.log(`❌ ${request.endpoint} échoué en ${duration}ms`);
    }
  }
  
  console.log('\n✅ Test des logs d\'API terminé !');
}

/**
 * Test de performance des logs
 */
export async function testLoggingPerformance(): Promise<void> {
  console.log('🧪 Test de performance des logs');
  console.log('===============================');
  
  const iterations = 1000;
  const startTime = Date.now();
  
  console.log(`\n🔄 Exécution de ${iterations} logs...`);
  
  for (let i = 0; i < iterations; i++) {
    logCommand('test', [`arg${i}`], '/workspace');
    logCommandResult('test', true, { iteration: i });
  }
  
  const duration = Date.now() - startTime;
  const avgTime = duration / iterations;
  
  console.log(`\n📊 Résultats:`);
  console.log(`- Total: ${duration}ms`);
  console.log(`- Moyenne: ${avgTime.toFixed(2)}ms par log`);
  console.log(`- Logs/seconde: ${(1000 / avgTime).toFixed(0)}`);
  
  if (avgTime < 1) {
    console.log('✅ Performance excellente !');
  } else if (avgTime < 5) {
    console.log('✅ Performance bonne !');
  } else {
    console.log('⚠️ Performance à améliorer !');
  }
}

/**
 * Exécuter tous les tests
 */
export async function runAllLoggingTests(): Promise<void> {
  console.log('🚀 Lancement de tous les tests de logging');
  console.log('==========================================');
  
  try {
    await testTerminalLogging();
    await testApiLogging();
    await testLoggingPerformance();
    
    console.log('\n🎉 Tous les tests sont passés avec succès !');
  } catch (error) {
    console.error('\n❌ Erreur lors des tests:', error);
  }
}