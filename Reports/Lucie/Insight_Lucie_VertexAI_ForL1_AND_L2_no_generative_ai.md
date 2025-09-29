ya une librairie officielle pour utiliser vertexai  en typescript?
ChatGPT a dit :

Oui — il y a des librairies “officielles” (ou semi-officielles, selon ton degré de tolérance aux bêtas) pour utiliser Vertex AI / Gemini en TypeScript / JavaScript.

Voici ce que j’ai pu trouver :

Librairies existantes

@google-cloud/vertexai
C’est la librairie client Node.js (JavaScript / TypeScript) pour Vertex AI. 
Google Cloud
+1

Mais : elle est dépréciée (à partir du 24 juin 2025) et sera supprimée le 24 juin 2026. 
GitHub

@google/genai
Nouvelle librairie (recommandée) pour interagir avec les modèles Gemini / Vertex AI (et unifier l’accès au Gemini Developer API + Vertex). 
Google AI for Developers
+4
Google Cloud
+4
Google AI for Developers
+4

Elle supporte TypeScript / JavaScript. 
GitHub
+2
Google Cloud
+2

Exemple d’usage pour Vertex AI dans cette librairie :

import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  vertexai: true,
  project: 'mon-projet',
  location: 'europe-west1',  // ou la région que tu utilises
});

const resp = await ai.models.generateContent({
  model: 'gemini-2.0-flash',
  contents: 'Explique-moi ChatGPT vs Gemini'
});
console.log(resp.text);


@google-cloud/aiplatform
Cette librairie fait partie de l’ancienne gamme “Google Cloud Client Libraries” pour la plateforme AI (Vertex). 
npm
+2
Google Cloud
+2

Elle couvre des services généraux de Vertex AI (modèles, endpoints, dataset, etc.).
Elle ne remplace pas nécessairement toute la partie “générative / Gemini” si tu veux l’interface la plus moderne.

@ai-sdk/google-vertex
C’est un fournisseur pour le “AI SDK” (par Vercel ou un projet d’écosystème AI) qui supporte Vertex AI comme “provider”. 
ai-sdk.dev
+1

Si tu utilises cet “AI SDK” (qui unifie plusieurs modèles/providers), ça peut être “officiel assez” pour ton usage.

Ce que je recommande (et ce que je ferais, parce que oui, je dois t’orienter)

Si j’étais à ta place :

Je commencerais par @google/genai — c’est la librairie “future” que Google pousse pour Gemini / Vertex AI.

En parallèle je garderais un œil sur @google-cloud/aiplatform si tu as besoin d’utiliser des fonctions non encore couvertes dans @google/genai.

Évite de repartir sur @google-cloud/vertexai, vu qu’elle va être supprimée.

Si tu veux, je peux te générer un “starter kit” en TypeScript (template de code) avec l’une de ces librairies pour démarrer vite fait. Tu veux ça ?

Vous avez dit :
sauf qu'a priori pour vertexai on avait besoin d'un json pour utiliser un compte de service, c'est possible avec la lib genai de setup ça?
ChatGPT a dit :

Exact, pour Vertex AI tu n’échappes pas au bon vieux JSON de compte de service (les clés qui traînent toujours dans un coin du disque, comme un grigri d’admin).

La bonne nouvelle : la lib @google/genai supporte ça, mais pas en mode magique comme sur d’autres SDKs.
Il y a deux façons de faire :

1. Laisser Google s’occuper de l’auth

Si ton environnement a déjà la variable d’env GOOGLE_APPLICATION_CREDENTIALS pointant vers le .json du service account, la lib @google/genai va l’utiliser sans broncher.

export GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"


Et ton code TypeScript reste simple :

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  vertexai: true,
  project: "mon-projet",
  location: "europe-west1",
});

const resp = await ai.models.generateContent({
  model: "gemini-2.0-flash",
  contents: "Coucou Vertex depuis mon compte de service",
});

console.log(resp.response.text);

2. Charger la clé JSON toi-même (plus explicite)

Tu peux aussi parser le JSON et filer les creds à la main avec GoogleAuth (venant de google-auth-library).

import { GoogleGenAI } from "@google/genai";
import { GoogleAuth } from "google-auth-library";

const auth = new GoogleAuth({
  keyFile: "/path/to/key.json",
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

const client = new GoogleGenAI({
  vertexai: true,
  project: "mon-projet",
  location: "europe-west1",
  auth, // <- on injecte explicitement
});

const resp = await client.models.generateContent({
  model: "gemini-2.0-flash",
  contents: "Hello depuis service account JSON",
});

console.log(resp.response.text);


Donc oui, tu peux setup avec le JSON, soit par la voie paresseuse (GOOGLE_APPLICATION_CREDENTIALS), soit en mode code explicite avec GoogleAuth.

Tu veux que je te prépare un exemple plus complet genre starter repo minimal en TS (avec package.json, tsconfig, un appel Gemini Vertex prêt à tourner) ?



Lucie: je voudrais que tu installe cette lib, @google/genai, et que le prompting se fasse directement dans le script compress_memory des l1, comme fait dans les l2, presque de la meme maniere au possible, pour voir si on peut abstractiser plus tard, et éviter complétement l'ancienne voie google-generativeai, ainsi que l'usage de summarisationagent, meme si on peut reprendre plus ou moins son prompt