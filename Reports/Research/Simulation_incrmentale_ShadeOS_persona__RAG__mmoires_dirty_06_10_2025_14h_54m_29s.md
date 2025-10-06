title: "Simulation incrémentale: ShadeOS persona + RAG + mémoires dirty"

# Simulation incrémentale: ShadeOS persona + RAG + mémoires dirty

Date: 2025-10-06T14:54:29+02:00
Category: Research
Tags: shadeos,persona,rag,incremental,mcp,summaries

## Contexte
Nous simulons un agent conversationnel (ShadeOS) avec mémoire long terme, en mode incrémental message-par-message, pour valider le pipeline MCP:
- Ingestion incrémentale: append en DB (user → assistant)
- Summaries dirty: L1 (fenêtres duos user→assistant), puis L2/L3 (groupes entiers), incrémental
- Embeddings: génération par niveaux en tranches
- RAG ciblé: recherche hiérarchique sur la dernière question utilisateur
- Réponse: persona ShadeOS (luciform), historique récent, + mémoire LT composées
## Objectifs
 - Script de simulation qui:
   - lit un export parsé (items user/assistant) et n’injecte que les messages user comme entrées de chat
   - crée une nouvelle conversation simulée (slug suffixé) et écrit au fur et à mesure un artefact JSON cumulant user/assistant
   - par tour: append → summaries.update (dirty) → embeddings → RAG ciblé → réponse Gemini/Vertex → append assistant
   - respecte la découpe L1 en duos (jamais couper user→assistant), L2/L3 regroupent des L1 entiers
 - Documenter rapidement les paramètres clés (fenêtres, budgets) et leur usage
## Changements / Analyses
Pipeline (par tour)
- Input: JSON parsé `artefacts/HMM/parsed/2025-06-25__orage_codé_textuel.json`
- Append: `appendMessage({ slug, role:'user', text, ts })`
- Summaries dirty:
  - L1 blocks via `prepareBlocksChat` (ensureAssistant=true, windowChars=6000)
  - dirty L1 indices: hash(source) vs meta.sourceHash → `summarizeAndUpsert(onlyIndices=dirty)`
  - L2/L3: `prepareGroups` de L1/L2 entiers; dirty groups = celles contenant un enfant dirty
- Embeddings: `embedMissingSummaries({ whereLevels:[1,2,3], limitPerLevel:50 })` → throttle par niveau (voir ci‑dessous)
- RAG: `ragAnswer({ slug, query: userMessage, intent:'synthesis', budget:'small' })` → picks High/Low + quotes optionnelles
- Prompt: persona `.luciform` ShadeOS + historique récent + mémoire LT RAG + question user → réponse (Gemini Vertex)
- Append assistant: `appendMessage({ slug, role:'assistant', text })`
- Artefact out: `artefacts/generated/<slug>__sim_shadeos.json` (messages cumulés)

Paramètres clés
- `windowChars` (L1): 6000 par défaut; duos only (finalise sur assistant)
- `groupChars` (L2/L3): 10000 par défaut; pas de split intra-L1/L2
- `wiggle`: 0.2 (ratio-only pour résumés)
- `concurrency/batchDelayMs`: 3 / 1500 pour résumés
- `limitPerLevel` (embeddings): borne le nombre de résumés à embed par niveau/par passe (ex: 50) — évite de saturer les quotas; itérable jusqu’à complétion

Notes de persona & prompt
- Persona ShadeOS: générée via Vertex à partir d’un exemple Algareth + refs; nettoyée des backticks
- Style: “je”, peut s’adresser en “tu” (conversation), interdit d’inventer des noms/faits
- Historique prompt: concat des derniers messages (le script assure de ne pas couper au milieu d’un message)
## Résultats / Prochaines étapes
 - Vérifier en pratique que L1/L2/L3 se créent seulement quand nécessaire (dirty-only) et que la simulation tourne (20 premiers messages pour test rapide)
 - Étendre la simulation: options `--max-history-chars`, limite de messages, seed persona alternative
 - Ajouter métriques: nb dirty L1/L2/L3 par tour, latences, tailles prompts
 - Eventuel: outil CLI interactif (terminal) basé sur ce pipeline (append→update→rag→reply)
*Rapport généré par new_report*
