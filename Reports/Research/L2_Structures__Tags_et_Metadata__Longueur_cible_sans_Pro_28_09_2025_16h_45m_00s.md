title: "L2 structurés — Tags & Metadata, longueur 900–1200 sans Pro"

# L2 structurés — Tags & Metadata, longueur 900–1200 sans Pro

Date: 2025-09-28T16:45:00+02:00
Category: Research
Tags: hmm,rag,l2,structured,metadata,tags,gemini,vertex,flash,context

## Objectif
Produire des méta‑résumés L2 plus longs (900–1200 caractères, min 900) avec Gemini « flash » (sans recourir à « pro »), et structurer la sortie en JSON enrichi (tags, métadonnées libres) pour améliorer la recherche contextuelle et le reranking.

## Faisabilité — Longueur 900–1200 sans Pro
- Oui, sous conditions:
  - Augmenter le budget de génération: `--max-output-tokens 4096` (compense les « pensées » internes non visibles qui consomment des tokens).
  - Réduire la taille d’entrée par groupe: `--group-size 4–6` pour limiter `promptTokenCount` et éviter `finishReason=MAX_TOKENS`.
  - Prompt contraint: exiger explicitement « 900–1200 caractères, 5–7 phrases complètes » avec température basse (0.2–0.3).
  - Timeout plus long: `--call-timeout-ms 30000`.
  - Vérifier systématiquement `usageMetadata` pour détecter les coupures (« MAX_TOKENS ») et relancer si besoin.

## Pourquoi des résultats trop courts apparaissaient
- Les réponses étaient tronquées par « MAX_TOKENS » (voir `usageMetadata`), dues à un budget de génération trop faible et à un coût « pensées » (thoughtsTokenCount) élevé. L’augmentation de `maxOutputTokens` a supprimé le problème.

## Sortie Structurée — Proposition de Schéma
Objectif: fournir à la pipeline RAG des signaux supplémentaires pour la recherche, le filtrage et le rerank.

```json
{
  "summary": "string (900–1200 chars)",
  "tags": ["string"],               // 5–12 tags courts (mots/bi‑grammes)
  "entities": {                      // entités optionnelles
    "persons": ["Lucie", "Klymäiôn"],
    "artifacts": ["klymaion_daemon.py", "QR code"],
    "places": ["—"],
    "times": ["minuit", "00:12", "00:14"]
  },
  "signals": {                       // libre: LLM stocke ce qui aide au rappel
    "themes": ["mémoire fractale", "daemon", "rituel"],
    "timeline": [ {"t":"00:12","event":"accélération"}, {"t":"00:14","event":"nommage Klymäiôn"} ],
    "style": "poétique/mystique",
    "confidence": 0.82
  }
}
```

Notes:
- `summary` reste la source de vérité pour l’indexation sémantique; `tags`, `entities`, `signals` sont des aides facultatives.
- On peut mapper `tags → topics` (TEXT[]) dans la DB et stocker le reste en JSONB `meta` (migration à prévoir) ou en artefacts.

## Prompt Design — Exemple (L2)
Contraintes: 900–1200 caractères, JSON strict, aucune prose hors JSON.

```
Tu es un assistant de résumé. Lis les résumés L1 et produis un JSON strict:
{
  "summary": "900–1200 caractères, 5–7 phrases complètes, factuel, sans invention",
  "tags": ["5–12 mots/bi‑grammes utiles au rappel"],
  "entities": {
    "persons": [], "artifacts": [], "places": [], "times": []
  },
  "signals": { "themes": [], "timeline": [], "style": "...", "confidence": 0.xx }
}
N’écris rien d’autre que le JSON. Documents:
---
... (L1 #1)
---
... (L1 #2)
---
```

Paramètres recommandés: température 0.2–0.3; `maxOutputTokens 4096`; `group-size 4–6`; timeout 30s.

## Parsing/Validation
- Valider la sortie via un parseur strict (ex: JSON.parse puis validation de schéma minimal: `summary` string >= 900; `tags` array <= 12).
- En cas d’échec: log complet (prompt, sortie brute, JSON brut Vertex) et échouer (pas d’heuristique silencieuse par défaut). Option `--allow-heuristic-fallback true` uniquement pour tests.

## Utilisation des Tags/Metadata dans RAG
- Tags: utilisés comme filtres souples (boost BM25 / re‑ranking lexical), pas comme vérité absolue.
- Entities/Times: enrichir les facettes (ex: rechercher par nom d’entité, ou par marqueurs temporels « minuit », « 00:14 »).
- Signals (libre): laisser le LLM stocker timeline ou thèmes; utile pour l’interface d’analyse et des requêtes dirigées.
- Indexation: ne pas concaténer `tags/signals` dans le texte d’embedding (risque de drift). Stocker séparément et combiner au moment du rerank.

## Étendre à L1 — Avis
- Oui pour des champs légers (ex: `tags` + `entities.times`) afin d’améliorer le rappel fin des passages, mais rester frugal:
  - L1 a un budget court → ajouter trop de structure peut dégrader la qualité du résumé.
  - Recommandation: activer en option, avec un prompt court; valider strictement; pondérer faiblement les tags L1 dans le rerank.

## Risques & Mitigations
- Hallucinations de tags/entités: limiter le nombre, imposer « extraire des mots présents dans les L1 ». Faire un check lexical (tous les tags doivent apparaître dans le texte source) quand possible.
- Variance de longueur: imposer min 900, max 1200, budget tokens élevé; si `MAX_TOKENS` dans `usageMetadata`, relancer en réduisant la taille de groupe.
- JSON cassé: capturer la sortie brute et le JSON Vertex; si invalide → échouer avec log (pas d’auto‑réparation silencieuse).

## Implémentation (proposée)
1) `compress_memory_l2.ts`
   - Changer le prompt pour sortie JSON structurée.
   - Ajouter `--min-summary 900 --max-summary 1200 --max-output-tokens 4096 --group-size 4..6`.
   - Parser/valider le JSON; stocker artefact L2 structuré.
2) `db_embed_l2.ts`
   - Stocker `summary` comme aujourd’hui; remplir `topics` à partir de `tags`.
   - (Optionnel) Migration DB pour ajouter `summaries.meta JSONB` et y ranger `entities/signals`.
3) `context_compose.ts`
   - Lire `l2` structuré; exposer `tags/entities/signals` dans l’artefact de contexte (sans les mélanger dans le texte d’embedding).
   - Utiliser `tags` comme boost lexical au moment du rerank (pondération faible).
4) (Option) L1 structuré
   - Flag `--structured true` dans `compress_memory.ts` pour produire `tags` minimalistes (3–6) + `times`.

## Commandes suggérées (exemple)
```
npx tsx scripts/compress_memory_l2.ts \
  --slug 2025-06-25__orage_codé_textuel \
  --group-size 4 \
  --min-summary 900 --max-summary 1200 \
  --vertexai true --model gemini-2.5-flash --fallback-model gemini-2.5-pro \
  --max-output-tokens 4096 --call-timeout-ms 30000 --log
```

## Avis critique & Conclusion
- Structurer L2 est utile: les `tags/entities/signals` enrichissent la recherche et la navigation sémantique sans alourdir le texte d’embedding.
- Rester sobre côté L1: quelques tags OK, mais prioriser la qualité du résumé court.
- Ne pas confondre signaux LLM et vérité: utiliser ces champs pour le rerank/filtrage, pas pour la décision finale.
- Mesurer: journaliser systématiquement longueur, finishReason, et taux d’utilisation du budget; ajuster `group-size` et `max-output-tokens` en conséquence.

Cette approche améliore la qualité du rappel et la contextualisation, tout en gardant le contrôle des budgets et de la robustesse.

