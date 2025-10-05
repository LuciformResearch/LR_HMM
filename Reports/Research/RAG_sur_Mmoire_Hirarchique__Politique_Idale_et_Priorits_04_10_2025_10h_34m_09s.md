title: "RAG sur Mémoire Hiérarchique — Politique Idéale et Priorités"

# RAG sur Mémoire Hiérarchique — Politique Idéale et Priorités

Date: 2025-10-04T10:34:09+02:00
Category: Research
Tags: rag,hierarchy,embeddings,retrieval,reranking,freshness

## Contexte
Nous disposons d’une mémoire hiérarchique avec artefacts unifiés v2: L1 (résumés par fenêtres de chat) et Lk (k≥2) qui agrègent des résumés précédents. Chaque item inclut tags, entities (dont others), signals (timeline/thèmes), extras (omissions), index et covers. Les embeddings existent/seront générés pour tous les niveaux (messages bruts si besoin, L1, L2, L3…). L’objectif est un RAG qui exploite intelligemment ces niveaux, privilégie l’information la plus utile (pertinence, fraîcheur, stabilité), et sait “forer” sélectivement (drill‑down) quand la question l’exige.

## Objectifs
- Maximiser la pertinence et la fiabilité des réponses en exploitant la hiérarchie (Lk→L1) plutôt que de noyer le modèle dans des extraits bruts.
- Offrir un contrôle explicite: priorité à des résumés haut niveau ou à des détails fins, selon l’intention de la requête (large/synthèse vs ciblée/technique).
- Réduire le coût et le bruit contextuel en favorisant d’abord des résumés Lk, puis en élargissant seulement si nécessaire aux segments couverts.
- Intégrer la fraîcheur et la diversité: remonter des infos récentes et éviter la redondance.
- Rendre le pipeline observable et explicable (trace des niveaux, des expansions, et des filtres appliqués).

## Changements / Analyses
Principes de priorisation
- Niveau‑d’abord: pour des requêtes larges, privilégier Lk (k élevé) pour capter les grandes lignes; pour des requêtes précises (termes rares, code, timestamp), privilégier L1.
- Mix guidé par l’intent: un classifieur rapide (ou heuristiques) détermine si la requête demande synthèse (haut niveau) ou précision (niveau bas), et fixe un quota de résultats par niveau.
- Fraîcheur pondérée: booster les contenus récents à importance modérée; la pertinence sémantique reste première.
- Diversité / couverture: MMR par période/cluster pour éviter la redondance et couvrir plusieurs angles.

Indexation et signaux à exploiter
- Embeddings multi‑niveaux: indexer L1..Lk (résumés) et éventuellement certains messages bruts “pivots” (e.g., messages avec code, décisions, artefacts). Stocker niveau, index, covers, ts.
- Métadonnées utiles au scoring: niveau (prior), recency (timestamp), taille (char_count), tags/entities (règles expertes), signals.timeline (ancrages temporels).
- Traçabilité: covers permettent de restreindre les expansions (drill‑down) aux zones pertinentes.

Pipeline RAG idéal (multi‑étapes)
- Étape 0 — Pré‑analyse requête: détection intent (synthèse vs ciblée), mots clés, entités, fenêtre temporelle implicite/explicite; réglage du profil de recherche (quotas par niveau, poids recency, budget tokens).
- Étape 1 — Recherche initiale “level‑aware”:
  - Si requête large: top‑k sur Lk (ex: L3 puis L2), avec un petit quota L1 pour capter un détail potentiel.
  - Si requête ciblée: top‑k sur L1, avec un petit quota L2/L3 pour contexte global.
  - Scoring combiné: sim_embedding + α·prior(level) + β·freshness + γ·diversité.
- Étape 2 — Drill‑down sélectif:
  - À partir des meilleurs Lk, restreindre une seconde recherche aux covers (Lk→L1 ou L1→messages) pour capturer des détails précis et des citations textuelles.
  - Option: limiter au top‑m items par groupe de covers pour respecter le budget.
- Étape 3 — Reranking à deux étages:
  - Rerank léger (cross‑encoder/LLM court) sur le set Lk + L1 pour harmoniser niveaux et recentrer sur l’intent.
  - Après expansion, rerank final avec un modèle un peu plus coûteux sur un nombre réduit de candidats, en intégrant entités/tags et contraintes temporelles.
- Étape 4 — Composition de contexte hiérarchique:
  - Assembler un “contexte narratif” avec: (a) 2‑4 résumés L2/L3 très pertinents pour la vue d’ensemble, (b) 3‑8 extraits L1 ciblés issus des covers des picks haut niveau, (c) éventuellement 1‑3 messages bruts en citation si la précision textuelle est cruciale.
  - Annoter chaque extrait d’un header minimal (niveau, index, time, source) pour traçabilité.
- Étape 5 — Réponse + guidance d’usage:
  - Mentionner quand la réponse s’appuie sur des résumés vs des extraits bruts; éviter l’invention de noms (aligné aux prompts unifiés). Proposer des pistes d’exploration si le contexte est partiel (ex.: “je peux approfondir ce groupe si besoin”).

Politiques de priorité (cas d’usage)
- Synthèse globale (“raconte les grandes étapes de …”): 80% budget sur L3/L2 + 20% L1 (citations clés); faible poids recency sauf mention explicite.
- Détail fin (“quelle commande à 00:18 ?”): 70% budget sur L1 (et messages bruts si besoin), 30% sur L2 pour contexte; fort poids timeline/signals.
- Récent d’abord (“quoi de neuf depuis hier ?”): booster recency, quota sur dernières fenêtres L1, L2 plus faible sauf si récap hebdo existe.
- Entités/artefacts (“où parle‑t‑on de Klymäiôn ?”): filtrage par tags/entities, puis recherche sémantique; drill‑down si conflit/ambiguïté.

Filtrage “covers‑only” (seconde passe)
- Après top résultats Lk, construire l’union des covers et restreindre la seconde recherche à ces zones (L1 puis messages) pour précision et compacité.
- Avantage: limite la dérive hors sujet et réduit le bruit; idéal pour préparer des citations exactes.

Gestion du budget et des tokens
- Budgets découplés par niveau (quotas); ajustables par intent. MMR pour diversité. Cutoff dynamique si le gain marginal baisse.
- Taille de contexte finale maîtrisée (paliers “small/medium/large”).

Observabilité et qualité
- Journaliser: contributions par niveau, poids recency, expansions déclenchées, items rejetés, scores. Garder des métriques: hit‑rate par intent, MRR, couverture vs oracle, coût tokens.
- Safe‑modes: si l’IA échoue à extraire un passage brut nécessaire, proposer une relance de drill‑down automatique.

## Résultats / Prochaines étapes
- Définir 3 profils de recherche par défaut (synthèse, détail, récent) avec quotas par niveau et pondérations (level, recency, diversité).
- Mettre en liste blanche les niveaux indexés pour embeddings (L1..L3) et préciser la granularité des messages bruts à indexer (pivots).
- Spécifier la règle “covers‑only” pour la seconde passe (drill‑down) et ses limites (top‑m par groupe).
- Choisir le point d’invocation du reranking (deux étages) et ses modèles cibles selon budget.
- Définir les métriques de succès (hit‑rate, MRR, couverture, coût) et les logs d’observabilité requis.
- Préparer des prompts de composition de contexte hiérarchique (instructions stables, format d’annotation des extraits).

*Rapport généré par new_report*
