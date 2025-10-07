title: "Simulation mixte: assistant parsed + Ollama (économie quotas)"

# Simulation mixte: assistant parsed + Ollama (économie quotas)

Date: 2025-10-06T15:36:16+02:00
Category: Research
Tags: simulation,parsed,ollama,rag,logs,diagnostics

## Contexte
Valider la chaîne incrémentale (append → L1/L2/L3 dirty → embeddings → RAG → réponse) tout en maîtrisant les coûts: deux modes de réponse assistant.
1) Réponse simulée depuis l'export parsé (assistant "ShadeOS" historique).
2) Réponse générée (Ollama gemma2:2b ou autre) avec persona.
## Objectifs
 - Permettre un run rapide sans modèle (assistant parsed) pour vérifier la création du premier L1 (duo complet), et la propagation vers L2/L3.
 - Offrir un mode mixte pour ne requêter un LLM qu’une fraction du temps (ex: 1 tour sur 5), quand le RAG est disponible.
 - Améliorer la journalisation: logs horodatés complets dans `artefacts/logs/`.
## Changements / Analyses
 - Simulation
   - `--assistant-mode parsed|ollama|vertex` (nouveau):
     - `parsed`: prend la prochaine réponse assistant du JSON en cours → append DB; pas d’appel LLM.
     - `ollama`: prompt persona + historique + mémoire LT → appel Ollama.
     - `vertex`: génération via @google/genai si voulu.
  - `--post-append-update true` (défaut): après append assistant, relance un update pour sceller le L1 immédiatement.
  - `--skip-rag-until-l1 true` (défaut): tant qu’aucun L1 n’existe, pas de RAG; on n’utilise que l’historique.
  - Mixte (proposé): `--assistant-mode mixed` + `--mix-period 5` (à ajouter): si RAG dispo et `(turnIndex % mixPeriod == 0)` → utiliser Ollama, sinon `parsed`.
  - Reset conversation (proposé): `--reset-conv true` (à ajouter): supprime la conversation simulée (slug `__sim_shadeos`) avant le run pour un état DB propre.

 - Logs (artefacts/logs/<slug>__sim_shadeos_<ts>.log)
   - `dirty.l1.count`, `dirty.l2.groups`, `dirty.l3.groups` par tour
   - `update.done dt=...ms`
   - `embed.inserted.total=... perLevel={...} dt=...ms`
   - `rag.diagnostics={...} dt=...ms` ou `rag.skipped=noL1`
  - `chatgen.mode=parsed` ou `chatgen.model=... useOllama=... dt=...ms len=...`
  - (proposé) `db.upsert.messageId=... summaryIds=[...]` pour tracer précisément ce qui a été ajouté en DB
  - (proposé) `prompt.size.chars=...` pour suivre la taille des prompts envoyés
  - (Artefact JSON réécrit au début de chaque run pour éviter la confusion)

 - RAG prudent
   - Tant qu’aucun L1 n’existe, inutile de payer un RAG: l’historique suffit pour amorcer l’assistant.
   - Une fois L1 dispo: RAG activé; pour le mode mixte, n’activer qu’occasionnellement pour réduire le coût.
## Résultats / Prochaines étapes
 - Implémenter `--assistant-mode mixed` avec un modulo configurable (ex: `--mix-period 5`).
 - Implémenter `--reset-conv` pour réinitialiser proprement la conversation simulée.
 - Enrichir les logs avec les IDs insérés en DB (messages/summaries) et la taille des prompts envoyés.
 - Documenter dans README les modes de simulation et les meilleures pratiques de timeout (RTX 2070 gemma2:2b: ~9.5s p95 → 20–30s timeout; 7B: 30–45s).
*Rapport généré par new_report*
