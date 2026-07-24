import { useCallback, useEffect, useMemo, useState } from 'react';
import { CloseIcon, ChevronDownIcon } from './icons';
import { emitFallbackDiagnostic } from '../utils/fallbackDiagnostics';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { getSpanishConjugations } from '../api';
import type { SpanishConjugationResult, SpanishConjugationTable } from '../api';

type MoodKey = 'Impersonal' | 'Indicativo' | 'Subjuntivo' | 'Imperativo' | 'Saved';

type ConjugationResult = SpanishConjugationResult['variants'][number];

interface Props {
  word: string;
  lemma?: string | null;
  targetLanguage?: string | null;
  partOfSpeech?: string | null;
  forms: string[];
}

const PRONOUNS = ['yo', 'tú', 'él / ella / Ud.', 'nosotros', 'vosotros', 'ellos / Uds.'];

const MOOD_LABELS: Record<MoodKey, string> = {
  Impersonal: 'Non-finite',
  Indicativo: 'Indicative',
  Subjuntivo: 'Subjunctive',
  Imperativo: 'Imperative',
  Saved: 'Additional forms',
};

const TENSE_LABELS: Record<string, string> = {
  Infinitivo: 'Infinitive',
  Gerundio: 'Gerund',
  Participio: 'Past participle',
  Presente: 'Present',
  PreteritoImperfecto: 'Imperfect',
  PreteritoIndefinido: 'Preterite',
  FuturoImperfecto: 'Future',
  CondicionalSimple: 'Conditional',
  PreteritoPerfecto: 'Present perfect',
  PreteritoPluscuamperfecto: 'Past perfect',
  PreteritoAnterior: 'Preterite anterior',
  FuturoPerfecto: 'Future perfect',
  CondicionalCompuesto: 'Conditional perfect',
  PreteritoImperfectoRa: 'Imperfect (-ra)',
  PreteritoImperfectoSe: 'Imperfect (-se)',
  PreteritoPluscuamperfectoRa: 'Past perfect (-ra)',
  PreteritoPluscuamperfectoSe: 'Past perfect (-se)',
  Afirmativo: 'Affirmative',
  Negativo: 'Negative',
};

function isSpanishVerb(targetLanguage: string | null | undefined, partOfSpeech: string | null | undefined) {
  return Boolean(
    targetLanguage?.toLowerCase().startsWith('es')
    && partOfSpeech?.toLowerCase().startsWith('verb'),
  );
}

function firstTense(mood: MoodKey, result: ConjugationResult | null): string {
  if (mood === 'Saved') return '';
  const table = result?.conjugation[mood];
  if (!table) return '';
  if (mood === 'Indicativo' || mood === 'Subjuntivo') {
    return Object.prototype.hasOwnProperty.call(table, 'Presente')
      ? 'Presente'
      : Object.keys(table)[0] ?? '';
  }
  return Object.keys(table)[0] ?? '';
}

function displayForm(form: string | undefined) {
  return form && form !== '-' ? form : '—';
}

export default function WordFormsDialog({
  word,
  lemma,
  targetLanguage,
  partOfSpeech,
  forms,
}: Props) {
  const canConjugate = isSpanishVerb(targetLanguage, partOfSpeech);
  const conjugationLemma = (lemma || word).trim().toLowerCase();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ConjugationResult[]>([]);
  const [loadError, setLoadError] = useState('');
  const [variantIndex, setVariantIndex] = useState(0);
  const [mood, setMood] = useState<MoodKey>(canConjugate ? 'Indicativo' : 'Saved');
  const [tense, setTense] = useState('Presente');

  const result = results[variantIndex] ?? null;
  const availableMoods = useMemo<MoodKey[]>(() => {
    const moods: MoodKey[] = result
      ? (['Impersonal', 'Indicativo', 'Subjuntivo', 'Imperativo'] as const)
          .filter((key) => Object.keys(result.conjugation[key] ?? {}).length > 0)
      : [];
    if (forms.length > 0) moods.push('Saved');
    return moods;
  }, [forms.length, result]);

  const closeOnEscape = useCallback(() => {
    if (open) setOpen(false);
  }, [open]);
  useEscapeKey(closeOnEscape);

  useEffect(() => {
    if (!open || !canConjugate || results.length > 0 || loadError) return;
    let cancelled = false;
    setLoading(true);
    void getSpanishConjugations(conjugationLemma)
      .then((generated) => {
        if (cancelled) return;
        if (generated.variants.length === 0) {
          throw new Error(`No table returned for ${conjugationLemma}`);
        }
        setResults(generated.variants);
        setVariantIndex(0);
        setMood('Indicativo');
        setTense('Presente');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : String(error);
        setLoadError(detail);
        setMood('Saved');
        emitFallbackDiagnostic({
          code: 'dictionary_conjugation_generator_fallback',
          severity: 'warning',
          title: 'Conjugation table unavailable',
          message: `Polycast could not build a labeled table for “${conjugationLemma}”, so the saved forms remain available instead.`,
          detail,
        }, { source: 'web.dictionary', operation: 'generate-conjugation-table' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canConjugate, conjugationLemma, loadError, open, results.length]);

  useEffect(() => {
    if (!open) return;
    setMood(canConjugate ? 'Indicativo' : 'Saved');
    setTense('Presente');
    setVariantIndex(0);
  }, [canConjugate, conjugationLemma, open]);

  const selectMood = (nextMood: MoodKey) => {
    setMood(nextMood);
    setTense(firstTense(nextMood, result));
  };

  const moodTable: SpanishConjugationTable[keyof SpanishConjugationTable] | null = mood === 'Saved'
    ? null
    : result?.conjugation[mood] ?? null;
  const tenses = moodTable ? Object.keys(moodTable) : [];
  const selectedForms = moodTable?.[tense];

  return (
    <>
      <button
        type="button"
        className="dict-forms-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span>
          <strong>{canConjugate ? 'View conjugations' : 'View word forms'}</strong>
          <small>{forms.length.toLocaleString()} saved {forms.length === 1 ? 'form' : 'forms'}</small>
        </span>
        <ChevronDownIcon size={17} />
      </button>

      {open && (
        <div
          className="dict-conjugation-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="dict-conjugation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dict-conjugation-title"
          >
            <header className="dict-conjugation-header">
              <div>
                <span>Forms for</span>
                <h3 id="dict-conjugation-title">{conjugationLemma}</h3>
                {canConjugate && <small>Standard Spanish (Spain)</small>}
              </div>
              <button
                type="button"
                className="dict-conjugation-close"
                onClick={() => setOpen(false)}
                aria-label="Close forms"
              >
                <CloseIcon size={20} />
              </button>
            </header>

            {loading ? (
              <div className="dict-conjugation-loading" role="status">
                <span className="dict-image-spinner" />
                <span>Building conjugation table…</span>
              </div>
            ) : (
              <>
                {loadError && (
                  <div className="dict-conjugation-diagnostic" role="alert">
                    <strong>Conjugation table unavailable</strong>
                    <span>The saved forms are still shown below.</span>
                    <small>{loadError}</small>
                  </div>
                )}

                {results.length > 1 && (
                  <label className="dict-conjugation-variant">
                    Conjugation pattern
                    <select
                      value={variantIndex}
                      onChange={(event) => {
                        const nextIndex = Number(event.target.value);
                        setVariantIndex(nextIndex);
                        setTense(firstTense(mood, results[nextIndex] ?? null));
                      }}
                    >
                      {results.map((item, index) => (
                        <option value={index} key={`${item.info.model}-${index}`}>
                          {item.info.model} {item.info.ortho ? `(${item.info.ortho} spelling)` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <nav className="dict-conjugation-moods" aria-label="Conjugation moods">
                  {availableMoods.map((item) => (
                    <button
                      type="button"
                      key={item}
                      className={mood === item ? 'active' : ''}
                      aria-pressed={mood === item}
                      onClick={() => selectMood(item)}
                    >
                      {MOOD_LABELS[item]}
                    </button>
                  ))}
                </nav>

                <div className="dict-conjugation-body">
                  {mood === 'Saved' ? (
                    <div className="dict-saved-forms">
                      <div>
                        <h4>Additional saved forms</h4>
                        <p>Regional, alternate, and attached-pronoun forms supplied by the dictionary source.</p>
                      </div>
                      <div className="dict-form-chips">
                        {forms.map((form, index) => (
                          <span key={`${form}-${index}`}>{displayForm(form)}</span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <nav className="dict-conjugation-tenses" aria-label={`${MOOD_LABELS[mood]} forms`}>
                        {tenses.map((item) => (
                          <button
                            type="button"
                            key={item}
                            className={tense === item ? 'active' : ''}
                            aria-pressed={tense === item}
                            onClick={() => setTense(item)}
                          >
                            {TENSE_LABELS[item] ?? item}
                          </button>
                        ))}
                      </nav>

                      {mood === 'Impersonal' ? (
                        <div className="dict-nonfinite-grid">
                          <div>
                            <span>{TENSE_LABELS[tense] ?? tense}</span>
                            <strong>{displayForm(typeof selectedForms === 'string' ? selectedForms : undefined)}</strong>
                          </div>
                        </div>
                      ) : (
                        <table className="dict-conjugation-table">
                          <thead>
                            <tr>
                              <th scope="col">Person</th>
                              <th scope="col">{TENSE_LABELS[tense] ?? tense}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(Array.isArray(selectedForms) ? selectedForms : []).map((form, index) => (
                              <tr key={`${PRONOUNS[index]}-${index}`}>
                                <th scope="row">{PRONOUNS[index]}</th>
                                <td>{displayForm(form)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
