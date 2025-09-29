title: "Progression HMM/RAG — Vertex EU L2, prompt soft-target & extras"

# Progression HMM/RAG — Vertex EU L2, prompt soft-target & extras

Date: 2025-09-29T12:33:26+02:00
Category: Plans
Tags: hmm,l2,vertexai,progression,params,context

## Contexte
## Contexte
Consolider L2 sous Vertex (EU) sans modifier le grouping: viser ≈1.5× avg L1 par groupe (cap 2.0×), supprimer les contraintes de phrases, baisser le minimum strict (300), offrir un canal `<extras>` pour les détails compressés.

## Objectifs
- Ajout d’un prompt L2 “soft-target + cap dur” et `<extras>`.
- Bornes dynamiques: target=1.5× avg, cap=2.0× avg, min=300.
- Embedding L2 en DB (topics/meta).
- Runbook reproductible.

## Changements / Analyses
- `compress_memory_l2.ts`:
  - `--l2-multiplier`, `--l2-soft-target`, `--l2-wiggle`, `--hard-min`, (option) `--auto-trim` (désactivé).
  - Prompt: pas de contrainte de phrases; `hintTarget`/`hintCap`; `<extras>`.
  - Logs détaillés: avg, target, cap, bounds, len, ratio, stratégie.
- `db_embed_l2.ts`: stocke `tags → topics`, `entities/signals/extras → meta`.
- `db_embed_l1.ts`: stocke `artifacts` L1 en `meta`, `tags → topics`.

## Résultats
- Région: `europe-west1` (Vertex OK).
- L2 (2 groupes):
  - idx,sumL1,outLen,ratio,tags,extras
  - 0,1981,616,0.31,12,1
  - 1,1720,439,0.26,12,1
- Conformité: proche de la cible (1.5× avg) avec sous‑demande douce (1.0×). Pas de phrase‑count; longueur maîtrisée.

## Prochaines étapes
- Générer tous les groupes et consolider un tableau complet.
- Ajuster `--l2-soft-target` (1.1–1.2) si l’on veut des L2 légèrement plus longs.
- Si validés: basculer ces paramètres en défauts des scripts (L2 + RAG/Composer).
