export const LESSONS_BY_LANG = {
  pt: [
    // A1
    { id: 'noun-gender', title: 'Noun Gender & Plurals', level: 'A1', keywords: ['gender', 'genero', 'masculine', 'feminine', 'masculino', 'feminino', 'plural', 'plurais'] },
    { id: 'ser-estar', title: 'Ser & Estar', level: 'A1', keywords: ['ser', 'estar', 'to be', 'ser e estar', 'ser vs estar', 'ser ou estar'] },
    { id: 'present-tense', title: 'Present Tense', level: 'A1', keywords: ['present tense', 'presente', 'conjugation', 'conjugar', 'regular verbs', 'verbos regulares'] },
    { id: 'articles', title: 'Articles & Contractions', level: 'A1', keywords: ['articles', 'artigos', 'contractions', 'do', 'da', 'no', 'na', 'pelo', 'pela'] },
    { id: 'numbers-time', title: 'Numbers & Time', level: 'A1', keywords: ['numbers', 'numeros', 'time', 'horas', 'clock', 'counting'] },
    { id: 'question-words', title: 'Question Words', level: 'A1', keywords: ['question', 'pergunta', 'como', 'onde', 'quando', 'por que', 'quanto', 'qual'] },
    { id: 'greetings', title: 'Greetings & Introductions', level: 'A1', keywords: ['greetings', 'introductions', 'cumprimentos', 'ola', 'bom dia', 'como vai', 'tudo bem'] },
    { id: 'possessives', title: 'Possessive Pronouns', level: 'A1', keywords: ['possessive', 'possessivo', 'meu', 'minha', 'seu', 'sua', 'nosso', 'nossa'] },
    // A2
    { id: 'past-preterite', title: 'Past Tense (Preterite)', level: 'A2', keywords: ['past tense', 'preterite', 'preterito', 'passado', 'perfeito'] },
    { id: 'imperfect', title: 'Imperfect Tense', level: 'A2', keywords: ['imperfect', 'imperfeito', 'imperfecto', 'used to', 'costumava'] },
    { id: 'reflexive-verbs', title: 'Reflexive Verbs', level: 'A2', keywords: ['reflexive', 'reflexivo', 'se', 'me', 'levantar-se', 'chamar-se'] },
    { id: 'prepositions', title: 'Prepositions', level: 'A2', keywords: ['preposition', 'preposicao', 'em', 'de', 'para', 'por', 'com', 'entre'] },
    { id: 'comparatives', title: 'Comparatives & Superlatives', level: 'A2', keywords: ['comparative', 'comparativo', 'superlative', 'superlativo', 'mais', 'menos', 'melhor', 'pior'] },
    { id: 'direct-object', title: 'Direct Object Pronouns', level: 'A2', keywords: ['direct object', 'objeto direto', 'pronome', 'me', 'te', 'lo', 'la', 'nos'] },
    { id: 'indirect-object', title: 'Indirect Object Pronouns', level: 'A2', keywords: ['indirect object', 'objeto indireto', 'lhe', 'lhes', 'pronome'] },
    { id: 'demonstratives', title: 'Demonstrative Pronouns', level: 'A2', keywords: ['demonstrative', 'demonstrativo', 'este', 'esse', 'aquele', 'isto', 'isso', 'aquilo'] },
    // B1
    { id: 'subjunctive-present', title: 'Present Subjunctive', level: 'B1', keywords: ['subjunctive', 'subjuntivo', 'presente do subjuntivo', 'que eu'] },
    { id: 'future-tense', title: 'Future Tense', level: 'B1', keywords: ['future', 'futuro', 'future tense', 'ir + infinitive', 'vou'] },
    { id: 'conditional', title: 'Conditional Mood', level: 'B1', keywords: ['conditional', 'condicional', 'futuro do preterito', 'would', 'faria', 'iria'] },
    { id: 'imperative', title: 'Imperative Mood', level: 'B1', keywords: ['imperative', 'imperativo', 'command', 'ordem', 'faca', 'venha', 'diga'] },
    { id: 'relative-clauses', title: 'Relative Clauses', level: 'B1', keywords: ['relative', 'relativo', 'que', 'quem', 'cujo', 'onde', 'clause'] },
    { id: 'por-para', title: 'Por vs Para', level: 'B1', keywords: ['por vs para', 'por ou para', 'por e para', 'para vs por'] },
    { id: 'pronominal-placement', title: 'Pronoun Placement', level: 'B1', keywords: ['pronoun placement', 'colocacao pronominal', 'proclise', 'mesoclise', 'enclise'] },
    { id: 'passive-voice', title: 'Passive Voice', level: 'B1', keywords: ['passive', 'passiva', 'voz passiva', 'ser + participle'] },
    // B2
    { id: 'subjunctive-imperfect', title: 'Imperfect Subjunctive', level: 'B2', keywords: ['imperfect subjunctive', 'imperfeito do subjuntivo', 'se eu fosse', 'se eu tivesse'] },
    { id: 'subjunctive-future', title: 'Future Subjunctive', level: 'B2', keywords: ['future subjunctive', 'futuro do subjuntivo', 'quando eu', 'se eu'] },
    { id: 'pluperfect', title: 'Pluperfect Tense', level: 'B2', keywords: ['pluperfect', 'mais-que-perfeito', 'had done', 'tinha feito', 'fizera'] },
    { id: 'compound-tenses', title: 'Compound Tenses', level: 'B2', keywords: ['compound', 'composto', 'ter + participle', 'tenho feito', 'tinha ido'] },
    { id: 'gerund-infinitive', title: 'Gerund vs Infinitive', level: 'B2', keywords: ['gerund', 'gerundio', 'infinitive', 'infinitivo', 'personal infinitive', 'infinitivo pessoal'] },
    { id: 'discourse-markers', title: 'Discourse Markers', level: 'B2', keywords: ['discourse', 'discurso', 'connector', 'conector', 'portanto', 'entretanto', 'alias'] },
    { id: 'idiomatic-expressions', title: 'Idiomatic Expressions', level: 'B2', keywords: ['idiom', 'expressao idiomatica', 'expression', 'slang', 'giria', 'dito popular'] },
    { id: 'subjunctive-triggers', title: 'Subjunctive Triggers', level: 'B2', keywords: ['subjunctive trigger', 'espero que', 'embora', 'talvez', 'caso', 'antes que'] },
    // C1
    { id: 'formal-register', title: 'Formal Register', level: 'C1', keywords: ['formal', 'register', 'registro formal', 'academic', 'academico', 'escrita formal'] },
    { id: 'literary-tenses', title: 'Literary Tenses', level: 'C1', keywords: ['literary', 'literario', 'simple pluperfect', 'mais-que-perfeito simples', 'fizera'] },
    { id: 'nominalization', title: 'Nominalization', level: 'C1', keywords: ['nominalization', 'nominalizacao', 'abstract noun', 'substantivo abstrato'] },
    { id: 'cleft-sentences', title: 'Cleft Sentences', level: 'C1', keywords: ['cleft', 'clivada', 'e que', 'foi que', 'emphasis', 'enfase'] },
    { id: 'pt-vs-br', title: 'European vs Brazilian', level: 'C1', keywords: ['european', 'brazilian', 'portugal', 'brasil', 'differences', 'diferencas', 'pt-pt', 'pt-br'] },
    { id: 'collocations', title: 'Collocations', level: 'C1', keywords: ['collocation', 'colocacao', 'word combination', 'combinacao', 'fazer sentido'] },
    { id: 'false-cognates', title: 'False Cognates', level: 'C1', keywords: ['false cognate', 'falso cognato', 'false friend', 'falso amigo'] },
    { id: 'advanced-subjunctive', title: 'Advanced Subjunctive', level: 'C1', keywords: ['advanced subjunctive', 'subjuntivo avancado', 'quer que', 'onde quer que', 'por mais que'] },
  ],
};

/**
 * Check if a video title matches a lesson based on keyword matching.
 */
export function videoMatchesLesson(videoTitle, lesson) {
  const lower = videoTitle.toLowerCase();
  return lesson.keywords.some((kw) => lower.includes(kw));
}
