# Gemini Explain-in-Context Prompt Samples

Generated: 2026-06-17T16:09:24.387Z

Source article: Una sociedad fría como un algoritmo

Source URL: https://elpais.com/opinion/2026-03-13/una-sociedad-fria-como-un-algoritmo.html

Article date: 2026-03-13

Selection method: one word selected with node:crypto randomInt from article sentences; one multi-word phrase selected with node:crypto randomInt from a phrase candidate list drawn from the same article. Previous selections `fría`, `falta`, `el`, and `un código QR hasta realizar` were excluded for the word sample.

Code path tested: server/services/wordSemanticsService.js buildExplainWordPrompt() + callGemini().

Prompt requirement under test: full-sentence translation with the clicked text's English equivalent wrapped in tildes, plus a simple learner-friendly explanation. The app popup renders tilded text with a distinct highlight color.

## Sample 1

Sentence index: 8

Selection type: word

Token start index: 4

Selected text: más

Sentence with selected text wrapped in tildes:

También, los lugares donde ~más~ bajas se producían.

Exact prompt sent to Gemini:

```text
The learner clicked the text wrapped in tildes in this Spanish sentence: "También, los lugares donde ~más~ bajas se producían."
Translate the entire sentence into English. In the sentence translation, wrap the English words that translate the clicked text in tildes, like ~translated words~. Then explain what "más" means as used specifically in that sentence, in simple English for a language learner.

Return exactly two short lines:
Sentence: <natural English translation of the full sentence, with only the clicked text's translated equivalent wrapped in tildes>
más: <simple meaning of "más" in this sentence, using common words; include only the most important grammar or usage note if needed>

Do NOT add a preamble, markdown, bullets, or extra lines. Do not repeat the Spanish sentence.
```

Exact Gemini response:

```text
Sentence: Also, the places where the ~most~ casualties occurred.
más: "most", used here to show the highest amount or quantity of casualties.
```

## Sample 2

Sentence index: 7

Selection type: 3-word phrase

Token start index: 0

Selected text: Por medio de

Sentence with selected text wrapped in tildes:

~Por medio de~ alfileres y banderitas les indicaba dónde se producían los enfrentamientos más importantes y las batallas más decisivas.

Exact prompt sent to Gemini:

```text
The learner clicked the text wrapped in tildes in this Spanish sentence: "~Por medio de~ alfileres y banderitas les indicaba dónde se producían los enfrentamientos más importantes y las batallas más decisivas."
Translate the entire sentence into English. In the sentence translation, wrap the English words that translate the clicked text in tildes, like ~translated words~. Then explain what "Por medio de" means as used specifically in that sentence, in simple English for a language learner.

Return exactly two short lines:
Sentence: <natural English translation of the full sentence, with only the clicked text's translated equivalent wrapped in tildes>
Por medio de: <simple meaning of "Por medio de" in this sentence, using common words; include only the most important grammar or usage note if needed>

Do NOT add a preamble, markdown, bullets, or extra lines. Do not repeat the Spanish sentence.
```

Exact Gemini response:

```text
Sentence: ~By means of~ pins and little flags, he indicated to them where the most important clashes and the most decisive battles were taking place.
Por medio de: "By using" or "through"; it shows the tool or method used to do something.
```

