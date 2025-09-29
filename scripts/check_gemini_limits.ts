import 'dotenv/config';
import fetch from 'node-fetch';

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  if (!apiKey) {
    console.error('GEMINI_API_KEY not found in environment (.env).');
    process.exit(1);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(apiKey)}`;
  console.log(`Querying model metadata: ${model}`);
  try {
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();
    if (!res.ok) {
      console.error('Error response from API:', data);
      process.exit(2);
    }
    // Known fields may include token limits depending on API version
    // Print generic info and any limits found
    console.log(JSON.stringify(data, null, 2));

    const maybeLimits = {
      inputTokenLimit: (data as any).inputTokenLimit,
      outputTokenLimit: (data as any).outputTokenLimit,
      contextWindow: (data as any).contextWindow,
    };
    console.log('\nExtracted limits (if present):');
    console.log(maybeLimits);
  } catch (err) {
    console.error('Failed to fetch model metadata:', err);
    process.exit(3);
  }
}

main();

