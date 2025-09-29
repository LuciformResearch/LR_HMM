import 'dotenv/config';
import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';

async function getAccessToken(): Promise<string> {
  const auth = new GoogleAuth({ 
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/generative-language.retriever'
    ] 
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token || !token.token) throw new Error('Failed to obtain access token for Vertex AI');
  return token.token;
}

async function main() {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
  const location = process.env.VERTEX_LOCATION || process.env.LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-flash';
  const embedModel = process.env.VERTEX_EMBED_MODEL || 'text-embedding-004';
  if (!project) throw new Error('Set PROJECT_ID or GOOGLE_CLOUD_PROJECT');

  const token = await getAccessToken();
  const base = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models`;

  // Test generateContent
  const genUrl = `${base}/${encodeURIComponent(model)}:generateContent`;
  const genPayload = {
    contents: [{ role: 'user', parts: [{ text: 'Dites bonjour en une phrase.' }] }],
    generationConfig: { maxOutputTokens: 64 }
  };
  const genRes = await fetch(genUrl, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(genPayload) });
  const genJson: any = await genRes.json();
  if (!genRes.ok) {
    console.error('Vertex generateContent error:', genJson);
    throw new Error(`generateContent failed: ${genRes.status}`);
  }
  const genText = genJson?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '(no text)';
  console.log('Vertex generateContent OK:', genText.slice(0, 80));

  // Test embedContent (using Generative Language API endpoint)
  const embUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(embedModel)}:embedContent`;
  const embPayload = { content: { parts: [{ text: 'Test embedding content for Vertex AI.' }] } };
  const embRes = await fetch(embUrl, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(embPayload) });
  const embJson: any = await embRes.json();
  if (!embRes.ok) {
    console.error('Vertex embedContent error:', embJson);
    throw new Error(`embedContent failed: ${embRes.status}`);
  }
  const dim = embJson?.embedding?.values?.length || embJson?.data?.embedding?.length || embJson?.data?.[0]?.embedding?.length;
  console.log('Vertex embedContent OK: dim=', dim);
}

main().catch(err => { console.error(err); process.exit(1); });

