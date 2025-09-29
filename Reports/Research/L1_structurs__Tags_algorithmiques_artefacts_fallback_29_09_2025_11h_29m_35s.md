title: "L1 structurés — Tags algorithmiques, artefacts, fallback"

# L1 structurés — Tags algorithmiques, artefacts, fallback

Date: 2025-09-29T11:29:35+02:00
Category: Research
Tags: hmm,l1,tags,artefacts,structured,fallback

## Contexte
## Contexte
Nous souhaitons enrichir les L1 avec une sortie optionnellement structurée (tags + artefacts référencés), tout en conservant le résumé court existant et en évitant les hallucinations/coûts. La cible: une extraction déterministe à partir des messages couverts par chaque L1 ("covers"), plus une option expérimentale XML avec fallback non structuré si parsing invalide.

## Objectifs
- Ajouter des **tags algorithmiques** fiables (3–8) basés sur le texte source couvert.
- Extraire une **liste d’artefacts** référençables: blocs de code, chemins de fichiers, commandes, URLs, avec indices/plages de lignes.
- Rendre la **sortie L1 structurée optionnelle** (flag), sans dégrader la génération du résumé.
- Prévoir un **fallback non structuré** si le mode XML (expérimental) échoue au parsing/validation.

## Changements / Analyses
### Tags (approche algorithmique, déterministe)
- Normalisation: lowercasing, suppression diacritiques, tokenisation mots/bi‑grammes (n=1..2), longueur min 3.
- Stoplist FR + domaine (mots fréquents, interjections, emojis, séparateurs).
- Filtrage lexical: ne retenir qu’un tag qui **apparaît dans la source** (messages couverts), case‑insensitive.
- Pondération simple (ranking): fréquence dans les messages couverts + boosts faibles si:
  - Mot TitleCase (nom propre),
  - Identifiant code plausible (`[a-zA-Z_][\w\-]{2,}`),
  - Termes présents dans des lignes marquées code/commandes/fichiers.
- Diversité: dédupe par racinisation légère; éviter bigrammes qui répètent trop des unigrams sélectionnés.
- Sortie: top‑K (K=3..8), stable et reproductible.

### Artefacts (détection déterministe)
- code_block: détection ```lang ... ```; champs: `lang`, `messageIndices`, `lineRanges` absolus (calculés via `lineStart/lineEnd`), `hash` du contenu.
- file_path: regex sur chemins relatifs/absolus avec extensions whitelist (`.ts, .tsx, .js, .py, .md, .sql, .json, .yml, .yaml, .sh, .toml, .env`, etc.), exclusion des URLs.
- command: lignes commençant par symbole prompt (`$`, `>`) ou blocs `bash/sh/zsh/shell`; liste des commandes (`npm`, `npx`, `git`, `docker`, `curl`, `psql`, etc.).
- url: schéma http(s) standard.
- Sortie: liste d’objets `{type, value/name, messageIndices, lineRanges, meta?}`.

### Modes de sortie L1
- Mode par défaut (recommandé): **structuré‑algo** — résumé L1 inchangé + `tags[]` + `artifacts[]` extraits par code; aucun appel LLM additionnel.
- Mode expérimental: **structuré‑xml** — demander au LLM un XML `<l1>` (summary/tags/entities/artefacts), parser via `LuciformXMLParser`. **Fallback**: si parsing/validation échoue (longueur, schema), on retourne la sortie **non structurée** (résumé seul) et on log l’erreur.

### Stockage et intégration
- Fichier: enrichir `artefacts/HMM/compressed/<slug>.l1.json` (par L1: `tags`, `artifacts`).
- DB: mapper `tags → topics` dans `summaries.topics`; stocker `artifacts` (et, si souhaité, `entities`) dans `summaries.meta JSONB` si la colonne existe; embeddings inchangés sur `summary`.
- Compatibilité: `context_compose.ts` peut exposer `tags` et référencer des artefacts dans l’artefact de contexte.

## Résultats / Prochaines étapes
- Implémenter `lib/extractors/artifacts.ts` (réutilisable) + hooks dans `compress_memory.ts` (flag `--structured true`).
- Étendre le schéma de la sortie L1: ajouter `tags[]`, `artifacts[]`, `errors?[]`.
- Mettre à jour `db_embed_l1.ts`: `topics` depuis `tags`; `meta` optionnel (`artifacts`).
- Ajouter mode `--structured-xml true` (expérimental) + parsing strict + logs + fallback.
- Script optionnel `scripts/structure_l1.ts` pour post‑traiter d’anciens `.l1.json`.

Décisions: prioriser le mode **structuré‑algo** (fiable/rapide). Activer le **XML** en second rideau pour évaluation; toujours conserver un **fallback** non structuré.
