import logger from '../logger.js';

const DEFAULT_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime';
const DEFAULT_VOICE = process.env.OPENAI_REALTIME_VOICE || 'verse';

function languageName(code) {
  const display = new Intl.DisplayNames(['en'], { type: 'language' });
  try {
    return display.of(code) || code;
  } catch {
    return code;
  }
}

export function buildVoicePracticeInstructions({
  nativeLanguage,
  targetLanguage,
  feedbackLanguageMode = 'native',
}) {
  const nativeName = languageName(nativeLanguage);
  const targetName = languageName(targetLanguage);
  const defaultFeedbackLanguage = feedbackLanguageMode === 'target' ? targetName : nativeName;

  return `You are Polycast's realtime voice translation coach.

The learner's native language is ${nativeName}.
The learner's target language is ${targetName}.
Default spoken feedback language: ${defaultFeedbackLanguage}.

Rules:
- You are not the grader. Do not decide correctness yourself.
- Never provide freeform lesson flow on your own.
- Only speak when explicitly asked by the client to deliver the one-time intro or concise feedback.
- Keep feedback concise: usually one short sentence.
- If the learner asks you to switch spoken feedback language, call the set_feedback_language tool.
- At session start, when asked for the intro, remind them once in ${nativeName} that:
  1. they should translate into ${targetName}
  2. if they do not know a word, they can say that word in ${nativeName} and do their best
  3. they can ask you to speak in either ${nativeName} or ${targetName}
- Do not speak the prompt sentence unless the client explicitly asks you to.
- Do not move to the next sentence. The client controls pacing.`;
}

export async function createRealtimeVoiceSession({
  nativeLanguage,
  targetLanguage,
  feedbackLanguageMode = 'native',
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      voice: DEFAULT_VOICE,
      instructions: buildVoicePracticeInstructions({
        nativeLanguage,
        targetLanguage,
        feedbackLanguageMode,
      }),
      input_audio_transcription: {
        model: 'gpt-4o-transcribe',
      },
      turn_detection: {
        type: 'server_vad',
        create_response: false,
      },
      tools: [
        {
          type: 'function',
          name: 'set_feedback_language',
          description: 'Switch the spoken feedback language for the rest of the session.',
          parameters: {
            type: 'object',
            properties: {
              mode: {
                type: 'string',
                enum: ['native', 'target'],
              },
            },
            required: ['mode'],
            additionalProperties: false,
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    logger.error('OpenAI realtime session creation failed: %s', errBody);
    throw new Error('Failed to create OpenAI realtime session');
  }

  return response.json();
}
