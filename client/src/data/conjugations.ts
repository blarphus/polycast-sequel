// ---------------------------------------------------------------------------
// data/conjugations.ts -- Client-side conjugation tables + problem generator
// ---------------------------------------------------------------------------

export interface ConjugationProblem {
  infinitive: string;
  tense: string;
  tense_target: string;
  pronoun: string;
  expected: string;
}

interface VerbTable {
  infinitive: string;
  conjugations: Record<string, Record<string, string>>;
}

interface LanguageConjugationData {
  pronouns: string[];
  tenses: { key: string; label: string }[];
  verbs: VerbTable[];
}

// ===========================================================================
// Spanish (es)
// ===========================================================================

const es: LanguageConjugationData = {
  pronouns: ['yo', 'tu', 'el', 'nosotros', 'vosotros', 'ellos'],
  tenses: [
    { key: 'presente', label: 'Presente de indicativo' },
    { key: 'preterito', label: 'Preterito indefinido' },
    { key: 'imperfecto', label: 'Preterito imperfecto' },
    { key: 'futuro', label: 'Futuro simple' },
    { key: 'condicional', label: 'Condicional simple' },
    { key: 'subjuntivo', label: 'Presente de subjuntivo' },
    { key: 'imperfecto_sub', label: 'Imperfecto de subjuntivo' },
  ],
  verbs: [
    {
      infinitive: 'ser',
      conjugations: {
        presente:       { yo: 'soy', tu: 'eres', el: 'es', nosotros: 'somos', vosotros: 'sois', ellos: 'son' },
        preterito:      { yo: 'fui', tu: 'fuiste', el: 'fue', nosotros: 'fuimos', vosotros: 'fuisteis', ellos: 'fueron' },
        imperfecto:     { yo: 'era', tu: 'eras', el: 'era', nosotros: 'eramos', vosotros: 'erais', ellos: 'eran' },
        futuro:         { yo: 'sere', tu: 'seras', el: 'sera', nosotros: 'seremos', vosotros: 'sereis', ellos: 'seran' },
        condicional:    { yo: 'seria', tu: 'serias', el: 'seria', nosotros: 'seriamos', vosotros: 'seriais', ellos: 'serian' },
        subjuntivo:     { yo: 'sea', tu: 'seas', el: 'sea', nosotros: 'seamos', vosotros: 'seais', ellos: 'sean' },
        imperfecto_sub: { yo: 'fuera', tu: 'fueras', el: 'fuera', nosotros: 'fueramos', vosotros: 'fuerais', ellos: 'fueran' },
      },
    },
    {
      infinitive: 'estar',
      conjugations: {
        presente:       { yo: 'estoy', tu: 'estas', el: 'esta', nosotros: 'estamos', vosotros: 'estais', ellos: 'estan' },
        preterito:      { yo: 'estuve', tu: 'estuviste', el: 'estuvo', nosotros: 'estuvimos', vosotros: 'estuvisteis', ellos: 'estuvieron' },
        imperfecto:     { yo: 'estaba', tu: 'estabas', el: 'estaba', nosotros: 'estabamos', vosotros: 'estabais', ellos: 'estaban' },
        futuro:         { yo: 'estare', tu: 'estaras', el: 'estara', nosotros: 'estaremos', vosotros: 'estareis', ellos: 'estaran' },
        condicional:    { yo: 'estaria', tu: 'estarias', el: 'estaria', nosotros: 'estariamos', vosotros: 'estariais', ellos: 'estarian' },
        subjuntivo:     { yo: 'este', tu: 'estes', el: 'este', nosotros: 'estemos', vosotros: 'esteis', ellos: 'esten' },
        imperfecto_sub: { yo: 'estuviera', tu: 'estuvieras', el: 'estuviera', nosotros: 'estuvieramos', vosotros: 'estuvierais', ellos: 'estuvieran' },
      },
    },
    {
      infinitive: 'tener',
      conjugations: {
        presente:       { yo: 'tengo', tu: 'tienes', el: 'tiene', nosotros: 'tenemos', vosotros: 'teneis', ellos: 'tienen' },
        preterito:      { yo: 'tuve', tu: 'tuviste', el: 'tuvo', nosotros: 'tuvimos', vosotros: 'tuvisteis', ellos: 'tuvieron' },
        imperfecto:     { yo: 'tenia', tu: 'tenias', el: 'tenia', nosotros: 'teniamos', vosotros: 'teniais', ellos: 'tenian' },
        futuro:         { yo: 'tendre', tu: 'tendras', el: 'tendra', nosotros: 'tendremos', vosotros: 'tendreis', ellos: 'tendran' },
        condicional:    { yo: 'tendria', tu: 'tendrias', el: 'tendria', nosotros: 'tendriamos', vosotros: 'tendriais', ellos: 'tendrian' },
        subjuntivo:     { yo: 'tenga', tu: 'tengas', el: 'tenga', nosotros: 'tengamos', vosotros: 'tengais', ellos: 'tengan' },
        imperfecto_sub: { yo: 'tuviera', tu: 'tuvieras', el: 'tuviera', nosotros: 'tuvieramos', vosotros: 'tuvierais', ellos: 'tuvieran' },
      },
    },
    {
      infinitive: 'hacer',
      conjugations: {
        presente:       { yo: 'hago', tu: 'haces', el: 'hace', nosotros: 'hacemos', vosotros: 'haceis', ellos: 'hacen' },
        preterito:      { yo: 'hice', tu: 'hiciste', el: 'hizo', nosotros: 'hicimos', vosotros: 'hicisteis', ellos: 'hicieron' },
        imperfecto:     { yo: 'hacia', tu: 'hacias', el: 'hacia', nosotros: 'haciamos', vosotros: 'haciais', ellos: 'hacian' },
        futuro:         { yo: 'hare', tu: 'haras', el: 'hara', nosotros: 'haremos', vosotros: 'hareis', ellos: 'haran' },
        condicional:    { yo: 'haria', tu: 'harias', el: 'haria', nosotros: 'hariamos', vosotros: 'hariais', ellos: 'harian' },
        subjuntivo:     { yo: 'haga', tu: 'hagas', el: 'haga', nosotros: 'hagamos', vosotros: 'hagais', ellos: 'hagan' },
        imperfecto_sub: { yo: 'hiciera', tu: 'hicieras', el: 'hiciera', nosotros: 'hicieramos', vosotros: 'hicierais', ellos: 'hicieran' },
      },
    },
    {
      infinitive: 'ir',
      conjugations: {
        presente:       { yo: 'voy', tu: 'vas', el: 'va', nosotros: 'vamos', vosotros: 'vais', ellos: 'van' },
        preterito:      { yo: 'fui', tu: 'fuiste', el: 'fue', nosotros: 'fuimos', vosotros: 'fuisteis', ellos: 'fueron' },
        imperfecto:     { yo: 'iba', tu: 'ibas', el: 'iba', nosotros: 'ibamos', vosotros: 'ibais', ellos: 'iban' },
        futuro:         { yo: 'ire', tu: 'iras', el: 'ira', nosotros: 'iremos', vosotros: 'ireis', ellos: 'iran' },
        condicional:    { yo: 'iria', tu: 'irias', el: 'iria', nosotros: 'iriamos', vosotros: 'iriais', ellos: 'irian' },
        subjuntivo:     { yo: 'vaya', tu: 'vayas', el: 'vaya', nosotros: 'vayamos', vosotros: 'vayais', ellos: 'vayan' },
        imperfecto_sub: { yo: 'fuera', tu: 'fueras', el: 'fuera', nosotros: 'fueramos', vosotros: 'fuerais', ellos: 'fueran' },
      },
    },
    {
      infinitive: 'poder',
      conjugations: {
        presente:       { yo: 'puedo', tu: 'puedes', el: 'puede', nosotros: 'podemos', vosotros: 'podeis', ellos: 'pueden' },
        preterito:      { yo: 'pude', tu: 'pudiste', el: 'pudo', nosotros: 'pudimos', vosotros: 'pudisteis', ellos: 'pudieron' },
        imperfecto:     { yo: 'podia', tu: 'podias', el: 'podia', nosotros: 'podiamos', vosotros: 'podiais', ellos: 'podian' },
        futuro:         { yo: 'podre', tu: 'podras', el: 'podra', nosotros: 'podremos', vosotros: 'podreis', ellos: 'podran' },
        condicional:    { yo: 'podria', tu: 'podrias', el: 'podria', nosotros: 'podriamos', vosotros: 'podriais', ellos: 'podrian' },
        subjuntivo:     { yo: 'pueda', tu: 'puedas', el: 'pueda', nosotros: 'podamos', vosotros: 'podais', ellos: 'puedan' },
        imperfecto_sub: { yo: 'pudiera', tu: 'pudieras', el: 'pudiera', nosotros: 'pudieramos', vosotros: 'pudierais', ellos: 'pudieran' },
      },
    },
    {
      infinitive: 'decir',
      conjugations: {
        presente:       { yo: 'digo', tu: 'dices', el: 'dice', nosotros: 'decimos', vosotros: 'decis', ellos: 'dicen' },
        preterito:      { yo: 'dije', tu: 'dijiste', el: 'dijo', nosotros: 'dijimos', vosotros: 'dijisteis', ellos: 'dijeron' },
        imperfecto:     { yo: 'decia', tu: 'decias', el: 'decia', nosotros: 'deciamos', vosotros: 'deciais', ellos: 'decian' },
        futuro:         { yo: 'dire', tu: 'diras', el: 'dira', nosotros: 'diremos', vosotros: 'direis', ellos: 'diran' },
        condicional:    { yo: 'diria', tu: 'dirias', el: 'diria', nosotros: 'diriamos', vosotros: 'diriais', ellos: 'dirian' },
        subjuntivo:     { yo: 'diga', tu: 'digas', el: 'diga', nosotros: 'digamos', vosotros: 'digais', ellos: 'digan' },
        imperfecto_sub: { yo: 'dijera', tu: 'dijeras', el: 'dijera', nosotros: 'dijeramos', vosotros: 'dijerais', ellos: 'dijeran' },
      },
    },
    {
      infinitive: 'saber',
      conjugations: {
        presente:       { yo: 'se', tu: 'sabes', el: 'sabe', nosotros: 'sabemos', vosotros: 'sabeis', ellos: 'saben' },
        preterito:      { yo: 'supe', tu: 'supiste', el: 'supo', nosotros: 'supimos', vosotros: 'supisteis', ellos: 'supieron' },
        imperfecto:     { yo: 'sabia', tu: 'sabias', el: 'sabia', nosotros: 'sabiamos', vosotros: 'sabiais', ellos: 'sabian' },
        futuro:         { yo: 'sabre', tu: 'sabras', el: 'sabra', nosotros: 'sabremos', vosotros: 'sabreis', ellos: 'sabran' },
        condicional:    { yo: 'sabria', tu: 'sabrias', el: 'sabria', nosotros: 'sabriamos', vosotros: 'sabriais', ellos: 'sabrian' },
        subjuntivo:     { yo: 'sepa', tu: 'sepas', el: 'sepa', nosotros: 'sepamos', vosotros: 'sepais', ellos: 'sepan' },
        imperfecto_sub: { yo: 'supiera', tu: 'supieras', el: 'supiera', nosotros: 'supieramos', vosotros: 'supierais', ellos: 'supieran' },
      },
    },
    {
      infinitive: 'querer',
      conjugations: {
        presente:       { yo: 'quiero', tu: 'quieres', el: 'quiere', nosotros: 'queremos', vosotros: 'quereis', ellos: 'quieren' },
        preterito:      { yo: 'quise', tu: 'quisiste', el: 'quiso', nosotros: 'quisimos', vosotros: 'quisisteis', ellos: 'quisieron' },
        imperfecto:     { yo: 'queria', tu: 'querias', el: 'queria', nosotros: 'queriamos', vosotros: 'queriais', ellos: 'querian' },
        futuro:         { yo: 'querre', tu: 'querras', el: 'querra', nosotros: 'querremos', vosotros: 'querreis', ellos: 'querran' },
        condicional:    { yo: 'querria', tu: 'querrias', el: 'querria', nosotros: 'querriamos', vosotros: 'querriais', ellos: 'querrian' },
        subjuntivo:     { yo: 'quiera', tu: 'quieras', el: 'quiera', nosotros: 'queramos', vosotros: 'querais', ellos: 'quieran' },
        imperfecto_sub: { yo: 'quisiera', tu: 'quisieras', el: 'quisiera', nosotros: 'quisieramos', vosotros: 'quisierais', ellos: 'quisieran' },
      },
    },
    {
      infinitive: 'dar',
      conjugations: {
        presente:       { yo: 'doy', tu: 'das', el: 'da', nosotros: 'damos', vosotros: 'dais', ellos: 'dan' },
        preterito:      { yo: 'di', tu: 'diste', el: 'dio', nosotros: 'dimos', vosotros: 'disteis', ellos: 'dieron' },
        imperfecto:     { yo: 'daba', tu: 'dabas', el: 'daba', nosotros: 'dabamos', vosotros: 'dabais', ellos: 'daban' },
        futuro:         { yo: 'dare', tu: 'daras', el: 'dara', nosotros: 'daremos', vosotros: 'dareis', ellos: 'daran' },
        condicional:    { yo: 'daria', tu: 'darias', el: 'daria', nosotros: 'dariamos', vosotros: 'dariais', ellos: 'darian' },
        subjuntivo:     { yo: 'de', tu: 'des', el: 'de', nosotros: 'demos', vosotros: 'deis', ellos: 'den' },
        imperfecto_sub: { yo: 'diera', tu: 'dieras', el: 'diera', nosotros: 'dieramos', vosotros: 'dierais', ellos: 'dieran' },
      },
    },
    {
      infinitive: 'hablar',
      conjugations: {
        presente:       { yo: 'hablo', tu: 'hablas', el: 'habla', nosotros: 'hablamos', vosotros: 'hablais', ellos: 'hablan' },
        preterito:      { yo: 'hable', tu: 'hablaste', el: 'hablo', nosotros: 'hablamos', vosotros: 'hablasteis', ellos: 'hablaron' },
        imperfecto:     { yo: 'hablaba', tu: 'hablabas', el: 'hablaba', nosotros: 'hablabamos', vosotros: 'hablabais', ellos: 'hablaban' },
        futuro:         { yo: 'hablare', tu: 'hablaras', el: 'hablara', nosotros: 'hablaremos', vosotros: 'hablareis', ellos: 'hablaran' },
        condicional:    { yo: 'hablaria', tu: 'hablarias', el: 'hablaria', nosotros: 'hablariamos', vosotros: 'hablariais', ellos: 'hablarian' },
        subjuntivo:     { yo: 'hable', tu: 'hables', el: 'hable', nosotros: 'hablemos', vosotros: 'hableis', ellos: 'hablen' },
        imperfecto_sub: { yo: 'hablara', tu: 'hablaras', el: 'hablara', nosotros: 'hablaramos', vosotros: 'hablarais', ellos: 'hablaran' },
      },
    },
    {
      infinitive: 'comer',
      conjugations: {
        presente:       { yo: 'como', tu: 'comes', el: 'come', nosotros: 'comemos', vosotros: 'comeis', ellos: 'comen' },
        preterito:      { yo: 'comi', tu: 'comiste', el: 'comio', nosotros: 'comimos', vosotros: 'comisteis', ellos: 'comieron' },
        imperfecto:     { yo: 'comia', tu: 'comias', el: 'comia', nosotros: 'comiamos', vosotros: 'comiais', ellos: 'comian' },
        futuro:         { yo: 'comere', tu: 'comeras', el: 'comera', nosotros: 'comeremos', vosotros: 'comereis', ellos: 'comeran' },
        condicional:    { yo: 'comeria', tu: 'comerias', el: 'comeria', nosotros: 'comeriamos', vosotros: 'comeriais', ellos: 'comerian' },
        subjuntivo:     { yo: 'coma', tu: 'comas', el: 'coma', nosotros: 'comamos', vosotros: 'comais', ellos: 'coman' },
        imperfecto_sub: { yo: 'comiera', tu: 'comieras', el: 'comiera', nosotros: 'comieramos', vosotros: 'comierais', ellos: 'comieran' },
      },
    },
    {
      infinitive: 'vivir',
      conjugations: {
        presente:       { yo: 'vivo', tu: 'vives', el: 'vive', nosotros: 'vivimos', vosotros: 'vivis', ellos: 'viven' },
        preterito:      { yo: 'vivi', tu: 'viviste', el: 'vivio', nosotros: 'vivimos', vosotros: 'vivisteis', ellos: 'vivieron' },
        imperfecto:     { yo: 'vivia', tu: 'vivias', el: 'vivia', nosotros: 'viviamos', vosotros: 'viviais', ellos: 'vivian' },
        futuro:         { yo: 'vivire', tu: 'viviras', el: 'vivira', nosotros: 'viviremos', vosotros: 'vivireis', ellos: 'viviran' },
        condicional:    { yo: 'viviria', tu: 'vivirias', el: 'viviria', nosotros: 'viviriamos', vosotros: 'viviriais', ellos: 'vivirian' },
        subjuntivo:     { yo: 'viva', tu: 'vivas', el: 'viva', nosotros: 'vivamos', vosotros: 'vivais', ellos: 'vivan' },
        imperfecto_sub: { yo: 'viviera', tu: 'vivieras', el: 'viviera', nosotros: 'vivieramos', vosotros: 'vivierais', ellos: 'vivieran' },
      },
    },
    {
      infinitive: 'poner',
      conjugations: {
        presente:       { yo: 'pongo', tu: 'pones', el: 'pone', nosotros: 'ponemos', vosotros: 'poneis', ellos: 'ponen' },
        preterito:      { yo: 'puse', tu: 'pusiste', el: 'puso', nosotros: 'pusimos', vosotros: 'pusisteis', ellos: 'pusieron' },
        imperfecto:     { yo: 'ponia', tu: 'ponias', el: 'ponia', nosotros: 'poniamos', vosotros: 'poniais', ellos: 'ponian' },
        futuro:         { yo: 'pondre', tu: 'pondras', el: 'pondra', nosotros: 'pondremos', vosotros: 'pondreis', ellos: 'pondran' },
        condicional:    { yo: 'pondria', tu: 'pondrias', el: 'pondria', nosotros: 'pondriamos', vosotros: 'pondriais', ellos: 'pondrian' },
        subjuntivo:     { yo: 'ponga', tu: 'pongas', el: 'ponga', nosotros: 'pongamos', vosotros: 'pongais', ellos: 'pongan' },
        imperfecto_sub: { yo: 'pusiera', tu: 'pusieras', el: 'pusiera', nosotros: 'pusieramos', vosotros: 'pusierais', ellos: 'pusieran' },
      },
    },
    {
      infinitive: 'salir',
      conjugations: {
        presente:       { yo: 'salgo', tu: 'sales', el: 'sale', nosotros: 'salimos', vosotros: 'salis', ellos: 'salen' },
        preterito:      { yo: 'sali', tu: 'saliste', el: 'salio', nosotros: 'salimos', vosotros: 'salisteis', ellos: 'salieron' },
        imperfecto:     { yo: 'salia', tu: 'salias', el: 'salia', nosotros: 'saliamos', vosotros: 'saliais', ellos: 'salian' },
        futuro:         { yo: 'saldre', tu: 'saldras', el: 'saldra', nosotros: 'saldremos', vosotros: 'saldreis', ellos: 'saldran' },
        condicional:    { yo: 'saldria', tu: 'saldrias', el: 'saldria', nosotros: 'saldriamos', vosotros: 'saldriais', ellos: 'saldrian' },
        subjuntivo:     { yo: 'salga', tu: 'salgas', el: 'salga', nosotros: 'salgamos', vosotros: 'salgais', ellos: 'salgan' },
        imperfecto_sub: { yo: 'saliera', tu: 'salieras', el: 'saliera', nosotros: 'salieramos', vosotros: 'salierais', ellos: 'salieran' },
      },
    },
    {
      infinitive: 'venir',
      conjugations: {
        presente:       { yo: 'vengo', tu: 'vienes', el: 'viene', nosotros: 'venimos', vosotros: 'venis', ellos: 'vienen' },
        preterito:      { yo: 'vine', tu: 'viniste', el: 'vino', nosotros: 'vinimos', vosotros: 'vinisteis', ellos: 'vinieron' },
        imperfecto:     { yo: 'venia', tu: 'venias', el: 'venia', nosotros: 'veniamos', vosotros: 'veniais', ellos: 'venian' },
        futuro:         { yo: 'vendre', tu: 'vendras', el: 'vendra', nosotros: 'vendremos', vosotros: 'vendreis', ellos: 'vendran' },
        condicional:    { yo: 'vendria', tu: 'vendrias', el: 'vendria', nosotros: 'vendriamos', vosotros: 'vendriais', ellos: 'vendrian' },
        subjuntivo:     { yo: 'venga', tu: 'vengas', el: 'venga', nosotros: 'vengamos', vosotros: 'vengais', ellos: 'vengan' },
        imperfecto_sub: { yo: 'viniera', tu: 'vinieras', el: 'viniera', nosotros: 'vinieramos', vosotros: 'vinierais', ellos: 'vinieran' },
      },
    },
    {
      infinitive: 'ver',
      conjugations: {
        presente:       { yo: 'veo', tu: 'ves', el: 've', nosotros: 'vemos', vosotros: 'veis', ellos: 'ven' },
        preterito:      { yo: 'vi', tu: 'viste', el: 'vio', nosotros: 'vimos', vosotros: 'visteis', ellos: 'vieron' },
        imperfecto:     { yo: 'veia', tu: 'veias', el: 'veia', nosotros: 'veiamos', vosotros: 'veiais', ellos: 'veian' },
        futuro:         { yo: 'vere', tu: 'veras', el: 'vera', nosotros: 'veremos', vosotros: 'vereis', ellos: 'veran' },
        condicional:    { yo: 'veria', tu: 'verias', el: 'veria', nosotros: 'veriamos', vosotros: 'veriais', ellos: 'verian' },
        subjuntivo:     { yo: 'vea', tu: 'veas', el: 'vea', nosotros: 'veamos', vosotros: 'veais', ellos: 'vean' },
        imperfecto_sub: { yo: 'viera', tu: 'vieras', el: 'viera', nosotros: 'vieramos', vosotros: 'vierais', ellos: 'vieran' },
      },
    },
    {
      infinitive: 'conocer',
      conjugations: {
        presente:       { yo: 'conozco', tu: 'conoces', el: 'conoce', nosotros: 'conocemos', vosotros: 'conoceis', ellos: 'conocen' },
        preterito:      { yo: 'conoci', tu: 'conociste', el: 'conocio', nosotros: 'conocimos', vosotros: 'conocisteis', ellos: 'conocieron' },
        imperfecto:     { yo: 'conocia', tu: 'conocias', el: 'conocia', nosotros: 'conociamos', vosotros: 'conociais', ellos: 'conocian' },
        futuro:         { yo: 'conocere', tu: 'conoceras', el: 'conocera', nosotros: 'conoceremos', vosotros: 'conocereis', ellos: 'conoceran' },
        condicional:    { yo: 'conoceria', tu: 'conocerias', el: 'conoceria', nosotros: 'conoceriamos', vosotros: 'conoceriais', ellos: 'conocerian' },
        subjuntivo:     { yo: 'conozca', tu: 'conozcas', el: 'conozca', nosotros: 'conozcamos', vosotros: 'conozcais', ellos: 'conozcan' },
        imperfecto_sub: { yo: 'conociera', tu: 'conocieras', el: 'conociera', nosotros: 'conocieramos', vosotros: 'conocierais', ellos: 'conocieran' },
      },
    },
    {
      infinitive: 'pensar',
      conjugations: {
        presente:       { yo: 'pienso', tu: 'piensas', el: 'piensa', nosotros: 'pensamos', vosotros: 'pensais', ellos: 'piensan' },
        preterito:      { yo: 'pense', tu: 'pensaste', el: 'penso', nosotros: 'pensamos', vosotros: 'pensasteis', ellos: 'pensaron' },
        imperfecto:     { yo: 'pensaba', tu: 'pensabas', el: 'pensaba', nosotros: 'pensabamos', vosotros: 'pensabais', ellos: 'pensaban' },
        futuro:         { yo: 'pensare', tu: 'pensaras', el: 'pensara', nosotros: 'pensaremos', vosotros: 'pensareis', ellos: 'pensaran' },
        condicional:    { yo: 'pensaria', tu: 'pensarias', el: 'pensaria', nosotros: 'pensariamos', vosotros: 'pensariais', ellos: 'pensarian' },
        subjuntivo:     { yo: 'piense', tu: 'pienses', el: 'piense', nosotros: 'pensemos', vosotros: 'penseis', ellos: 'piensen' },
        imperfecto_sub: { yo: 'pensara', tu: 'pensaras', el: 'pensara', nosotros: 'pensaramos', vosotros: 'pensarais', ellos: 'pensaran' },
      },
    },
    {
      infinitive: 'dormir',
      conjugations: {
        presente:       { yo: 'duermo', tu: 'duermes', el: 'duerme', nosotros: 'dormimos', vosotros: 'dormis', ellos: 'duermen' },
        preterito:      { yo: 'dormi', tu: 'dormiste', el: 'durmio', nosotros: 'dormimos', vosotros: 'dormisteis', ellos: 'durmieron' },
        imperfecto:     { yo: 'dormia', tu: 'dormias', el: 'dormia', nosotros: 'dormiamos', vosotros: 'dormiais', ellos: 'dormian' },
        futuro:         { yo: 'dormire', tu: 'dormiras', el: 'dormira', nosotros: 'dormiremos', vosotros: 'dormireis', ellos: 'dormiran' },
        condicional:    { yo: 'dormiria', tu: 'dormirias', el: 'dormiria', nosotros: 'dormiriamos', vosotros: 'dormiriais', ellos: 'dormirian' },
        subjuntivo:     { yo: 'duerma', tu: 'duermas', el: 'duerma', nosotros: 'durmamos', vosotros: 'durmais', ellos: 'duerman' },
        imperfecto_sub: { yo: 'durmiera', tu: 'durmieras', el: 'durmiera', nosotros: 'durmieramos', vosotros: 'durmierais', ellos: 'durmieran' },
      },
    },
  ],
};

// ===========================================================================
// Portuguese (pt)
// ===========================================================================

const pt: LanguageConjugationData = {
  pronouns: ['eu', 'tu', 'ele', 'nos', 'eles'],
  tenses: [
    { key: 'presente', label: 'Presente do indicativo' },
    { key: 'perfeito', label: 'Preterito perfeito' },
    { key: 'imperfeito', label: 'Preterito imperfeito' },
    { key: 'futuro', label: 'Futuro do presente' },
    { key: 'condicional', label: 'Condicional' },
    { key: 'subjuntivo', label: 'Presente do subjuntivo' },
    { key: 'imperfeito_sub', label: 'Imperfeito do subjuntivo' },
  ],
  verbs: [
    {
      infinitive: 'ser',
      conjugations: {
        presente:       { eu: 'sou', tu: 'es', ele: 'e', nos: 'somos', eles: 'sao' },
        perfeito:       { eu: 'fui', tu: 'foste', ele: 'foi', nos: 'fomos', eles: 'foram' },
        imperfeito:     { eu: 'era', tu: 'eras', ele: 'era', nos: 'eramos', eles: 'eram' },
        futuro:         { eu: 'serei', tu: 'seras', ele: 'sera', nos: 'seremos', eles: 'serao' },
        condicional:    { eu: 'seria', tu: 'serias', ele: 'seria', nos: 'seriamos', eles: 'seriam' },
        subjuntivo:     { eu: 'seja', tu: 'sejas', ele: 'seja', nos: 'sejamos', eles: 'sejam' },
        imperfeito_sub: { eu: 'fosse', tu: 'fosses', ele: 'fosse', nos: 'fossemos', eles: 'fossem' },
      },
    },
    {
      infinitive: 'estar',
      conjugations: {
        presente:       { eu: 'estou', tu: 'estas', ele: 'esta', nos: 'estamos', eles: 'estao' },
        perfeito:       { eu: 'estive', tu: 'estiveste', ele: 'esteve', nos: 'estivemos', eles: 'estiveram' },
        imperfeito:     { eu: 'estava', tu: 'estavas', ele: 'estava', nos: 'estavamos', eles: 'estavam' },
        futuro:         { eu: 'estarei', tu: 'estaras', ele: 'estara', nos: 'estaremos', eles: 'estarao' },
        condicional:    { eu: 'estaria', tu: 'estarias', ele: 'estaria', nos: 'estariamos', eles: 'estariam' },
        subjuntivo:     { eu: 'esteja', tu: 'estejas', ele: 'esteja', nos: 'estejamos', eles: 'estejam' },
        imperfeito_sub: { eu: 'estivesse', tu: 'estivesses', ele: 'estivesse', nos: 'estivessemos', eles: 'estivessem' },
      },
    },
    {
      infinitive: 'ter',
      conjugations: {
        presente:       { eu: 'tenho', tu: 'tens', ele: 'tem', nos: 'temos', eles: 'tem' },
        perfeito:       { eu: 'tive', tu: 'tiveste', ele: 'teve', nos: 'tivemos', eles: 'tiveram' },
        imperfeito:     { eu: 'tinha', tu: 'tinhas', ele: 'tinha', nos: 'tinhamos', eles: 'tinham' },
        futuro:         { eu: 'terei', tu: 'teras', ele: 'tera', nos: 'teremos', eles: 'terao' },
        condicional:    { eu: 'teria', tu: 'terias', ele: 'teria', nos: 'teriamos', eles: 'teriam' },
        subjuntivo:     { eu: 'tenha', tu: 'tenhas', ele: 'tenha', nos: 'tenhamos', eles: 'tenham' },
        imperfeito_sub: { eu: 'tivesse', tu: 'tivesses', ele: 'tivesse', nos: 'tivessemos', eles: 'tivessem' },
      },
    },
    {
      infinitive: 'fazer',
      conjugations: {
        presente:       { eu: 'faco', tu: 'fazes', ele: 'faz', nos: 'fazemos', eles: 'fazem' },
        perfeito:       { eu: 'fiz', tu: 'fizeste', ele: 'fez', nos: 'fizemos', eles: 'fizeram' },
        imperfeito:     { eu: 'fazia', tu: 'fazias', ele: 'fazia', nos: 'faziamos', eles: 'faziam' },
        futuro:         { eu: 'farei', tu: 'faras', ele: 'fara', nos: 'faremos', eles: 'farao' },
        condicional:    { eu: 'faria', tu: 'farias', ele: 'faria', nos: 'fariamos', eles: 'fariam' },
        subjuntivo:     { eu: 'faca', tu: 'facas', ele: 'faca', nos: 'facamos', eles: 'facam' },
        imperfeito_sub: { eu: 'fizesse', tu: 'fizesses', ele: 'fizesse', nos: 'fizessemos', eles: 'fizessem' },
      },
    },
    {
      infinitive: 'ir',
      conjugations: {
        presente:       { eu: 'vou', tu: 'vais', ele: 'vai', nos: 'vamos', eles: 'vao' },
        perfeito:       { eu: 'fui', tu: 'foste', ele: 'foi', nos: 'fomos', eles: 'foram' },
        imperfeito:     { eu: 'ia', tu: 'ias', ele: 'ia', nos: 'iamos', eles: 'iam' },
        futuro:         { eu: 'irei', tu: 'iras', ele: 'ira', nos: 'iremos', eles: 'irao' },
        condicional:    { eu: 'iria', tu: 'irias', ele: 'iria', nos: 'iriamos', eles: 'iriam' },
        subjuntivo:     { eu: 'va', tu: 'vas', ele: 'va', nos: 'vamos', eles: 'vao' },
        imperfeito_sub: { eu: 'fosse', tu: 'fosses', ele: 'fosse', nos: 'fossemos', eles: 'fossem' },
      },
    },
    {
      infinitive: 'poder',
      conjugations: {
        presente:       { eu: 'posso', tu: 'podes', ele: 'pode', nos: 'podemos', eles: 'podem' },
        perfeito:       { eu: 'pude', tu: 'pudeste', ele: 'pode', nos: 'pudemos', eles: 'puderam' },
        imperfeito:     { eu: 'podia', tu: 'podias', ele: 'podia', nos: 'podiamos', eles: 'podiam' },
        futuro:         { eu: 'poderei', tu: 'poderas', ele: 'podera', nos: 'poderemos', eles: 'poderao' },
        condicional:    { eu: 'poderia', tu: 'poderias', ele: 'poderia', nos: 'poderiamos', eles: 'poderiam' },
        subjuntivo:     { eu: 'possa', tu: 'possas', ele: 'possa', nos: 'possamos', eles: 'possam' },
        imperfeito_sub: { eu: 'pudesse', tu: 'pudesses', ele: 'pudesse', nos: 'pudessemos', eles: 'pudessem' },
      },
    },
    {
      infinitive: 'dizer',
      conjugations: {
        presente:       { eu: 'digo', tu: 'dizes', ele: 'diz', nos: 'dizemos', eles: 'dizem' },
        perfeito:       { eu: 'disse', tu: 'disseste', ele: 'disse', nos: 'dissemos', eles: 'disseram' },
        imperfeito:     { eu: 'dizia', tu: 'dizias', ele: 'dizia', nos: 'diziamos', eles: 'diziam' },
        futuro:         { eu: 'direi', tu: 'diras', ele: 'dira', nos: 'diremos', eles: 'dirao' },
        condicional:    { eu: 'diria', tu: 'dirias', ele: 'diria', nos: 'diriamos', eles: 'diriam' },
        subjuntivo:     { eu: 'diga', tu: 'digas', ele: 'diga', nos: 'digamos', eles: 'digam' },
        imperfeito_sub: { eu: 'dissesse', tu: 'dissesses', ele: 'dissesse', nos: 'dissessemos', eles: 'dissessem' },
      },
    },
    {
      infinitive: 'saber',
      conjugations: {
        presente:       { eu: 'sei', tu: 'sabes', ele: 'sabe', nos: 'sabemos', eles: 'sabem' },
        perfeito:       { eu: 'soube', tu: 'soubeste', ele: 'soube', nos: 'soubemos', eles: 'souberam' },
        imperfeito:     { eu: 'sabia', tu: 'sabias', ele: 'sabia', nos: 'sabiamos', eles: 'sabiam' },
        futuro:         { eu: 'saberei', tu: 'saberas', ele: 'sabera', nos: 'saberemos', eles: 'saberao' },
        condicional:    { eu: 'saberia', tu: 'saberias', ele: 'saberia', nos: 'saberiamos', eles: 'saberiam' },
        subjuntivo:     { eu: 'saiba', tu: 'saibas', ele: 'saiba', nos: 'saibamos', eles: 'saibam' },
        imperfeito_sub: { eu: 'soubesse', tu: 'soubesses', ele: 'soubesse', nos: 'soubessemos', eles: 'soubessem' },
      },
    },
    {
      infinitive: 'querer',
      conjugations: {
        presente:       { eu: 'quero', tu: 'queres', ele: 'quer', nos: 'queremos', eles: 'querem' },
        perfeito:       { eu: 'quis', tu: 'quiseste', ele: 'quis', nos: 'quisemos', eles: 'quiseram' },
        imperfeito:     { eu: 'queria', tu: 'querias', ele: 'queria', nos: 'queriamos', eles: 'queriam' },
        futuro:         { eu: 'quererei', tu: 'quereras', ele: 'querera', nos: 'quereremos', eles: 'quererao' },
        condicional:    { eu: 'quereria', tu: 'quererias', ele: 'quereria', nos: 'quereriamos', eles: 'quereriam' },
        subjuntivo:     { eu: 'queira', tu: 'queiras', ele: 'queira', nos: 'queiramos', eles: 'queiram' },
        imperfeito_sub: { eu: 'quisesse', tu: 'quisesses', ele: 'quisesse', nos: 'quisessemos', eles: 'quisessem' },
      },
    },
    {
      infinitive: 'dar',
      conjugations: {
        presente:       { eu: 'dou', tu: 'das', ele: 'da', nos: 'damos', eles: 'dao' },
        perfeito:       { eu: 'dei', tu: 'deste', ele: 'deu', nos: 'demos', eles: 'deram' },
        imperfeito:     { eu: 'dava', tu: 'davas', ele: 'dava', nos: 'davamos', eles: 'davam' },
        futuro:         { eu: 'darei', tu: 'daras', ele: 'dara', nos: 'daremos', eles: 'darao' },
        condicional:    { eu: 'daria', tu: 'darias', ele: 'daria', nos: 'dariamos', eles: 'dariam' },
        subjuntivo:     { eu: 'de', tu: 'des', ele: 'de', nos: 'demos', eles: 'deem' },
        imperfeito_sub: { eu: 'desse', tu: 'desses', ele: 'desse', nos: 'dessemos', eles: 'dessem' },
      },
    },
    {
      infinitive: 'falar',
      conjugations: {
        presente:       { eu: 'falo', tu: 'falas', ele: 'fala', nos: 'falamos', eles: 'falam' },
        perfeito:       { eu: 'falei', tu: 'falaste', ele: 'falou', nos: 'falamos', eles: 'falaram' },
        imperfeito:     { eu: 'falava', tu: 'falavas', ele: 'falava', nos: 'falavamos', eles: 'falavam' },
        futuro:         { eu: 'falarei', tu: 'falaras', ele: 'falara', nos: 'falaremos', eles: 'falarao' },
        condicional:    { eu: 'falaria', tu: 'falarias', ele: 'falaria', nos: 'falariamos', eles: 'falariam' },
        subjuntivo:     { eu: 'fale', tu: 'fales', ele: 'fale', nos: 'falemos', eles: 'falem' },
        imperfeito_sub: { eu: 'falasse', tu: 'falasses', ele: 'falasse', nos: 'falassemos', eles: 'falassem' },
      },
    },
    {
      infinitive: 'comer',
      conjugations: {
        presente:       { eu: 'como', tu: 'comes', ele: 'come', nos: 'comemos', eles: 'comem' },
        perfeito:       { eu: 'comi', tu: 'comeste', ele: 'comeu', nos: 'comemos', eles: 'comeram' },
        imperfeito:     { eu: 'comia', tu: 'comias', ele: 'comia', nos: 'comiamos', eles: 'comiam' },
        futuro:         { eu: 'comerei', tu: 'comeras', ele: 'comera', nos: 'comeremos', eles: 'comerao' },
        condicional:    { eu: 'comeria', tu: 'comerias', ele: 'comeria', nos: 'comeriamos', eles: 'comeriam' },
        subjuntivo:     { eu: 'coma', tu: 'comas', ele: 'coma', nos: 'comamos', eles: 'comam' },
        imperfeito_sub: { eu: 'comesse', tu: 'comesses', ele: 'comesse', nos: 'comessemos', eles: 'comessem' },
      },
    },
    {
      infinitive: 'viver',
      conjugations: {
        presente:       { eu: 'vivo', tu: 'vives', ele: 'vive', nos: 'vivemos', eles: 'vivem' },
        perfeito:       { eu: 'vivi', tu: 'viveste', ele: 'viveu', nos: 'vivemos', eles: 'viveram' },
        imperfeito:     { eu: 'vivia', tu: 'vivias', ele: 'vivia', nos: 'viviamos', eles: 'viviam' },
        futuro:         { eu: 'viverei', tu: 'viveras', ele: 'vivera', nos: 'viveremos', eles: 'viverao' },
        condicional:    { eu: 'viveria', tu: 'viverias', ele: 'viveria', nos: 'viveriamos', eles: 'viveriam' },
        subjuntivo:     { eu: 'viva', tu: 'vivas', ele: 'viva', nos: 'vivamos', eles: 'vivam' },
        imperfeito_sub: { eu: 'vivesse', tu: 'vivesses', ele: 'vivesse', nos: 'vivessemos', eles: 'vivessem' },
      },
    },
    {
      infinitive: 'por',
      conjugations: {
        presente:       { eu: 'ponho', tu: 'poes', ele: 'poe', nos: 'pomos', eles: 'poem' },
        perfeito:       { eu: 'pus', tu: 'puseste', ele: 'pos', nos: 'pusemos', eles: 'puseram' },
        imperfeito:     { eu: 'punha', tu: 'punhas', ele: 'punha', nos: 'punhamos', eles: 'punham' },
        futuro:         { eu: 'porei', tu: 'poras', ele: 'pora', nos: 'poremos', eles: 'porao' },
        condicional:    { eu: 'poria', tu: 'porias', ele: 'poria', nos: 'poriamos', eles: 'poriam' },
        subjuntivo:     { eu: 'ponha', tu: 'ponhas', ele: 'ponha', nos: 'ponhamos', eles: 'ponham' },
        imperfeito_sub: { eu: 'pusesse', tu: 'pusesses', ele: 'pusesse', nos: 'pusessemos', eles: 'pusessem' },
      },
    },
    {
      infinitive: 'sair',
      conjugations: {
        presente:       { eu: 'saio', tu: 'sais', ele: 'sai', nos: 'saimos', eles: 'saem' },
        perfeito:       { eu: 'sai', tu: 'saiste', ele: 'saiu', nos: 'saimos', eles: 'sairam' },
        imperfeito:     { eu: 'saia', tu: 'saias', ele: 'saia', nos: 'saiamos', eles: 'saiam' },
        futuro:         { eu: 'sairei', tu: 'sairas', ele: 'saira', nos: 'sairemos', eles: 'sairao' },
        condicional:    { eu: 'sairia', tu: 'sairias', ele: 'sairia', nos: 'sairiamos', eles: 'sairiam' },
        subjuntivo:     { eu: 'saia', tu: 'saias', ele: 'saia', nos: 'saiamos', eles: 'saiam' },
        imperfeito_sub: { eu: 'saisse', tu: 'saisses', ele: 'saisse', nos: 'saissemos', eles: 'saissem' },
      },
    },
    {
      infinitive: 'vir',
      conjugations: {
        presente:       { eu: 'venho', tu: 'vens', ele: 'vem', nos: 'vimos', eles: 'vem' },
        perfeito:       { eu: 'vim', tu: 'vieste', ele: 'veio', nos: 'viemos', eles: 'vieram' },
        imperfeito:     { eu: 'vinha', tu: 'vinhas', ele: 'vinha', nos: 'vinhamos', eles: 'vinham' },
        futuro:         { eu: 'virei', tu: 'viras', ele: 'vira', nos: 'viremos', eles: 'virao' },
        condicional:    { eu: 'viria', tu: 'virias', ele: 'viria', nos: 'viriamos', eles: 'viriam' },
        subjuntivo:     { eu: 'venha', tu: 'venhas', ele: 'venha', nos: 'venhamos', eles: 'venham' },
        imperfeito_sub: { eu: 'viesse', tu: 'viesses', ele: 'viesse', nos: 'viessemos', eles: 'viessem' },
      },
    },
    {
      infinitive: 'ver',
      conjugations: {
        presente:       { eu: 'vejo', tu: 'ves', ele: 've', nos: 'vemos', eles: 'veem' },
        perfeito:       { eu: 'vi', tu: 'viste', ele: 'viu', nos: 'vimos', eles: 'viram' },
        imperfeito:     { eu: 'via', tu: 'vias', ele: 'via', nos: 'viamos', eles: 'viam' },
        futuro:         { eu: 'verei', tu: 'veras', ele: 'vera', nos: 'veremos', eles: 'verao' },
        condicional:    { eu: 'veria', tu: 'verias', ele: 'veria', nos: 'veriamos', eles: 'veriam' },
        subjuntivo:     { eu: 'veja', tu: 'vejas', ele: 'veja', nos: 'vejamos', eles: 'vejam' },
        imperfeito_sub: { eu: 'visse', tu: 'visses', ele: 'visse', nos: 'vissemos', eles: 'vissem' },
      },
    },
    {
      infinitive: 'conhecer',
      conjugations: {
        presente:       { eu: 'conheco', tu: 'conheces', ele: 'conhece', nos: 'conhecemos', eles: 'conhecem' },
        perfeito:       { eu: 'conheci', tu: 'conheceste', ele: 'conheceu', nos: 'conhecemos', eles: 'conheceram' },
        imperfeito:     { eu: 'conhecia', tu: 'conhecias', ele: 'conhecia', nos: 'conheciamos', eles: 'conheciam' },
        futuro:         { eu: 'conhecerei', tu: 'conheceras', ele: 'conhecera', nos: 'conheceremos', eles: 'conhecerao' },
        condicional:    { eu: 'conheceria', tu: 'conhecerias', ele: 'conheceria', nos: 'conheceriamos', eles: 'conheceriam' },
        subjuntivo:     { eu: 'conheca', tu: 'conhecas', ele: 'conheca', nos: 'conhecamos', eles: 'conhecam' },
        imperfeito_sub: { eu: 'conhecesse', tu: 'conhecesses', ele: 'conhecesse', nos: 'conhecessemos', eles: 'conhecessem' },
      },
    },
    {
      infinitive: 'pensar',
      conjugations: {
        presente:       { eu: 'penso', tu: 'pensas', ele: 'pensa', nos: 'pensamos', eles: 'pensam' },
        perfeito:       { eu: 'pensei', tu: 'pensaste', ele: 'pensou', nos: 'pensamos', eles: 'pensaram' },
        imperfeito:     { eu: 'pensava', tu: 'pensavas', ele: 'pensava', nos: 'pensavamos', eles: 'pensavam' },
        futuro:         { eu: 'pensarei', tu: 'pensaras', ele: 'pensara', nos: 'pensaremos', eles: 'pensarao' },
        condicional:    { eu: 'pensaria', tu: 'pensarias', ele: 'pensaria', nos: 'pensariamos', eles: 'pensariam' },
        subjuntivo:     { eu: 'pense', tu: 'penses', ele: 'pense', nos: 'pensemos', eles: 'pensem' },
        imperfeito_sub: { eu: 'pensasse', tu: 'pensasses', ele: 'pensasse', nos: 'pensassemos', eles: 'pensassem' },
      },
    },
    {
      infinitive: 'dormir',
      conjugations: {
        presente:       { eu: 'durmo', tu: 'dormes', ele: 'dorme', nos: 'dormimos', eles: 'dormem' },
        perfeito:       { eu: 'dormi', tu: 'dormiste', ele: 'dormiu', nos: 'dormimos', eles: 'dormiram' },
        imperfeito:     { eu: 'dormia', tu: 'dormias', ele: 'dormia', nos: 'dormiamos', eles: 'dormiam' },
        futuro:         { eu: 'dormirei', tu: 'dormiras', ele: 'dormira', nos: 'dormiremos', eles: 'dormirao' },
        condicional:    { eu: 'dormiria', tu: 'dormirias', ele: 'dormiria', nos: 'dormiriamos', eles: 'dormiriam' },
        subjuntivo:     { eu: 'durma', tu: 'durmas', ele: 'durma', nos: 'durmamos', eles: 'durmam' },
        imperfeito_sub: { eu: 'dormisse', tu: 'dormisses', ele: 'dormisse', nos: 'dormissemos', eles: 'dormissem' },
      },
    },
  ],
};

// ===========================================================================
// French (fr)
// ===========================================================================

const fr: LanguageConjugationData = {
  pronouns: ['je', 'tu', 'il', 'nous', 'vous', 'ils'],
  tenses: [
    { key: 'present', label: 'Present' },
    { key: 'imparfait', label: 'Imparfait' },
    { key: 'passe_simple', label: 'Passe simple' },
    { key: 'futur', label: 'Futur simple' },
    { key: 'conditionnel', label: 'Conditionnel present' },
    { key: 'subjonctif', label: 'Subjonctif present' },
  ],
  verbs: [
    {
      infinitive: 'etre',
      conjugations: {
        present:      { je: 'suis', tu: 'es', il: 'est', nous: 'sommes', vous: 'etes', ils: 'sont' },
        imparfait:    { je: 'etais', tu: 'etais', il: 'etait', nous: 'etions', vous: 'etiez', ils: 'etaient' },
        passe_simple: { je: 'fus', tu: 'fus', il: 'fut', nous: 'fumes', vous: 'futes', ils: 'furent' },
        futur:        { je: 'serai', tu: 'seras', il: 'sera', nous: 'serons', vous: 'serez', ils: 'seront' },
        conditionnel: { je: 'serais', tu: 'serais', il: 'serait', nous: 'serions', vous: 'seriez', ils: 'seraient' },
        subjonctif:   { je: 'sois', tu: 'sois', il: 'soit', nous: 'soyons', vous: 'soyez', ils: 'soient' },
      },
    },
    {
      infinitive: 'avoir',
      conjugations: {
        present:      { je: 'ai', tu: 'as', il: 'a', nous: 'avons', vous: 'avez', ils: 'ont' },
        imparfait:    { je: 'avais', tu: 'avais', il: 'avait', nous: 'avions', vous: 'aviez', ils: 'avaient' },
        passe_simple: { je: 'eus', tu: 'eus', il: 'eut', nous: 'eumes', vous: 'eutes', ils: 'eurent' },
        futur:        { je: 'aurai', tu: 'auras', il: 'aura', nous: 'aurons', vous: 'aurez', ils: 'auront' },
        conditionnel: { je: 'aurais', tu: 'aurais', il: 'aurait', nous: 'aurions', vous: 'auriez', ils: 'auraient' },
        subjonctif:   { je: 'aie', tu: 'aies', il: 'ait', nous: 'ayons', vous: 'ayez', ils: 'aient' },
      },
    },
    {
      infinitive: 'aller',
      conjugations: {
        present:      { je: 'vais', tu: 'vas', il: 'va', nous: 'allons', vous: 'allez', ils: 'vont' },
        imparfait:    { je: 'allais', tu: 'allais', il: 'allait', nous: 'allions', vous: 'alliez', ils: 'allaient' },
        passe_simple: { je: 'allai', tu: 'allas', il: 'alla', nous: 'allames', vous: 'allates', ils: 'allerent' },
        futur:        { je: 'irai', tu: 'iras', il: 'ira', nous: 'irons', vous: 'irez', ils: 'iront' },
        conditionnel: { je: 'irais', tu: 'irais', il: 'irait', nous: 'irions', vous: 'iriez', ils: 'iraient' },
        subjonctif:   { je: 'aille', tu: 'ailles', il: 'aille', nous: 'allions', vous: 'alliez', ils: 'aillent' },
      },
    },
    {
      infinitive: 'faire',
      conjugations: {
        present:      { je: 'fais', tu: 'fais', il: 'fait', nous: 'faisons', vous: 'faites', ils: 'font' },
        imparfait:    { je: 'faisais', tu: 'faisais', il: 'faisait', nous: 'faisions', vous: 'faisiez', ils: 'faisaient' },
        passe_simple: { je: 'fis', tu: 'fis', il: 'fit', nous: 'fimes', vous: 'fites', ils: 'firent' },
        futur:        { je: 'ferai', tu: 'feras', il: 'fera', nous: 'ferons', vous: 'ferez', ils: 'feront' },
        conditionnel: { je: 'ferais', tu: 'ferais', il: 'ferait', nous: 'ferions', vous: 'feriez', ils: 'feraient' },
        subjonctif:   { je: 'fasse', tu: 'fasses', il: 'fasse', nous: 'fassions', vous: 'fassiez', ils: 'fassent' },
      },
    },
    {
      infinitive: 'pouvoir',
      conjugations: {
        present:      { je: 'peux', tu: 'peux', il: 'peut', nous: 'pouvons', vous: 'pouvez', ils: 'peuvent' },
        imparfait:    { je: 'pouvais', tu: 'pouvais', il: 'pouvait', nous: 'pouvions', vous: 'pouviez', ils: 'pouvaient' },
        passe_simple: { je: 'pus', tu: 'pus', il: 'put', nous: 'pumes', vous: 'putes', ils: 'purent' },
        futur:        { je: 'pourrai', tu: 'pourras', il: 'pourra', nous: 'pourrons', vous: 'pourrez', ils: 'pourront' },
        conditionnel: { je: 'pourrais', tu: 'pourrais', il: 'pourrait', nous: 'pourrions', vous: 'pourriez', ils: 'pourraient' },
        subjonctif:   { je: 'puisse', tu: 'puisses', il: 'puisse', nous: 'puissions', vous: 'puissiez', ils: 'puissent' },
      },
    },
    {
      infinitive: 'vouloir',
      conjugations: {
        present:      { je: 'veux', tu: 'veux', il: 'veut', nous: 'voulons', vous: 'voulez', ils: 'veulent' },
        imparfait:    { je: 'voulais', tu: 'voulais', il: 'voulait', nous: 'voulions', vous: 'vouliez', ils: 'voulaient' },
        passe_simple: { je: 'voulus', tu: 'voulus', il: 'voulut', nous: 'voulumes', vous: 'voulutes', ils: 'voulurent' },
        futur:        { je: 'voudrai', tu: 'voudras', il: 'voudra', nous: 'voudrons', vous: 'voudrez', ils: 'voudront' },
        conditionnel: { je: 'voudrais', tu: 'voudrais', il: 'voudrait', nous: 'voudrions', vous: 'voudriez', ils: 'voudraient' },
        subjonctif:   { je: 'veuille', tu: 'veuilles', il: 'veuille', nous: 'voulions', vous: 'vouliez', ils: 'veuillent' },
      },
    },
    {
      infinitive: 'devoir',
      conjugations: {
        present:      { je: 'dois', tu: 'dois', il: 'doit', nous: 'devons', vous: 'devez', ils: 'doivent' },
        imparfait:    { je: 'devais', tu: 'devais', il: 'devait', nous: 'devions', vous: 'deviez', ils: 'devaient' },
        passe_simple: { je: 'dus', tu: 'dus', il: 'dut', nous: 'dumes', vous: 'dutes', ils: 'durent' },
        futur:        { je: 'devrai', tu: 'devras', il: 'devra', nous: 'devrons', vous: 'devrez', ils: 'devront' },
        conditionnel: { je: 'devrais', tu: 'devrais', il: 'devrait', nous: 'devrions', vous: 'devriez', ils: 'devraient' },
        subjonctif:   { je: 'doive', tu: 'doives', il: 'doive', nous: 'devions', vous: 'deviez', ils: 'doivent' },
      },
    },
    {
      infinitive: 'savoir',
      conjugations: {
        present:      { je: 'sais', tu: 'sais', il: 'sait', nous: 'savons', vous: 'savez', ils: 'savent' },
        imparfait:    { je: 'savais', tu: 'savais', il: 'savait', nous: 'savions', vous: 'saviez', ils: 'savaient' },
        passe_simple: { je: 'sus', tu: 'sus', il: 'sut', nous: 'sumes', vous: 'sutes', ils: 'surent' },
        futur:        { je: 'saurai', tu: 'sauras', il: 'saura', nous: 'saurons', vous: 'saurez', ils: 'sauront' },
        conditionnel: { je: 'saurais', tu: 'saurais', il: 'saurait', nous: 'saurions', vous: 'sauriez', ils: 'sauraient' },
        subjonctif:   { je: 'sache', tu: 'saches', il: 'sache', nous: 'sachions', vous: 'sachiez', ils: 'sachent' },
      },
    },
    {
      infinitive: 'voir',
      conjugations: {
        present:      { je: 'vois', tu: 'vois', il: 'voit', nous: 'voyons', vous: 'voyez', ils: 'voient' },
        imparfait:    { je: 'voyais', tu: 'voyais', il: 'voyait', nous: 'voyions', vous: 'voyiez', ils: 'voyaient' },
        passe_simple: { je: 'vis', tu: 'vis', il: 'vit', nous: 'vimes', vous: 'vites', ils: 'virent' },
        futur:        { je: 'verrai', tu: 'verras', il: 'verra', nous: 'verrons', vous: 'verrez', ils: 'verront' },
        conditionnel: { je: 'verrais', tu: 'verrais', il: 'verrait', nous: 'verrions', vous: 'verriez', ils: 'verraient' },
        subjonctif:   { je: 'voie', tu: 'voies', il: 'voie', nous: 'voyions', vous: 'voyiez', ils: 'voient' },
      },
    },
    {
      infinitive: 'prendre',
      conjugations: {
        present:      { je: 'prends', tu: 'prends', il: 'prend', nous: 'prenons', vous: 'prenez', ils: 'prennent' },
        imparfait:    { je: 'prenais', tu: 'prenais', il: 'prenait', nous: 'prenions', vous: 'preniez', ils: 'prenaient' },
        passe_simple: { je: 'pris', tu: 'pris', il: 'prit', nous: 'primes', vous: 'prites', ils: 'prirent' },
        futur:        { je: 'prendrai', tu: 'prendras', il: 'prendra', nous: 'prendrons', vous: 'prendrez', ils: 'prendront' },
        conditionnel: { je: 'prendrais', tu: 'prendrais', il: 'prendrait', nous: 'prendrions', vous: 'prendriez', ils: 'prendraient' },
        subjonctif:   { je: 'prenne', tu: 'prennes', il: 'prenne', nous: 'prenions', vous: 'preniez', ils: 'prennent' },
      },
    },
    {
      infinitive: 'parler',
      conjugations: {
        present:      { je: 'parle', tu: 'parles', il: 'parle', nous: 'parlons', vous: 'parlez', ils: 'parlent' },
        imparfait:    { je: 'parlais', tu: 'parlais', il: 'parlait', nous: 'parlions', vous: 'parliez', ils: 'parlaient' },
        passe_simple: { je: 'parlai', tu: 'parlas', il: 'parla', nous: 'parlames', vous: 'parlates', ils: 'parlerent' },
        futur:        { je: 'parlerai', tu: 'parleras', il: 'parlera', nous: 'parlerons', vous: 'parlerez', ils: 'parleront' },
        conditionnel: { je: 'parlerais', tu: 'parlerais', il: 'parlerait', nous: 'parlerions', vous: 'parleriez', ils: 'parleraient' },
        subjonctif:   { je: 'parle', tu: 'parles', il: 'parle', nous: 'parlions', vous: 'parliez', ils: 'parlent' },
      },
    },
    {
      infinitive: 'manger',
      conjugations: {
        present:      { je: 'mange', tu: 'manges', il: 'mange', nous: 'mangeons', vous: 'mangez', ils: 'mangent' },
        imparfait:    { je: 'mangeais', tu: 'mangeais', il: 'mangeait', nous: 'mangions', vous: 'mangiez', ils: 'mangeaient' },
        passe_simple: { je: 'mangeai', tu: 'mangeas', il: 'mangea', nous: 'mangeames', vous: 'mangeates', ils: 'mangerent' },
        futur:        { je: 'mangerai', tu: 'mangeras', il: 'mangera', nous: 'mangerons', vous: 'mangerez', ils: 'mangeront' },
        conditionnel: { je: 'mangerais', tu: 'mangerais', il: 'mangerait', nous: 'mangerions', vous: 'mangeriez', ils: 'mangeraient' },
        subjonctif:   { je: 'mange', tu: 'manges', il: 'mange', nous: 'mangions', vous: 'mangiez', ils: 'mangent' },
      },
    },
    {
      infinitive: 'finir',
      conjugations: {
        present:      { je: 'finis', tu: 'finis', il: 'finit', nous: 'finissons', vous: 'finissez', ils: 'finissent' },
        imparfait:    { je: 'finissais', tu: 'finissais', il: 'finissait', nous: 'finissions', vous: 'finissiez', ils: 'finissaient' },
        passe_simple: { je: 'finis', tu: 'finis', il: 'finit', nous: 'finimes', vous: 'finites', ils: 'finirent' },
        futur:        { je: 'finirai', tu: 'finiras', il: 'finira', nous: 'finirons', vous: 'finirez', ils: 'finiront' },
        conditionnel: { je: 'finirais', tu: 'finirais', il: 'finirait', nous: 'finirions', vous: 'finiriez', ils: 'finiraient' },
        subjonctif:   { je: 'finisse', tu: 'finisses', il: 'finisse', nous: 'finissions', vous: 'finissiez', ils: 'finissent' },
      },
    },
    {
      infinitive: 'venir',
      conjugations: {
        present:      { je: 'viens', tu: 'viens', il: 'vient', nous: 'venons', vous: 'venez', ils: 'viennent' },
        imparfait:    { je: 'venais', tu: 'venais', il: 'venait', nous: 'venions', vous: 'veniez', ils: 'venaient' },
        passe_simple: { je: 'vins', tu: 'vins', il: 'vint', nous: 'vinmes', vous: 'vintes', ils: 'vinrent' },
        futur:        { je: 'viendrai', tu: 'viendras', il: 'viendra', nous: 'viendrons', vous: 'viendrez', ils: 'viendront' },
        conditionnel: { je: 'viendrais', tu: 'viendrais', il: 'viendrait', nous: 'viendrions', vous: 'viendriez', ils: 'viendraient' },
        subjonctif:   { je: 'vienne', tu: 'viennes', il: 'vienne', nous: 'venions', vous: 'veniez', ils: 'viennent' },
      },
    },
    {
      infinitive: 'dire',
      conjugations: {
        present:      { je: 'dis', tu: 'dis', il: 'dit', nous: 'disons', vous: 'dites', ils: 'disent' },
        imparfait:    { je: 'disais', tu: 'disais', il: 'disait', nous: 'disions', vous: 'disiez', ils: 'disaient' },
        passe_simple: { je: 'dis', tu: 'dis', il: 'dit', nous: 'dimes', vous: 'dites', ils: 'dirent' },
        futur:        { je: 'dirai', tu: 'diras', il: 'dira', nous: 'dirons', vous: 'direz', ils: 'diront' },
        conditionnel: { je: 'dirais', tu: 'dirais', il: 'dirait', nous: 'dirions', vous: 'diriez', ils: 'diraient' },
        subjonctif:   { je: 'dise', tu: 'dises', il: 'dise', nous: 'disions', vous: 'disiez', ils: 'disent' },
      },
    },
    {
      infinitive: 'mettre',
      conjugations: {
        present:      { je: 'mets', tu: 'mets', il: 'met', nous: 'mettons', vous: 'mettez', ils: 'mettent' },
        imparfait:    { je: 'mettais', tu: 'mettais', il: 'mettait', nous: 'mettions', vous: 'mettiez', ils: 'mettaient' },
        passe_simple: { je: 'mis', tu: 'mis', il: 'mit', nous: 'mimes', vous: 'mites', ils: 'mirent' },
        futur:        { je: 'mettrai', tu: 'mettras', il: 'mettra', nous: 'mettrons', vous: 'mettrez', ils: 'mettront' },
        conditionnel: { je: 'mettrais', tu: 'mettrais', il: 'mettrait', nous: 'mettrions', vous: 'mettriez', ils: 'mettraient' },
        subjonctif:   { je: 'mette', tu: 'mettes', il: 'mette', nous: 'mettions', vous: 'mettiez', ils: 'mettent' },
      },
    },
    {
      infinitive: 'partir',
      conjugations: {
        present:      { je: 'pars', tu: 'pars', il: 'part', nous: 'partons', vous: 'partez', ils: 'partent' },
        imparfait:    { je: 'partais', tu: 'partais', il: 'partait', nous: 'partions', vous: 'partiez', ils: 'partaient' },
        passe_simple: { je: 'partis', tu: 'partis', il: 'partit', nous: 'partimes', vous: 'partites', ils: 'partirent' },
        futur:        { je: 'partirai', tu: 'partiras', il: 'partira', nous: 'partirons', vous: 'partirez', ils: 'partiront' },
        conditionnel: { je: 'partirais', tu: 'partirais', il: 'partirait', nous: 'partirions', vous: 'partiriez', ils: 'partiraient' },
        subjonctif:   { je: 'parte', tu: 'partes', il: 'parte', nous: 'partions', vous: 'partiez', ils: 'partent' },
      },
    },
    {
      infinitive: 'connaitre',
      conjugations: {
        present:      { je: 'connais', tu: 'connais', il: 'connait', nous: 'connaissons', vous: 'connaissez', ils: 'connaissent' },
        imparfait:    { je: 'connaissais', tu: 'connaissais', il: 'connaissait', nous: 'connaissions', vous: 'connaissiez', ils: 'connaissaient' },
        passe_simple: { je: 'connus', tu: 'connus', il: 'connut', nous: 'connumes', vous: 'connutes', ils: 'connurent' },
        futur:        { je: 'connaitrai', tu: 'connaitras', il: 'connaitra', nous: 'connaitrons', vous: 'connaitrez', ils: 'connaitront' },
        conditionnel: { je: 'connaitrais', tu: 'connaitrais', il: 'connaitrait', nous: 'connaitrions', vous: 'connaitriez', ils: 'connaitraient' },
        subjonctif:   { je: 'connaisse', tu: 'connaisses', il: 'connaisse', nous: 'connaissions', vous: 'connaissiez', ils: 'connaissent' },
      },
    },
    {
      infinitive: 'lire',
      conjugations: {
        present:      { je: 'lis', tu: 'lis', il: 'lit', nous: 'lisons', vous: 'lisez', ils: 'lisent' },
        imparfait:    { je: 'lisais', tu: 'lisais', il: 'lisait', nous: 'lisions', vous: 'lisiez', ils: 'lisaient' },
        passe_simple: { je: 'lus', tu: 'lus', il: 'lut', nous: 'lumes', vous: 'lutes', ils: 'lurent' },
        futur:        { je: 'lirai', tu: 'liras', il: 'lira', nous: 'lirons', vous: 'lirez', ils: 'liront' },
        conditionnel: { je: 'lirais', tu: 'lirais', il: 'lirait', nous: 'lirions', vous: 'liriez', ils: 'liraient' },
        subjonctif:   { je: 'lise', tu: 'lises', il: 'lise', nous: 'lisions', vous: 'lisiez', ils: 'lisent' },
      },
    },
    {
      infinitive: 'ecrire',
      conjugations: {
        present:      { je: 'ecris', tu: 'ecris', il: 'ecrit', nous: 'ecrivons', vous: 'ecrivez', ils: 'ecrivent' },
        imparfait:    { je: 'ecrivais', tu: 'ecrivais', il: 'ecrivait', nous: 'ecrivions', vous: 'ecriviez', ils: 'ecrivaient' },
        passe_simple: { je: 'ecrivis', tu: 'ecrivis', il: 'ecrivit', nous: 'ecrivimes', vous: 'ecrivites', ils: 'ecrivirent' },
        futur:        { je: 'ecrirai', tu: 'ecriras', il: 'ecrira', nous: 'ecrirons', vous: 'ecrirez', ils: 'ecriront' },
        conditionnel: { je: 'ecrirais', tu: 'ecrirais', il: 'ecrirait', nous: 'ecririons', vous: 'ecririez', ils: 'ecriraient' },
        subjonctif:   { je: 'ecrive', tu: 'ecrives', il: 'ecrive', nous: 'ecrivions', vous: 'ecriviez', ils: 'ecrivent' },
      },
    },
  ],
};

// ===========================================================================
// German (de)
// ===========================================================================

const de: LanguageConjugationData = {
  pronouns: ['ich', 'du', 'er', 'wir', 'ihr', 'sie'],
  tenses: [
    { key: 'prasens', label: 'Prasens' },
    { key: 'prateritum', label: 'Prateritum' },
  ],
  verbs: [
    {
      infinitive: 'sein',
      conjugations: {
        prasens:    { ich: 'bin', du: 'bist', er: 'ist', wir: 'sind', ihr: 'seid', sie: 'sind' },
        prateritum: { ich: 'war', du: 'warst', er: 'war', wir: 'waren', ihr: 'wart', sie: 'waren' },
      },
    },
    {
      infinitive: 'haben',
      conjugations: {
        prasens:    { ich: 'habe', du: 'hast', er: 'hat', wir: 'haben', ihr: 'habt', sie: 'haben' },
        prateritum: { ich: 'hatte', du: 'hattest', er: 'hatte', wir: 'hatten', ihr: 'hattet', sie: 'hatten' },
      },
    },
    {
      infinitive: 'werden',
      conjugations: {
        prasens:    { ich: 'werde', du: 'wirst', er: 'wird', wir: 'werden', ihr: 'werdet', sie: 'werden' },
        prateritum: { ich: 'wurde', du: 'wurdest', er: 'wurde', wir: 'wurden', ihr: 'wurdet', sie: 'wurden' },
      },
    },
    {
      infinitive: 'konnen',
      conjugations: {
        prasens:    { ich: 'kann', du: 'kannst', er: 'kann', wir: 'konnen', ihr: 'konnt', sie: 'konnen' },
        prateritum: { ich: 'konnte', du: 'konntest', er: 'konnte', wir: 'konnten', ihr: 'konntet', sie: 'konnten' },
      },
    },
    {
      infinitive: 'mussen',
      conjugations: {
        prasens:    { ich: 'muss', du: 'musst', er: 'muss', wir: 'mussen', ihr: 'musst', sie: 'mussen' },
        prateritum: { ich: 'musste', du: 'musstest', er: 'musste', wir: 'mussten', ihr: 'musstet', sie: 'mussten' },
      },
    },
    {
      infinitive: 'sollen',
      conjugations: {
        prasens:    { ich: 'soll', du: 'sollst', er: 'soll', wir: 'sollen', ihr: 'sollt', sie: 'sollen' },
        prateritum: { ich: 'sollte', du: 'solltest', er: 'sollte', wir: 'sollten', ihr: 'solltet', sie: 'sollten' },
      },
    },
    {
      infinitive: 'wollen',
      conjugations: {
        prasens:    { ich: 'will', du: 'willst', er: 'will', wir: 'wollen', ihr: 'wollt', sie: 'wollen' },
        prateritum: { ich: 'wollte', du: 'wolltest', er: 'wollte', wir: 'wollten', ihr: 'wolltet', sie: 'wollten' },
      },
    },
    {
      infinitive: 'machen',
      conjugations: {
        prasens:    { ich: 'mache', du: 'machst', er: 'macht', wir: 'machen', ihr: 'macht', sie: 'machen' },
        prateritum: { ich: 'machte', du: 'machtest', er: 'machte', wir: 'machten', ihr: 'machtet', sie: 'machten' },
      },
    },
    {
      infinitive: 'gehen',
      conjugations: {
        prasens:    { ich: 'gehe', du: 'gehst', er: 'geht', wir: 'gehen', ihr: 'geht', sie: 'gehen' },
        prateritum: { ich: 'ging', du: 'gingst', er: 'ging', wir: 'gingen', ihr: 'gingt', sie: 'gingen' },
      },
    },
    {
      infinitive: 'kommen',
      conjugations: {
        prasens:    { ich: 'komme', du: 'kommst', er: 'kommt', wir: 'kommen', ihr: 'kommt', sie: 'kommen' },
        prateritum: { ich: 'kam', du: 'kamst', er: 'kam', wir: 'kamen', ihr: 'kamt', sie: 'kamen' },
      },
    },
    {
      infinitive: 'sehen',
      conjugations: {
        prasens:    { ich: 'sehe', du: 'siehst', er: 'sieht', wir: 'sehen', ihr: 'seht', sie: 'sehen' },
        prateritum: { ich: 'sah', du: 'sahst', er: 'sah', wir: 'sahen', ihr: 'saht', sie: 'sahen' },
      },
    },
    {
      infinitive: 'geben',
      conjugations: {
        prasens:    { ich: 'gebe', du: 'gibst', er: 'gibt', wir: 'geben', ihr: 'gebt', sie: 'geben' },
        prateritum: { ich: 'gab', du: 'gabst', er: 'gab', wir: 'gaben', ihr: 'gabt', sie: 'gaben' },
      },
    },
    {
      infinitive: 'nehmen',
      conjugations: {
        prasens:    { ich: 'nehme', du: 'nimmst', er: 'nimmt', wir: 'nehmen', ihr: 'nehmt', sie: 'nehmen' },
        prateritum: { ich: 'nahm', du: 'nahmst', er: 'nahm', wir: 'nahmen', ihr: 'nahmt', sie: 'nahmen' },
      },
    },
    {
      infinitive: 'finden',
      conjugations: {
        prasens:    { ich: 'finde', du: 'findest', er: 'findet', wir: 'finden', ihr: 'findet', sie: 'finden' },
        prateritum: { ich: 'fand', du: 'fandest', er: 'fand', wir: 'fanden', ihr: 'fandet', sie: 'fanden' },
      },
    },
    {
      infinitive: 'stehen',
      conjugations: {
        prasens:    { ich: 'stehe', du: 'stehst', er: 'steht', wir: 'stehen', ihr: 'steht', sie: 'stehen' },
        prateritum: { ich: 'stand', du: 'standest', er: 'stand', wir: 'standen', ihr: 'standet', sie: 'standen' },
      },
    },
    {
      infinitive: 'sprechen',
      conjugations: {
        prasens:    { ich: 'spreche', du: 'sprichst', er: 'spricht', wir: 'sprechen', ihr: 'sprecht', sie: 'sprechen' },
        prateritum: { ich: 'sprach', du: 'sprachst', er: 'sprach', wir: 'sprachen', ihr: 'spracht', sie: 'sprachen' },
      },
    },
    {
      infinitive: 'fahren',
      conjugations: {
        prasens:    { ich: 'fahre', du: 'fahrst', er: 'fahrt', wir: 'fahren', ihr: 'fahrt', sie: 'fahren' },
        prateritum: { ich: 'fuhr', du: 'fuhrst', er: 'fuhr', wir: 'fuhren', ihr: 'fuhrt', sie: 'fuhren' },
      },
    },
    {
      infinitive: 'wissen',
      conjugations: {
        prasens:    { ich: 'weiss', du: 'weisst', er: 'weiss', wir: 'wissen', ihr: 'wisst', sie: 'wissen' },
        prateritum: { ich: 'wusste', du: 'wusstest', er: 'wusste', wir: 'wussten', ihr: 'wusstet', sie: 'wussten' },
      },
    },
    {
      infinitive: 'lesen',
      conjugations: {
        prasens:    { ich: 'lese', du: 'liest', er: 'liest', wir: 'lesen', ihr: 'lest', sie: 'lesen' },
        prateritum: { ich: 'las', du: 'last', er: 'las', wir: 'lasen', ihr: 'last', sie: 'lasen' },
      },
    },
    {
      infinitive: 'schreiben',
      conjugations: {
        prasens:    { ich: 'schreibe', du: 'schreibst', er: 'schreibt', wir: 'schreiben', ihr: 'schreibt', sie: 'schreiben' },
        prateritum: { ich: 'schrieb', du: 'schriebst', er: 'schrieb', wir: 'schrieben', ihr: 'schriebt', sie: 'schrieben' },
      },
    },
  ],
};

// ===========================================================================
// English (en)
// ===========================================================================

const en: LanguageConjugationData = {
  pronouns: ['I', 'you', 'he', 'we', 'you_pl', 'they'],
  tenses: [
    { key: 'simple_present', label: 'Simple present' },
    { key: 'simple_past', label: 'Simple past' },
    { key: 'present_continuous', label: 'Present continuous' },
    { key: 'future', label: 'Future' },
  ],
  verbs: [
    {
      infinitive: 'be',
      conjugations: {
        simple_present:      { I: 'am', you: 'are', he: 'is', we: 'are', you_pl: 'are', they: 'are' },
        simple_past:         { I: 'was', you: 'were', he: 'was', we: 'were', you_pl: 'were', they: 'were' },
        present_continuous:  { I: 'am being', you: 'are being', he: 'is being', we: 'are being', you_pl: 'are being', they: 'are being' },
        future:              { I: 'will be', you: 'will be', he: 'will be', we: 'will be', you_pl: 'will be', they: 'will be' },
      },
    },
    {
      infinitive: 'have',
      conjugations: {
        simple_present:      { I: 'have', you: 'have', he: 'has', we: 'have', you_pl: 'have', they: 'have' },
        simple_past:         { I: 'had', you: 'had', he: 'had', we: 'had', you_pl: 'had', they: 'had' },
        present_continuous:  { I: 'am having', you: 'are having', he: 'is having', we: 'are having', you_pl: 'are having', they: 'are having' },
        future:              { I: 'will have', you: 'will have', he: 'will have', we: 'will have', you_pl: 'will have', they: 'will have' },
      },
    },
    {
      infinitive: 'do',
      conjugations: {
        simple_present:      { I: 'do', you: 'do', he: 'does', we: 'do', you_pl: 'do', they: 'do' },
        simple_past:         { I: 'did', you: 'did', he: 'did', we: 'did', you_pl: 'did', they: 'did' },
        present_continuous:  { I: 'am doing', you: 'are doing', he: 'is doing', we: 'are doing', you_pl: 'are doing', they: 'are doing' },
        future:              { I: 'will do', you: 'will do', he: 'will do', we: 'will do', you_pl: 'will do', they: 'will do' },
      },
    },
    {
      infinitive: 'go',
      conjugations: {
        simple_present:      { I: 'go', you: 'go', he: 'goes', we: 'go', you_pl: 'go', they: 'go' },
        simple_past:         { I: 'went', you: 'went', he: 'went', we: 'went', you_pl: 'went', they: 'went' },
        present_continuous:  { I: 'am going', you: 'are going', he: 'is going', we: 'are going', you_pl: 'are going', they: 'are going' },
        future:              { I: 'will go', you: 'will go', he: 'will go', we: 'will go', you_pl: 'will go', they: 'will go' },
      },
    },
    {
      infinitive: 'make',
      conjugations: {
        simple_present:      { I: 'make', you: 'make', he: 'makes', we: 'make', you_pl: 'make', they: 'make' },
        simple_past:         { I: 'made', you: 'made', he: 'made', we: 'made', you_pl: 'made', they: 'made' },
        present_continuous:  { I: 'am making', you: 'are making', he: 'is making', we: 'are making', you_pl: 'are making', they: 'are making' },
        future:              { I: 'will make', you: 'will make', he: 'will make', we: 'will make', you_pl: 'will make', they: 'will make' },
      },
    },
    {
      infinitive: 'take',
      conjugations: {
        simple_present:      { I: 'take', you: 'take', he: 'takes', we: 'take', you_pl: 'take', they: 'take' },
        simple_past:         { I: 'took', you: 'took', he: 'took', we: 'took', you_pl: 'took', they: 'took' },
        present_continuous:  { I: 'am taking', you: 'are taking', he: 'is taking', we: 'are taking', you_pl: 'are taking', they: 'are taking' },
        future:              { I: 'will take', you: 'will take', he: 'will take', we: 'will take', you_pl: 'will take', they: 'will take' },
      },
    },
    {
      infinitive: 'come',
      conjugations: {
        simple_present:      { I: 'come', you: 'come', he: 'comes', we: 'come', you_pl: 'come', they: 'come' },
        simple_past:         { I: 'came', you: 'came', he: 'came', we: 'came', you_pl: 'came', they: 'came' },
        present_continuous:  { I: 'am coming', you: 'are coming', he: 'is coming', we: 'are coming', you_pl: 'are coming', they: 'are coming' },
        future:              { I: 'will come', you: 'will come', he: 'will come', we: 'will come', you_pl: 'will come', they: 'will come' },
      },
    },
    {
      infinitive: 'see',
      conjugations: {
        simple_present:      { I: 'see', you: 'see', he: 'sees', we: 'see', you_pl: 'see', they: 'see' },
        simple_past:         { I: 'saw', you: 'saw', he: 'saw', we: 'saw', you_pl: 'saw', they: 'saw' },
        present_continuous:  { I: 'am seeing', you: 'are seeing', he: 'is seeing', we: 'are seeing', you_pl: 'are seeing', they: 'are seeing' },
        future:              { I: 'will see', you: 'will see', he: 'will see', we: 'will see', you_pl: 'will see', they: 'will see' },
      },
    },
    {
      infinitive: 'know',
      conjugations: {
        simple_present:      { I: 'know', you: 'know', he: 'knows', we: 'know', you_pl: 'know', they: 'know' },
        simple_past:         { I: 'knew', you: 'knew', he: 'knew', we: 'knew', you_pl: 'knew', they: 'knew' },
        present_continuous:  { I: 'am knowing', you: 'are knowing', he: 'is knowing', we: 'are knowing', you_pl: 'are knowing', they: 'are knowing' },
        future:              { I: 'will know', you: 'will know', he: 'will know', we: 'will know', you_pl: 'will know', they: 'will know' },
      },
    },
    {
      infinitive: 'get',
      conjugations: {
        simple_present:      { I: 'get', you: 'get', he: 'gets', we: 'get', you_pl: 'get', they: 'get' },
        simple_past:         { I: 'got', you: 'got', he: 'got', we: 'got', you_pl: 'got', they: 'got' },
        present_continuous:  { I: 'am getting', you: 'are getting', he: 'is getting', we: 'are getting', you_pl: 'are getting', they: 'are getting' },
        future:              { I: 'will get', you: 'will get', he: 'will get', we: 'will get', you_pl: 'will get', they: 'will get' },
      },
    },
    {
      infinitive: 'give',
      conjugations: {
        simple_present:      { I: 'give', you: 'give', he: 'gives', we: 'give', you_pl: 'give', they: 'give' },
        simple_past:         { I: 'gave', you: 'gave', he: 'gave', we: 'gave', you_pl: 'gave', they: 'gave' },
        present_continuous:  { I: 'am giving', you: 'are giving', he: 'is giving', we: 'are giving', you_pl: 'are giving', they: 'are giving' },
        future:              { I: 'will give', you: 'will give', he: 'will give', we: 'will give', you_pl: 'will give', they: 'will give' },
      },
    },
    {
      infinitive: 'find',
      conjugations: {
        simple_present:      { I: 'find', you: 'find', he: 'finds', we: 'find', you_pl: 'find', they: 'find' },
        simple_past:         { I: 'found', you: 'found', he: 'found', we: 'found', you_pl: 'found', they: 'found' },
        present_continuous:  { I: 'am finding', you: 'are finding', he: 'is finding', we: 'are finding', you_pl: 'are finding', they: 'are finding' },
        future:              { I: 'will find', you: 'will find', he: 'will find', we: 'will find', you_pl: 'will find', they: 'will find' },
      },
    },
    {
      infinitive: 'think',
      conjugations: {
        simple_present:      { I: 'think', you: 'think', he: 'thinks', we: 'think', you_pl: 'think', they: 'think' },
        simple_past:         { I: 'thought', you: 'thought', he: 'thought', we: 'thought', you_pl: 'thought', they: 'thought' },
        present_continuous:  { I: 'am thinking', you: 'are thinking', he: 'is thinking', we: 'are thinking', you_pl: 'are thinking', they: 'are thinking' },
        future:              { I: 'will think', you: 'will think', he: 'will think', we: 'will think', you_pl: 'will think', they: 'will think' },
      },
    },
    {
      infinitive: 'say',
      conjugations: {
        simple_present:      { I: 'say', you: 'say', he: 'says', we: 'say', you_pl: 'say', they: 'say' },
        simple_past:         { I: 'said', you: 'said', he: 'said', we: 'said', you_pl: 'said', they: 'said' },
        present_continuous:  { I: 'am saying', you: 'are saying', he: 'is saying', we: 'are saying', you_pl: 'are saying', they: 'are saying' },
        future:              { I: 'will say', you: 'will say', he: 'will say', we: 'will say', you_pl: 'will say', they: 'will say' },
      },
    },
    {
      infinitive: 'tell',
      conjugations: {
        simple_present:      { I: 'tell', you: 'tell', he: 'tells', we: 'tell', you_pl: 'tell', they: 'tell' },
        simple_past:         { I: 'told', you: 'told', he: 'told', we: 'told', you_pl: 'told', they: 'told' },
        present_continuous:  { I: 'am telling', you: 'are telling', he: 'is telling', we: 'are telling', you_pl: 'are telling', they: 'are telling' },
        future:              { I: 'will tell', you: 'will tell', he: 'will tell', we: 'will tell', you_pl: 'will tell', they: 'will tell' },
      },
    },
    {
      infinitive: 'want',
      conjugations: {
        simple_present:      { I: 'want', you: 'want', he: 'wants', we: 'want', you_pl: 'want', they: 'want' },
        simple_past:         { I: 'wanted', you: 'wanted', he: 'wanted', we: 'wanted', you_pl: 'wanted', they: 'wanted' },
        present_continuous:  { I: 'am wanting', you: 'are wanting', he: 'is wanting', we: 'are wanting', you_pl: 'are wanting', they: 'are wanting' },
        future:              { I: 'will want', you: 'will want', he: 'will want', we: 'will want', you_pl: 'will want', they: 'will want' },
      },
    },
    {
      infinitive: 'put',
      conjugations: {
        simple_present:      { I: 'put', you: 'put', he: 'puts', we: 'put', you_pl: 'put', they: 'put' },
        simple_past:         { I: 'put', you: 'put', he: 'put', we: 'put', you_pl: 'put', they: 'put' },
        present_continuous:  { I: 'am putting', you: 'are putting', he: 'is putting', we: 'are putting', you_pl: 'are putting', they: 'are putting' },
        future:              { I: 'will put', you: 'will put', he: 'will put', we: 'will put', you_pl: 'will put', they: 'will put' },
      },
    },
    {
      infinitive: 'run',
      conjugations: {
        simple_present:      { I: 'run', you: 'run', he: 'runs', we: 'run', you_pl: 'run', they: 'run' },
        simple_past:         { I: 'ran', you: 'ran', he: 'ran', we: 'ran', you_pl: 'ran', they: 'ran' },
        present_continuous:  { I: 'am running', you: 'are running', he: 'is running', we: 'are running', you_pl: 'are running', they: 'are running' },
        future:              { I: 'will run', you: 'will run', he: 'will run', we: 'will run', you_pl: 'will run', they: 'will run' },
      },
    },
    {
      infinitive: 'read',
      conjugations: {
        simple_present:      { I: 'read', you: 'read', he: 'reads', we: 'read', you_pl: 'read', they: 'read' },
        simple_past:         { I: 'read', you: 'read', he: 'read', we: 'read', you_pl: 'read', they: 'read' },
        present_continuous:  { I: 'am reading', you: 'are reading', he: 'is reading', we: 'are reading', you_pl: 'are reading', they: 'are reading' },
        future:              { I: 'will read', you: 'will read', he: 'will read', we: 'will read', you_pl: 'will read', they: 'will read' },
      },
    },
    {
      infinitive: 'write',
      conjugations: {
        simple_present:      { I: 'write', you: 'write', he: 'writes', we: 'write', you_pl: 'write', they: 'write' },
        simple_past:         { I: 'wrote', you: 'wrote', he: 'wrote', we: 'wrote', you_pl: 'wrote', they: 'wrote' },
        present_continuous:  { I: 'am writing', you: 'are writing', he: 'is writing', we: 'are writing', you_pl: 'are writing', they: 'are writing' },
        future:              { I: 'will write', you: 'will write', he: 'will write', we: 'will write', you_pl: 'will write', they: 'will write' },
      },
    },
  ],
};

// ===========================================================================
// All languages
// ===========================================================================

const conjugations: Record<string, LanguageConjugationData> = { en, es, pt, fr, de };

// Display-friendly pronoun labels (internal keys -> what the user sees)
const pronounLabels: Record<string, Record<string, string>> = {
  en: { I: 'I', you: 'you', he: 'he', we: 'we', you_pl: 'you (pl.)', they: 'they' },
  es: { yo: 'yo', tu: 'tu', el: 'el/ella', nosotros: 'nosotros', vosotros: 'vosotros', ellos: 'ellos/ellas' },
  pt: { eu: 'eu', tu: 'tu', ele: 'ele/ela', nos: 'nos', eles: 'eles/elas' },
  fr: { je: 'je', tu: 'tu', il: 'il/elle', nous: 'nous', vous: 'vous', ils: 'ils/elles' },
  de: { ich: 'ich', du: 'du', er: 'er/sie/es', wir: 'wir', ihr: 'ihr', sie: 'sie/Sie' },
};

// ---------------------------------------------------------------------------
// Problem generator
// ---------------------------------------------------------------------------

export function generateProblems(targetLang: string, count: number): ConjugationProblem[] {
  const data = conjugations[targetLang];
  if (!data) return [];

  const labels = pronounLabels[targetLang];

  // Build pool of all possible combos
  type Combo = { verb: VerbTable; tenseKey: string; tenseLabel: string; pronoun: string };
  const pool: Combo[] = [];
  for (const verb of data.verbs) {
    for (const tense of data.tenses) {
      const tenseConj = verb.conjugations[tense.key];
      if (!tenseConj) continue;
      for (const pronoun of data.pronouns) {
        if (tenseConj[pronoun]) {
          pool.push({ verb, tenseKey: tense.key, tenseLabel: tense.label, pronoun });
        }
      }
    }
  }

  if (pool.length === 0) return [];

  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Pick combos avoiding back-to-back same verb
  const picked: Combo[] = [];
  let lastVerb = '';
  let poolIdx = 0;
  const skipped: Combo[] = [];

  while (picked.length < count && (poolIdx < pool.length || skipped.length > 0)) {
    if (poolIdx < pool.length) {
      const combo = pool[poolIdx++];
      if (combo.verb.infinitive === lastVerb && (poolIdx < pool.length || skipped.length > 0)) {
        skipped.push(combo);
      } else {
        picked.push(combo);
        lastVerb = combo.verb.infinitive;
      }
    } else if (skipped.length > 0) {
      picked.push(skipped.shift()!);
      lastVerb = picked[picked.length - 1].verb.infinitive;
    }
  }

  return picked.slice(0, count).map((c) => ({
    infinitive: c.verb.infinitive,
    tense: c.tenseLabel,
    tense_target: c.tenseLabel,
    pronoun: labels?.[c.pronoun] ?? c.pronoun,
    expected: c.verb.conjugations[c.tenseKey][c.pronoun],
  }));
}
