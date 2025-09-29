title: "Accès Vertex AI — étapes, liens et configuration"

# Accès Vertex AI — étapes, liens et configuration

Date: 2025-09-28T11:20:30+02:00
Category: Research
Tags: vertexai,google-cloud,service-account,oauth,setup,docs

## Contexte
Nous voulons activer Vertex AI (Google Cloud) pour utiliser les endpoints génériques (generateContent, embedContent) et, si possible, un service de reranking managé. Contrairement à l'API Gemini (AI Studio) avec clé simple, Vertex AI utilise OAuth2 (compte de service) et des endpoints régionaux par projet GCP.

## Objectifs
1. Créer/configurer un projet GCP avec Vertex AI activé.
2. Créer un Service Account + clé JSON + rôles requis.
3. Poser les variables d’environnement (PROJECT_ID, LOCATION, GOOGLE_APPLICATION_CREDENTIALS) et tester.
4. Lister les liens officiels utiles (génération, embeddings, reranking).

## Changements / Analyses
Étapes concrètes:

1) Créer/choisir un projet GCP
- Console: https://console.cloud.google.com/
- Sélecteur de projet (ou « New Project »).

2) Activer l’API Vertex AI
- Bibliothèque d’API: https://console.cloud.google.com/apis/library/aiplatform.googleapis.com
- Cliquer « Enable ».

3) Créer un Service Account + clé JSON
- IAM & Admin → Service Accounts: https://console.cloud.google.com/iam-admin/serviceaccounts
- Créer un compte de service (nom/ID explicite), puis « Manage keys » → « Add key » → JSON.
- Conserver la clé JSON en local (chemin accessible par les scripts).

4) Attribuer les rôles nécessaires
- Rôle minimum recommandé pour appel aux modèles: « Vertex AI User » (roles/aiplatform.user).
- Selon usage stockage, ajouter si besoin « Storage Object Viewer ».

5) Définir les variables d’environnement
- GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/sa-key.json
- PROJECT_ID=<votre-projet> (ou GOOGLE_CLOUD_PROJECT)
- LOCATION=us-central1 (ou europe-west4, selon préférence)

6) Endpoints Vertex AI (REST) — patterns
- generateContent (Gemini):
  https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/{MODEL}:generateContent
- embedContent (text-embedding-004):
  https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/text-embedding-004:embedContent

7) Docs utiles (référence)
- Vertex AI Gemini (génération): https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/gemini
- Text Embeddings (004, dim=768): https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-text-embeddings
- RAG (recherche vectorielle, patterns): https://cloud.google.com/vertex-ai/generative-ai/docs/retrieval
- (Reranking) Voir « Re-ranking »/« Ranking » dans la doc Vertex AI et les cookbooks Gemini; l’option LLM-reranker custom via generateContent reste universelle. Les APIs managées de ranking peuvent varier selon région/disponibilité.

8) Test rapide dans ce repo
- Script: scripts/check_vertexai_access.ts
- Pré-requis: variables d’env ci-dessus.
- Commande: npx tsx scripts/check_vertexai_access.ts
- Attendu: « Vertex generateContent OK … » + « Vertex embedContent OK: dim=768 ».

## Résultats / Prochaines étapes
Résultat attendu:
- Une fois le test OK, je peux ajouter un flag --vertexai aux scripts (ex: rag_query.ts) pour utiliser Vertex AI au lieu de l’API Gemini (AI Studio) pour rerank/génération.

Prochaines étapes:
- Basculer le rerank LLM sur Vertex (auth GCP) quand l’accès est validé.
- Évaluer ensuite un service de ranking managé (si dispo) pour comparer latence/coût vs LLM-reranker custom.


*Rapport généré par new_report*
