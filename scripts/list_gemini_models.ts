import 'dotenv/config';
import fetch from 'node-fetch';

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not found in .env');
    process.exit(1);
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      console.error('Error:', data);
      process.exit(2);
    }
    const models = (data.models || []).map((m: any) => ({
      name: m.name,
      displayName: m.displayName,
      inputTokenLimit: m.inputTokenLimit,
      outputTokenLimit: m.outputTokenLimit,
      supportedGenerationMethods: m.supportedGenerationMethods,
    }));
    // Show text generation-capable models first
    const textModels = models.filter(m => (m.supportedGenerationMethods || []).includes('generateContent'));
    console.log('Models supporting generateContent:');
    for (const m of textModels) console.log(`- ${m.name} (${m.displayName || ''})`);
    console.log('\nAll models:');
    for (const m of models) console.log(`- ${m.name} (${m.displayName || ''})`);
  } catch (e) {
    console.error('Failed to list models:', e);
    process.exit(3);
  }
}

main();

