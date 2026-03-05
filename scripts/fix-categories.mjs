import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.join(__dirname, '..', '.categorization-state.json');
const outputPath = path.join(__dirname, '..', 'categorized-videos.txt');

const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

// ---- helpers ----------------------------------------------------------------

function removeVideo(catKey, title) {
  const arr = catKey === 'uncategorized' ? state.uncategorized
            : catKey === 'removed'       ? state.removed
            : state.categories[catKey]?.videos;
  if (!arr) throw new Error(`Category "${catKey}" not found`);
  const idx = arr.findIndex(v => v.title === title);
  if (idx === -1) throw new Error(`Video not found in "${catKey}": ${title}`);
  return arr.splice(idx, 1)[0];
}

function addVideo(catKey, video) {
  if (catKey === 'uncategorized') state.uncategorized.push(video);
  else if (catKey === 'removed') state.removed.push(video);
  else {
    if (!state.categories[catKey]) throw new Error(`Target category "${catKey}" not found`);
    state.categories[catKey].videos.push(video);
  }
}

function move(fromCat, toCat, title) {
  const video = removeVideo(fromCat, title);
  addVideo(toCat, video);
  return video;
}

let moveCount = 0;
function moveAndLog(fromCat, toCat, title) {
  move(fromCat, toCat, title);
  moveCount++;
}

// ---- count before -----------------------------------------------------------

function totalVideos() {
  let n = state.uncategorized.length + state.removed.length;
  for (const cat of Object.values(state.categories)) n += cat.videos.length;
  return n;
}

const beforeTotal = totalVideos();
console.log(`Total videos before: ${beforeTotal}`);

// =============================================================================
// 1. Cuentos series: listening-comprehension -> reading-comprehension (13)
// =============================================================================
const cuentosTitles = [
  '27. A Caixinha - Cuentos en Portugu\u00e9s con Lecciones de Vida - Lectura',
  '15. Os Dois Melhores Amigos - Cuentos en Portugu\u00e9s con Lecciones de Vida - Lectura',
  '26. Estrat\u00e9gia - Cuentos en Portugu\u00e9s con Lecciones de Vida - Lectura',
  '18. Amor No Cora\u00e7\u00e3o - Cuentos en Portugu\u00e9s con Lecciones de Vida - Lectura',
  '17.  As Lutas da Nossa Vida - Cuentos en Portugu\u00e9s con Lecciones de Vida - Lectura',
  '28. Acomoda\u00e7\u00e3o - Cuentos en Portugu\u00e9s con Lecciones de Vida - Lectura',
  '30. A Mais Bela Flor - Cuentos en Portugu\u00e9s con Lecciones de Vida - Lectura',
  '19. Amor Incondicional - Cuentos en Portugu\u00e9s con Lecciones de Vida - Lectura',
  '36. Gentileza Gera Gentileza - Cuentos en Portugu\u00e9s con Lecciones de Vida - Lectura',
  '31. Antes De Julgar - Cuentos en Portugu\u00e9s con Lecciones de Vida - Lectura',
  '39. O Seu Tom De Voz - Cuentos en Portugu\u00e9s con Lecciones de Vida - Lectura',
  '21. O S\u00e1bio - Cuentos en Portugu\u00e9s con Lecciones de Vida - Lectura',
  '23. O Executivo E O Pescador - Cuentos en Portugu\u00e9s con Lecciones de Vida - Lectura',
];
console.log('\n1. Moving 13 Cuentos stories: Listening Comprehension -> Reading Comprehension');
for (const t of cuentosTitles) moveAndLog('listening-comprehension', 'reading-comprehension', t);

// =============================================================================
// 2. Language Learning Tips: remove Spanish lesson
// =============================================================================
console.log('\n2. Moving 1 video: Language Learning Tips -> Removed');
moveAndLog('learning-tips', 'removed', 'Ep.43 - Aprendendo Espanhol - Philipe Brazuca');

// =============================================================================
// 3. Verb Usage -> Verb Tenses Overview (8 videos)
// =============================================================================
const verbMoveTitles = [
  '10 Essential Verbs in Brazilian Portuguese \u2013 Present Tense Drill',
  '50 Essential Verbs in Brazilian Portuguese \u2013 Present Tense Drill',
  'Voc\u00ea tamb\u00e9m tem d\u00favida sobre os pronomes reflexivos e os verbos? #portuguesbrasileiro',
  'VERBOS REFLEXIVOS- COMO USAR?',
  'Pronominal & Reflexive Verbs in Portuguese | Speaking Brazilian',
  'ING Form in Portuguese #brazilianportuguese #portuguesbrasileiro',
  'Speak Like a Brazilian: How to use the "-ING FORM" in Portuguese?',
  'FORMAL x INFORMAL| 10 VERBOS PARA VOC\u00ca CONHECER!',
];
console.log('\n3. Moving 8 videos: Verb Usage -> Verb Tenses Overview');
for (const t of verbMoveTitles) moveAndLog('verb-usage', 'verb-tenses-overview', t);

// =============================================================================
// 4. Pronunciation -> Dialects & Accents (3 videos)
// =============================================================================
const pronunciationMoveTitles = [
  '4 segredos para ter sotaque brasileiro',
  'ACENTO BRASILE\u00d1O -10 SOTAQUES DE PORTUGU\u00caS BRASILEIRO',
  'LOS 10 ACENTOS DIFERENTES DEL PORTUGU\u00c9S EN EL MUNDO',
];
console.log('\n4. Moving 3 videos: Pronunciation -> Dialects & Accents');
for (const t of pronunciationMoveTitles) moveAndLog('pronunciation', 'dialects-accents', t);

// =============================================================================
// 5. Possessive Pronouns -> Uncategorized (2 CUJO videos)
// =============================================================================
console.log('\n5. Moving 2 CUJO/CUJA videos: Possessive Pronouns -> Uncategorized');
moveAndLog('possessives', 'uncategorized', 'Domine o uso de CUJO ou CUJA em portugu\u00eas!');
moveAndLog('possessives', 'uncategorized', 'Advanced Portuguese: How to use the word CUJO?');

// =============================================================================
// 6. Body Parts -> various (2 videos)
// =============================================================================
console.log('\n6a. Moving 1 video: Body Parts -> Idiomatic Expressions');
moveAndLog('vocabulary-body', 'idiomatic-expressions', 'VOC\u00ca PRECISA APRENDER ESTAS 20 EXPRESS\u00d5ES COM PARTES DO CORPO');
console.log('6b. Moving 1 video: Body Parts -> Slang & Colloquialisms');
moveAndLog('vocabulary-body', 'slang', 'SIN\u00d3NIMOS DE VAGINA Y PENE EN PORTUGU\u00c9S');

// =============================================================================
// 7. Conversation Practice -> Listening Comprehension (3 videos)
// =============================================================================
const conversationMoveTitles = [
  'Being a Comic Book Artist in Brazil | Easy Portuguese 101',
  'Brazilians Predict the 2022 World Cup Winners | Easy Portuguese 73',
  'What Do Brazilians Think About Germans? | Easy Portuguese 67',
];
console.log('\n7. Moving 3 videos: Conversation Practice -> Listening Comprehension');
for (const t of conversationMoveTitles) moveAndLog('conversation', 'listening-comprehension', t);

// =============================================================================
// 8. Basic Phrases -> Uncategorized (6 grammar videos)
// =============================================================================
const basicPhrasesMoveTitles = [
  '\ud83d\udd34 LIVE \u2013 Basic Sentence Structure in Brazilian Portuguese',
  'Basic Sentence Structure in Brazilian Portuguese',
  'How To Make Longer Sentences In Portuguese | Easy Portuguese LIVE',
  'How To Make Long Sentences in Portuguese #live',
  'Double negative in Portuguese. Is it correct?',
  'Brazilians don\u2019t say NO (N\u00c3O) | Brazilian Portuguese',
];
console.log('\n8. Moving 6 videos: Basic Phrases -> Uncategorized');
for (const t of basicPhrasesMoveTitles) moveAndLog('basic-phrases', 'uncategorized', t);

// =============================================================================
// 9. Uncategorized -> various categories
// =============================================================================

// 9a. Object pronoun videos -> Subject Pronouns (will be renamed to "Pronouns")
const pronounTitles = [
  'PRONOMES -LO -LA -O -A -LHE: COMO USAR COM EFICI\u00caNCIA!',
  'Como usar LO - LA - O - A no Portugu\u00eas Brasileiro?',
  'Portuguese| Portugu\u00eas: Pronomes LO, LA, LHE, LHES...',
  'COMO USAR "TE" E "LHE" EM PORTUGU\u00caS? MUITO SIMPLES',
  'Como usar LHE no portugu\u00eas?',
  'Pronomes antes ou depois do verbo?',
  'Pronome antes do verbo?',
  'POSI\u00c7\u00c3O DOS PRONOMES',
];
console.log('\n9a. Moving 8 pronoun videos: Uncategorized -> Subject Pronouns (renamed "Pronouns")');
for (const t of pronounTitles) moveAndLog('uncategorized', 'subject-pronouns', t);

// 9b. NEM -> Conjunctions & Connectors
console.log('9b. Moving NEM video: Uncategorized -> Conjunctions & Connectors');
moveAndLog('uncategorized', 'conjunctions', 'APRENDA TUDO sobre como usar NEM em Portugu\u00eas');

// 9c. Spanish/Portuguese comparison -> Portuguese vs Spanish
console.log('9c. Moving ES/PT comparison: Uncategorized -> Portuguese vs Spanish');
moveAndLog('uncategorized', 'pt-vs-es', 'Espa\u00f1ol y Portugu\u00e9s: diferencias y similitudes con @espanolconmaria');

// 9d. Celpe-Bras -> Quizzes & Tests
console.log('9d. Moving Celpe-Bras video: Uncategorized -> Quizzes & Tests');
moveAndLog('uncategorized', 'quizzes-tests', '\u00bfQU\u00c9 ES EL Celpe-Bras? CERTIFICADO DE DOMINIO DEL PORTUGU\u00c9S \ud83c\udde7\ud83c\uddf7');

// 9e. Redundancias/Pleonasmo -> Common Mistakes
console.log('9e. Moving Pleonasmo video: Uncategorized -> Common Mistakes');
moveAndLog('uncategorized', 'common-mistakes', '\u00a8VI\u00daVA DO FALECIDO\u00a8 - REDUND\u00c2NCIAS EM PORTUGU\u00caS (Pleonasmo)');

// =============================================================================
// Rename "Subject Pronouns" -> "Pronouns"
// =============================================================================
console.log('\nRenaming "Subject Pronouns" -> "Pronouns"');
state.categories['subject-pronouns'].title = 'Pronouns';

// =============================================================================
// Verify and save
// =============================================================================
const afterTotal = totalVideos();
console.log(`\nTotal videos after: ${afterTotal}`);
if (beforeTotal !== afterTotal) {
  console.error(`ERROR: Video count changed from ${beforeTotal} to ${afterTotal}!`);
  process.exit(1);
}
console.log(`Total moves: ${moveCount}`);

// Check every video appears exactly once
const allTitles = [];
for (const cat of Object.values(state.categories)) {
  for (const v of cat.videos) allTitles.push(v.title);
}
for (const v of state.uncategorized) allTitles.push(v.title);
for (const v of state.removed) allTitles.push(v.title);

const dupes = allTitles.filter((t, i) => allTitles.indexOf(t) !== i);
const PRE_EXISTING_DUPES = 13;
if (dupes.length > PRE_EXISTING_DUPES) {
  console.error(`ERROR: New duplicate titles introduced! Was ${PRE_EXISTING_DUPES}, now ${dupes.length}`);
  process.exit(1);
}
console.log(`Duplicate check passed (${dupes.length} pre-existing, no new duplicates)`);

// Save state
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
console.log(`Saved: ${statePath}`);

// Regenerate output file
const lines = [];
lines.push('CATEGORIZED VIDEOS -- PT');
lines.push('='.repeat(60));

const catCount = Object.values(state.categories).reduce((s, c) => s + c.videos.length, 0);
lines.push(`Categorized: ${catCount}`);
lines.push(`Uncategorized: ${state.uncategorized.length}`);
lines.push(`Removed (not lessons): ${state.removed.length}`);
lines.push('');

const sortedCats = Object.entries(state.categories)
  .filter(([, c]) => c.videos.length > 0)
  .sort((a, b) => b[1].videos.length - a[1].videos.length);

for (const [id, cat] of sortedCats) {
  const levelStr = cat.level ? ` (${cat.level})` : '';
  lines.push('-'.repeat(60));
  lines.push(`${cat.title}${levelStr} -- ${cat.videos.length} videos  [${id}]`);
  lines.push('-'.repeat(60));
  for (const v of cat.videos) {
    lines.push(`  - ${v.title}  [${v.channel}]`);
  }
  lines.push('');
}

if (state.uncategorized.length > 0) {
  lines.push('-'.repeat(60));
  lines.push(`Uncategorized -- ${state.uncategorized.length} videos`);
  lines.push('-'.repeat(60));
  for (const v of state.uncategorized) {
    lines.push(`  - ${v.title}  [${v.channel}]`);
  }
  lines.push('');
}

const emptyCats = Object.entries(state.categories).filter(([, c]) => c.videos.length === 0);
if (emptyCats.length > 0) {
  lines.push('-'.repeat(60));
  lines.push('Categories with no videos yet:');
  lines.push(`  ${emptyCats.map(([, c]) => c.title).join(', ')}`);
  lines.push('');
}

fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
console.log(`Saved: ${outputPath}`);
console.log('\nDone!');
