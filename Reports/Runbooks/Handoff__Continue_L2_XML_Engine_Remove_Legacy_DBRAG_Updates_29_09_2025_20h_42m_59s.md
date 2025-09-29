title: "Handoff — Continue L2 XML Engine, Remove Legacy; DB/RAG Updates"

# Handoff — Continue L2 XML Engine, Remove Legacy; DB/RAG Updates

Date: 2025-09-29T20:42:59+02:00
Category: RunBook
Tags: hmm,l2,xmlengine,runbook,db

## Contexte

Objectif atteint aujourd’hui:
- L1 unifié sur Vertex via `@google/genai` (+ `--structured-xml true` optionnel) avec prompt ShadeOS (style miroir), anti‑troncature (`--min-summary` + regen), tags/entités XML + fusion tags/artefacts algorithmiques.
- L2 migre partiellement vers un moteur XML partagé (`xmlEngine`): génération primaire via `generateStructuredXML('l2', ...)` OK; mais le retry en overflow utilise encore le chemin legacy (generateMetaSummaryXML).

À finir: déboguer la cause de l’overflow initial côté `xmlEngine` et supprimer le fallback legacy pour unifier totalement L2.

## Objectifs

1) L2: Debug overflow `xmlEngine` et migrer le retry sur `xmlEngine` (supprimer legacy de la boucle principale).
2) Normalisations post‑parse (L1/L2): dates/lieux/personnes (trim, casefold, dédupe, formats d’heure), tags top‑N.
3) Aligner logs/dumps L1 sur L2 (déjà en bonne voie); ajouter une commande de validation.
4) Préparer updates DB/RAG (scripts et schémas) pour exploiter les entités/tags structurés.

## Changements / Analyses

État L2 actuel:
- Première passe via `xmlEngine`: OK mais peut dépasser `gMax` (ex: ratio 2.18). Aujourd’hui le retry repasse par `generateMetaSummaryXML` (legacy), qui a corrigé la longueur.

Pistes de fix (L2 via `xmlEngine`):
- Ajuster contraintes prompt côté `xmlEngine` pour respecter la borne maximale (utiliser `hintCap` et rappeler la borne dure maxChars dans l’instruction). C’est déjà partiellement en place, mais vérifier la formulation et le `maxOutputTokens`.
- Sur overflow: réaliser le retry via `xmlEngine` avec un `hintTarget` plus bas (ex: -0.3), même logique que L2 actuel, sans legacy.
- Tracer précisément: durée, `out.length`, `bounds`, `avgL1`, `ratio`, `strategy` (primary/retry) dans les logs.

Normalisation L1/L2 (post‑parse):
- times: homogénéiser “Minuit douze” → `00:12`, “Minute 13” → `00:13` (règles simples + liste de synonymes).
- places/persons: trim/lower/dédupe; blacklist triviale (ex: vides/génériques).
- tags: minuscule/dédupe/top‑12 (déjà fait côté L1 structuré).

## Résultats / Prochaines étapes

Reprise suggérée (pas‑à‑pas):
1) L2 — Unifier retry sur `xmlEngine`:
   - Dans `scripts/compress_memory_l2.ts`, remplacer le bloc retry (overflow) pour appeler `generateStructuredXML('l2', ...)` avec un `hintTarget` abaissé (ex: `l2SoftTarget - softRatioStep`).
   - Garder la même validation (min/max, ratio accept, `overflow-mode`).
   - Vérifier que les logs reflètent bien `XmlEngine (l2)` pour primary et retry.

2) L2 — Dry‑run multi‑groupes:
   - Commande: `npx tsx scripts/compress_memory_l2.ts --slug <slug> --vertexai true --use-xml-engine true --group-size 5 --concurrency 6 --overflow-mode regenerate --soft-ratio-step 0.3 --test true --max-groups 3 --log`.
   - Attendu: pas d’appel legacy pour le retry; résultats dans les bornes; logs durées < 20s/attempt.

3) L1/L2 — Normalisation entités:
   - Ajouter une fonction util partagée `normalizeEntities({persons,orgs,places,times})` (src/lib/utils) et l’appliquer après parse.
   - Re‑tester un mini run (4 blocs L1 structuré, 2–3 groupes L2).

4) Validation rapide — script de check:
   - Créer `scripts/validate_l1_xml.ts` (et `validate_l2_xml.ts`) pour afficher tableau idx,len,tags#,persons/places/times# et signaler anomalies (no <l1>/<l2>, len hors bornes).

5) DB/RAG (pas encore touché aujourd’hui):
   - Vérifier `db_add_meta_column.ts` et schémas: prévoir colonnes pour topics/tags/entités au besoin (ou JSONB consolidé).
   - Adapter `db_embed_l1.ts` et `db_embed_l2.ts` si on stocke désormais `entities`/`tags` structurés (actuellement L2 le fait partiellement).
   - Mettre à jour `rag_query.ts` et `context_compose.ts` pour exploiter les tags/entités (filtre/boost) et s’assurer que les embeddings prennent le bon champ (`summary`).

6) Runs E2E:
   - L1: `--structured-xml true --concurrency 33 --min-summary 250 --max-summary 400 --short-mode regenerate`.
   - L2: `--use-xml-engine true --concurrency 6–8 --overflow-mode regenerate`.

Répertoires/logs utiles:
- Logs/dumps L2: `artefacts/logs/compress_l2_*` (prompt/output/raw si legacy, et logs engine).
- L1 structuré: `artefacts/HMM/compressed/<slug>.l1.json` (tags fusionnés, entities). Idem pour L2.

Commandes de référence (env):
- `.env.local` (ajouté):
  - `GOOGLE_APPLICATION_CREDENTIALS=secrets/lr-hub-472010-17b9f2d37953.json`
  - `PROJECT_ID`/`GOOGLE_CLOUD_PROJECT=lr-hub-472010`
  - `VERTEX_LOCATION`/`LOCATION=europe-west1`

Escalades à demander dès le début (prochaine session):
- Accès réseau Vertex AI + lecture du JSON de service (ADC) hors workspace (ou `secrets/…`): nécessaire pour tous les runs L1/L2.
- Écriture fichiers (artefacts/logs, exports .json).
- Accès base locale (si suite DB/RAG): réseau local sur Postgres `docker-compose.db.yml`, lecture variables `PG*`, éventuelles migrations Drizzle si on touche les schémas.
- Eventuels `npm install` si on ajoute libs utilitaires (typage `node-fetch`, etc.).

Notes:
- L1 haute concurrence validée (33) côté Vertex avec anti‑troncature; latences ~45–50s pour 141 blocs chez nous.
- L2 engine primaire OK; reste à éliminer le retry legacy pour unifier complètement.

### Option B2B (à planifier) — Filtrage de secrets au parsing
- Ajouter un « secret scrubber » dans la chaîne de parsing (avant export des artefacts) pour neutraliser automatiquement patterns sensibles (API keys, tokens) dans les sources conversationnelles/documents.
- Implémentation proposée:
  - Liste de regex maintenues (OpenAI `sk-`/`sk-proj-`, Stripe `sk_live_`/`pk_live_`/`rk_live_`, etc.), remplacements par placeholders `[REDACTED_*]`.
  - Mode « audit » (log des remplacements) + mode « strict » (blocage si secret actif détecté).
  - Off par défaut en dev; on l’activera pour les runs pro/B2B ou ingestion de documents clients.

*Rapport généré par new_report*
