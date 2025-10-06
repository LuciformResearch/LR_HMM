title: "Summaries.Update: Incremental Windows and Hierarchical Dirty Rebuild"

# Summaries.Update: Incremental Windows and Hierarchical Dirty Rebuild

Date: 2025-10-06T11:34:37+02:00
Category: Research
Tags: summarization,incremental,hierarchy,rag,mcp,memory

## Contexte
Objectif: définir une stratégie opérationnelle pour `summaries.update` dans le serveur MCP LR‑HMM afin de gérer des contextes de chat longs avec ingestion incrémentale message‑par‑message et (re)construction hiérarchique L1→Lk. Contraintes: robustesse (idempotence, cohérence temporelle), latence faible (UX), budgets contrôlés (RAG), et extensibilité (multi‑tenant, batch migrations).
## Objectifs
 - Définir quand et comment construire/mettre à jour L1 (fenêtres glissantes, scellement de blocs, tolérances).
 - Définir le regroupement L2/L3 (budgets chars, hystérésis, dirty‑propagation).
 - Définir la politique “dirty” (marquage, planification, backpressure) et l’ordre de priorité.
 - Spécifier les paramètres exposés par `summaries.update` (DX) et leur défauts sûrs.
 - Couvrir les cas limites (messages longs, duplications covers, flush temporel) et l’alignement DB (range_*, created_at).
## Changements / Analyses
Proposition de politique hiérarchique incrémentale

1) L1 — Fenêtres glissantes “seal‑once, grow‑last”
- Principe: on séquence la conversation en blocs L1 construits à la volée à partir des messages; un seul bloc “en cours” accepte de la croissance; les blocs “scellés” sont immuables (sauf maintenance ciblée).
- Paramètres clés:
  - `windowChars` (def: 6000): taille cible de fenêtre (≈ L1 input). Référence: scripts/compress_memoryv2.ts utilisait 4000; 6000 offre plus d’inertie avec Flash/004.
  - `minFlushChars` (def: 3000): si l’on atteint une pause (silence long/timebox) ou une fin logique avant `windowChars`, on peut sceller si ≥ ce seuil.
  - `overlapChars` (def: 0): par défaut 0 pour éviter la dérive de covers; optionnellement 200–400 si l’on souhaite une redondance douce (au prix d’un re‑coverage partiel).
  - `wiggle` (def: ±20%): tolérance qui évite des re‑générations inutiles (ex: sceller à 4800–7200 chars autour de 6000).
  - `ratioOnly` (def: true): on travaille en “ratio‑only” côté `unified` pour simplifier la cible et accepter de légères variations.
- Construction (spécifique chat: pas de coupe au milieu des duos):
  - On accumule les messages (concat text) dans le bloc courant jusqu’à atteindre `windowChars`±`wiggle` → sceller et générer L1 (avec covers = indices messages).
  - Si un message unique dépasse `windowChars`, on “slice” au sein du message en plusieurs fragments L1 consécutifs (covers contiendront le même `idx` sur plusieurs blocs — acceptable).
  - Politique duo (comme `prepareBlocksChat` dans unified): on ne finalise un bloc que si le dernier tour est `assistant` (ensureAssistant=true par défaut). Concrètement, on prend le maximum de duos user→assistant compatibles avec `windowChars`. Tant que l’`assistant` n’a pas répondu, on continue à accumuler.
  - Flush temporel: si `gapMs` entre deux messages > `flushAfterMs` (def: 20 min) et que `charCount` ≥ `minFlushChars`, on scelle le bloc — idéalement après une réponse `assistant`; sinon, on attend le prochain `assistant` (ou on autorise un override explicite en cas de clôture session).
- Idempotence & indices:
  - `messages.idx` = index global par conversation (assuré par DB); les covers L1 référencent ces `idx`.
  - Seul le dernier bloc L1 peut être ré‑écrit (croissance). Les blocs scellés ne bougent pas, ce qui stabilise les indices L2/L3.
- Embeddings:
  - Embedding L1 post‑génération (en tâche de fond). Si quota/taux limite, on enfile et on backoff.

2) L2 (et L3) — Regroupement par budget caractères avec hystérésis
- Principe: regrouper des L1 adjacents en “groupes” somme chars ≈ `groupChars` (def: 10000) avec tolérance (±20%).
- Déclencheur:
  - À chaque nouveau L1 scellé: marquer le groupe L2 affecté (ou créer un nouveau groupe si dépassement) comme “dirty”.
  - “Dirty propagation”: si un groupe L2 change (split/merge), marquer le L3 parent “dirty”.
- Hystérésis:
  - On évite d’osciller en autorisant la tolérance; on ne re‑packe pas rétroactivement les groupes scellés sauf dépassement fort (ex: +50%).
  - Stratégie “append‑only”: les nouveaux L1 remplissent le dernier groupe L2; si pleine, on scelle le groupe et on en initie un nouveau.
- Génération:
  - L2/L3 s’exécutent en arrière‑plan (priorité basse) avec `concurrency` et `batchDelayMs` paramétrables.
  - Ratio‑only (ex: 0.10) comme L1, pour cohérence; on garde la structure (tags/entities/extras) activée pour les niveaux ≥L2.

3) Politique “dirty” et ordonnanceur
- Dirty marking:
  - L1: seuls les blocs “en cours” sont dirty; un scellé ne redevient dirty que lors d’une opération de maintenance explicite (ex: recompression).
  - L2/L3: un groupe devient dirty si un membre L1 change, si ajout de L1 au groupe, ou si fusion/scission du groupe.
- Ordonnancement:
  - Priorité: L1 (premier), puis L2, puis L3…
  - Backpressure: limiter `concurrency` (def: 3) et `batchDelayMs` (def: 1500) pour respecter les providers; file d’attente FIFO par conversation.
  - Reprises: chaque exécution loggée avec un `jobId` (timestamp), redémarrable; idempotence assurée côté DB (hash contenu).

4) Paramètres exposés par `summaries.update`
- Signature (proposée):
  - `summaries.update({ slug, strategy: 'incremental'|'full', level?: 1|2|3, windowChars?: number, minFlushChars?: number, overlapChars?: number, groupChars?: number, wiggle?: number, ratioOnly?: boolean, concurrency?: number, batchDelayMs?: number, sealPolicy?: 'time'|'chars'|'hybrid', flushAfterMs?: number })`
- Défauts sûrs:
  - `strategy='incremental'`, `level` non‑spécifié = tous niveaux (L1 sync foreground, L2/L3 background)
  - `windowChars=6000`, `minFlushChars=3000`, `groupChars=10000`, `wiggle=0.2`, `ratioOnly=true`
  - `concurrency=3`, `batchDelayMs=1500`, `sealPolicy='hybrid'`, `flushAfterMs=20min`

5) Cas limites & décisions
- Messages très longs: slicing intra‑message en conservant `covers` avec le même `idx` (répété). Impact RAG limité (L1 restent indépendants).
- Redondance/overlap: par défaut off; si on active, bornée (≤400 chars) pour ne pas perturber les covers.
- Maintenance/scellage rétroactif: éviter par défaut; autoriser un mode `strategy='full'` pour re‑compacter L1 (ex: cible différente).
- Alignement temporel: `range_*` pour L1 calculé min/max des ts messages couverts; L2/L3 min/max des L1 couverts. `created_at` calé sur max ts couvert (cohérence récence).
- DX/Logs: tracer `summaries.update` (début/fin, nb L1/L2 générés, latences) + diagnostics (taux dirty, files d’attente).

6) Intégration RAG & Embeddings
- Embeddings: L1 toujours prioritaire; L2/L3 en fond. Mettre des quotas par minute.
- RAG: fonctionne même si L2/L3 pas encore prêts; la drill Lk→L1 ne s’exécute que si Lk disponibles; sinon L1 direct.
- Tags/entités: extraction au L1 utile pour filtres; L2/L3 agrègent (topics/entités) si disponibles.
## Résultats / Prochaines étapes
 - Implémenter `summaries.update` avec la politique ci‑dessus:
   - L1: “grow last, seal once” + flush hybride (chars/time) + idempotence.
   - L2/L3: append‑only avec hystérésis + dirty propagation + backpressure.
 - Exposer les paramètres dans le tool MCP + doc des valeurs défauts et effets.
 - Journaliser diagnostics (nb dirty, latences, budgets) et exposer une ressource `logs://` pour inspection.
 - Préparer un mode maintenance `strategy='full'` (re‑pack) et un `dry‑run` (stats sans écrire).
*Rapport généré par new_report*
