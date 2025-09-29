title: "Gemini models disponibles (API v1beta)"

# Gemini models disponibles (API v1beta)

Date: 2025-09-27T17:00:11+02:00
Category: Research
Tags: gemini,models,provider,api,generateContent

## Contexte
Inventaire des modèles Gemini accessibles avec la clé de l'environnement (.env) via l'API v1beta. Ceci aide à choisir un modèle valide pour generateContent et calibrer les fenêtres.

## Objectifs
1. Répertorier les modèles supportant generateContent.
2. Conserver aussi la liste complète retournée par l'API.
3. Suggérer un modèle par défaut pour scripting (coût/latence).

## Changements / Analyses
Modèles supportant generateContent:

Models supporting generateContent:
- models/gemini-2.5-pro-preview-03-25 (Gemini 2.5 Pro Preview 03-25)
- models/gemini-2.5-flash-preview-05-20 (Gemini 2.5 Flash Preview 05-20)
- models/gemini-2.5-flash (Gemini 2.5 Flash)
- models/gemini-2.5-flash-lite-preview-06-17 (Gemini 2.5 Flash-Lite Preview 06-17)
- models/gemini-2.5-pro-preview-05-06 (Gemini 2.5 Pro Preview 05-06)
- models/gemini-2.5-pro-preview-06-05 (Gemini 2.5 Pro Preview)
- models/gemini-2.5-pro (Gemini 2.5 Pro)
- models/gemini-2.0-flash-exp (Gemini 2.0 Flash Experimental)
- models/gemini-2.0-flash (Gemini 2.0 Flash)
- models/gemini-2.0-flash-001 (Gemini 2.0 Flash 001)
- models/gemini-2.0-flash-lite-001 (Gemini 2.0 Flash-Lite 001)
- models/gemini-2.0-flash-lite (Gemini 2.0 Flash-Lite)
- models/gemini-2.0-flash-lite-preview-02-05 (Gemini 2.0 Flash-Lite Preview 02-05)
- models/gemini-2.0-flash-lite-preview (Gemini 2.0 Flash-Lite Preview)
- models/gemini-2.0-pro-exp (Gemini 2.0 Pro Experimental)
- models/gemini-2.0-pro-exp-02-05 (Gemini 2.0 Pro Experimental 02-05)
- models/gemini-exp-1206 (Gemini Experimental 1206)
- models/gemini-2.0-flash-thinking-exp-01-21 (Gemini 2.5 Flash Preview 05-20)
- models/gemini-2.0-flash-thinking-exp (Gemini 2.5 Flash Preview 05-20)
- models/gemini-2.0-flash-thinking-exp-1219 (Gemini 2.5 Flash Preview 05-20)
- models/gemini-2.5-flash-preview-tts (Gemini 2.5 Flash Preview TTS)
- models/gemini-2.5-pro-preview-tts (Gemini 2.5 Pro Preview TTS)
- models/learnlm-2.0-flash-experimental (LearnLM 2.0 Flash Experimental)
- models/gemma-3-1b-it (Gemma 3 1B)
- models/gemma-3-4b-it (Gemma 3 4B)
- models/gemma-3-12b-it (Gemma 3 12B)
- models/gemma-3-27b-it (Gemma 3 27B)
- models/gemma-3n-e4b-it (Gemma 3n E4B)
- models/gemma-3n-e2b-it (Gemma 3n E2B)
- models/gemini-flash-latest (Gemini Flash Latest)
- models/gemini-flash-lite-latest (Gemini Flash-Lite Latest)
- models/gemini-pro-latest (Gemini Pro Latest)
- models/gemini-2.5-flash-lite (Gemini 2.5 Flash-Lite)
- models/gemini-2.5-flash-image-preview (Nano Banana)
- models/gemini-2.5-flash-preview-09-2025 (Gemini 2.5 Flash Preview Sep 2025)
- models/gemini-2.5-flash-lite-preview-09-2025 (Gemini 2.5 Flash-Lite Preview Sep 2025)
- models/gemini-robotics-er-1.5-preview (Gemini Robotics-ER 1.5 Preview)

Liste complète retournée par l'API:

All models:
- models/embedding-gecko-001 (Embedding Gecko)
- models/gemini-2.5-pro-preview-03-25 (Gemini 2.5 Pro Preview 03-25)
- models/gemini-2.5-flash-preview-05-20 (Gemini 2.5 Flash Preview 05-20)
- models/gemini-2.5-flash (Gemini 2.5 Flash)
- models/gemini-2.5-flash-lite-preview-06-17 (Gemini 2.5 Flash-Lite Preview 06-17)
- models/gemini-2.5-pro-preview-05-06 (Gemini 2.5 Pro Preview 05-06)
- models/gemini-2.5-pro-preview-06-05 (Gemini 2.5 Pro Preview)
- models/gemini-2.5-pro (Gemini 2.5 Pro)
- models/gemini-2.0-flash-exp (Gemini 2.0 Flash Experimental)
- models/gemini-2.0-flash (Gemini 2.0 Flash)
- models/gemini-2.0-flash-001 (Gemini 2.0 Flash 001)
- models/gemini-2.0-flash-lite-001 (Gemini 2.0 Flash-Lite 001)
- models/gemini-2.0-flash-lite (Gemini 2.0 Flash-Lite)
- models/gemini-2.0-flash-lite-preview-02-05 (Gemini 2.0 Flash-Lite Preview 02-05)
- models/gemini-2.0-flash-lite-preview (Gemini 2.0 Flash-Lite Preview)
- models/gemini-2.0-pro-exp (Gemini 2.0 Pro Experimental)
- models/gemini-2.0-pro-exp-02-05 (Gemini 2.0 Pro Experimental 02-05)
- models/gemini-exp-1206 (Gemini Experimental 1206)
- models/gemini-2.0-flash-thinking-exp-01-21 (Gemini 2.5 Flash Preview 05-20)
- models/gemini-2.0-flash-thinking-exp (Gemini 2.5 Flash Preview 05-20)
- models/gemini-2.0-flash-thinking-exp-1219 (Gemini 2.5 Flash Preview 05-20)
- models/gemini-2.5-flash-preview-tts (Gemini 2.5 Flash Preview TTS)
- models/gemini-2.5-pro-preview-tts (Gemini 2.5 Pro Preview TTS)
- models/learnlm-2.0-flash-experimental (LearnLM 2.0 Flash Experimental)
- models/gemma-3-1b-it (Gemma 3 1B)
- models/gemma-3-4b-it (Gemma 3 4B)
- models/gemma-3-12b-it (Gemma 3 12B)
- models/gemma-3-27b-it (Gemma 3 27B)
- models/gemma-3n-e4b-it (Gemma 3n E4B)
- models/gemma-3n-e2b-it (Gemma 3n E2B)
- models/gemini-flash-latest (Gemini Flash Latest)
- models/gemini-flash-lite-latest (Gemini Flash-Lite Latest)
- models/gemini-pro-latest (Gemini Pro Latest)
- models/gemini-2.5-flash-lite (Gemini 2.5 Flash-Lite)
- models/gemini-2.5-flash-image-preview (Nano Banana)
- models/gemini-2.5-flash-preview-09-2025 (Gemini 2.5 Flash Preview Sep 2025)
- models/gemini-2.5-flash-lite-preview-09-2025 (Gemini 2.5 Flash-Lite Preview Sep 2025)
- models/gemini-robotics-er-1.5-preview (Gemini Robotics-ER 1.5 Preview)
- models/embedding-001 (Embedding 001)
- models/text-embedding-004 (Text Embedding 004)
- models/gemini-embedding-exp-03-07 (Gemini Embedding Experimental 03-07)
- models/gemini-embedding-exp (Gemini Embedding Experimental)
- models/gemini-embedding-001 (Gemini Embedding 001)
- models/aqa (Model that performs Attributed Question Answering.)
- models/imagen-3.0-generate-002 (Imagen 3.0)
- models/imagen-4.0-generate-preview-06-06 (Imagen 4 (Preview))
- models/imagen-4.0-ultra-generate-preview-06-06 (Imagen 4 Ultra (Preview))
- models/imagen-4.0-generate-001 (Imagen 4)
- models/imagen-4.0-ultra-generate-001 (Imagen 4 Ultra)
- models/imagen-4.0-fast-generate-001 (Imagen 4 Fast)

## Résultats / Prochaines étapes
Recommandation scripting (coût/latence):
- `gemini-2.5-flash` semble l’option “Flash” stable et économique pour generateContent.
- En cas de contrainte encore plus forte, tester une variante “flash-lite” preview.

Prochaines étapes:
- Fixer `GEMINI_MODEL` dans `.env` à un modèle listé ci-dessus (par ex. `gemini-2.5-flash`).
- Exécuter `scripts/check_gemini_limits.ts` pour calibrer la fenêtre caractères.

*Rapport généré par new_report*
