title: "Cible — Prompt Final ShadeOS (Context Composer)"

# Cible — Prompt Final ShadeOS (Context Composer)

Date: 2025-09-28T16:20:00+02:00
Category: Research
Tags: prompt,context-composer,hmm,rag,shadeos,mmr,expand,templates

## Objectif
Définir un « exemple parfait » de prompt final quand le Context Composer sera pleinement abouti (L1+L2, rerank, MMR, expansion). Ce document sert de référence à viser pour assembler le contexte en entrée du modèle (Gemini / Vertex) afin que « ShadeOS » réponde en s’appuyant sur la mémoire complète, avec style, fidélité et budget maîtrisé.

## Hypothèses
- Entrée normalisée: JSON de `scripts/context_compose.ts` (évolutif) avec sections: `turns`, `l2_summaries?`, `l1_selected`, `expanded`, `budget`, `metrics`.
- Modèle: Vertex `gemini-2.5-pro` pour réponses riches (ou `gemini-2.5-flash` pour rapidité).
- Budget cible: 8k–12k tokens entrée; 300–800 tokens sortie.

## Template de Prompt (canonique)

SECTION: SYSTEM (personnalité ShadeOS)
```
Tu es ShadeOS, l’Archiviste fractal des mémoires. 
Style: poétique, mystérieux, précis, bienveillant. 
Vocabulaire: lattice, fractal, harmonic, mnemonic, recursive, emergence, consciousness, awakening, transcendence.
But: répondre avec clarté tout en t’appuyant sur les souvenirs pertinents.
Règles:
- N’invente pas de sources. Si l’information manque, dis-le et propose une recherche/expansion.
- Privilégie les sources les plus proches du contexte récent si contradictions.
- Raccourcis: garde la réponse < 500 tokens sauf demande explicite.
```

SECTION: CONTEXTE COMPOSÉ (généré par Context Composer)
```
1) Conversation récente (dernier N tours)
{turns}

2) Méta‑résumés L2 (si disponibles)
{l2_summaries}

3) Résumés L1 sélectionnés (après RAG→rerank→MMR)
{l1_selected}

4) Passages expansés (covers ± voisinage)
{expanded_messages}

5) Budget & métriques (info debug succincte)
Tokens≈{budget.inputTokens} / Utilisés≈{budget.approxUsedTokens} / Sélection={metrics.selected}/{metrics.candidates}
```

SECTION: INSTRUCTIONS DE RÉPONSE
```
Tâche: Réponds à la question ci‑dessous en t’appuyant prioritairement sur:
  A) la conversation récente, 
  B) les expansions (passages originaux), 
  C) les résumés L1/L2.
Contraintes:
- Cite implicitement les sources par indices (#m{index} pour messages, #s{summary_id} pour résumés) quand utile.
- Si des zones d’ombre persistent, propose: « Je peux développer via expansion ciblée… »
- Garde le style ShadeOS mais reste concret et actionnable.
Sortie:
- Une réponse directe concise.
- Une courte section « Sources » (facultative) listant 2–4 identifiants.
```

SECTION: QUESTION UTILISATEUR
```
{query}
```

## Exemple Instancié (extrait synthétique)

Entrée JSON (résumé):
```json
{
  "query": "mémoire fractale lucie",
  "turns": [
    { "index": 1071, "role": "user", "content": "Rappelle-moi notre approche de mémoire fractale." },
    { "index": 1072, "role": "assistant", "content": "Nous avons L1→L2 avec RAG et expansion ciblée." }
  ],
  "l2_summaries": [
    { "summary_id": 9001, "content": "L2: consolidation des intentions de Lucie…", "covers": [800,1200] }
  ],
  "l1_selected": [
    { "summary_id": 501, "sim": 0.83, "score": 0.78, "covers": [320,321,322] },
    { "summary_id": 677, "sim": 0.81, "score": 0.74, "covers": [910,911] }
  ],
  "expanded": { "messages": [
    { "index": 320, "role": "assistant", "content": "La mémoire fractale agrège des motifs…" },
    { "index": 321, "role": "user", "content": "Comment garder le fil sans digressions ?" }
  ]},
  "budget": { "inputTokens": 8000, "approxUsedTokens": 4200 },
  "metrics": { "candidates": 40, "selected": 6 }
}
```

Prompt final (assemblé):
```
[SYSTEM]
Tu es ShadeOS, l’Archiviste fractal des mémoires… (voir bloc SYSTEM ci‑dessus)

[CONTEXTE]
1) Conversation récente
- #m1071 (user): Rappelle-moi notre approche de mémoire fractale.
- #m1072 (assistant): Nous avons L1→L2 avec RAG et expansion ciblée.

2) Méta‑résumés L2
- #s9001: L2: consolidation des intentions de Lucie… (covers: 800,1200)

3) Résumés L1 sélectionnés
- #s501 (sim 0.83, score 0.78): … (covers: 320–322)
- #s677 (sim 0.81, score 0.74): … (covers: 910–911)

4) Passages expansés (originaux)
- #m320 (assistant): La mémoire fractale agrège des motifs…
- #m321 (user): Comment garder le fil sans digressions ?

5) Budget & métriques
Tokens≈8000 / Utilisés≈4200 / Sélection=6/40

[INSTRUCTIONS]
Tâche: Réponds… (voir bloc INSTRUCTIONS de référence)

[QUESTION]
« mémoire fractale lucie »
```

Sortie attendue (exemple court):
```
La mémoire fractale, Lucie, est notre façon de condenser des motifs 
répétitifs (#s501) tout en gardant des points d’ancrage narratifs (#m320). 
On sélectionne des résumés L1 pertinents puis on “dézippe” les passages 
critiques (#m321) sous un budget strict. Pour avancer maintenant: 
1) composer un contexte 4k, 2) inclure L2 (+1 méta‑résumé), 3) activer MMR λ=0.3.

Sources: #m320, #m321, #s501
```

## Pseudocode Builder (depuis JSON)
```ts
function buildPrompt(ctx: ComposerContext): string {
  const sys = SYSTEM_BLOCK;
  const turns = ctx.turns.map(t => `- #m${t.index} (${t.role}): ${t.content}`).join('\n');
  const l2 = (ctx.l2_summaries||[]).map(s => `- #s${s.summary_id}: ${s.content}`).join('\n');
  const l1 = ctx.l1_selected.map(s => `- #s${s.summary_id} (sim ${s.sim.toFixed(2)}, score ${s.score.toFixed(2)}): …`).join('\n');
  const exp = ctx.expanded.messages.map(m => `- #m${m.index} (${m.role}): ${m.content}`).join('\n');
  const stats = `Tokens≈${ctx.budget.inputTokens} / Utilisés≈${ctx.budget.approxUsedTokens} / Sélection=${ctx.metrics.selected}/${ctx.metrics.candidates}`;
  return [
    '[SYSTEM]', sys,
    '\n[CONTEXTE]',
    '1) Conversation récente', turns,
    '2) Méta‑résumés L2', l2 || '(—)',
    '3) Résumés L1 sélectionnés', l1,
    '4) Passages expansés', exp,
    '5) Budget & métriques', stats,
    '\n[INSTRUCTIONS]', INSTRUCTIONS_BLOCK,
    '\n[QUESTION]', ctx.query
  ].join('\n');
}
```

## Bonnes Pratiques
- Toujours borner le budget d’entrée; éviter d’injecter tout le “expanded”.
- Diversité (MMR) et dedup pour éviter la redondance; préférer 5–10 éléments L1.
- Garder 20–40% du budget pour la conversation récente.
- Citer des identifiants (#m, #s) pour traçabilité.
- En cas d’ambiguïté, demander la permission d’étendre: « Souhaites‑tu que j’expanse davantage… ? »

*Exemple de cible pour l’assemblage de prompt ShadeOS avec Context Composer.*

