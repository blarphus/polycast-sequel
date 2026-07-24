export type UiLanguage = 'en' | 'es';

export const CORE_LANGUAGE_CODES = new Set(['en', 'es']);

export function uiLanguage(nativeLanguage?: string | null): UiLanguage {
  return String(nativeLanguage || '').toLowerCase().split(/[-_]/)[0] === 'es' ? 'es' : 'en';
}

const messages = {
  en: {
    'nav.expand': 'Expand sidebar', 'nav.collapse': 'Collapse sidebar',
    'nav.dictionary': 'Dictionary', 'nav.flashcards': 'Flashcards', 'nav.practice': 'Practice',
    'nav.books': 'Books', 'nav.inProgress': 'In progress', 'nav.home': 'Home', 'nav.social': 'Social',
    'nav.classwork': 'Classwork', 'nav.watch': 'Watch', 'nav.local': 'Local',
    'nav.profiles': 'Profiles', 'nav.settings': 'Settings',
    'profiles.subtitle': 'Switch accounts or add another login', 'profiles.close': 'Close profile menu',
    'profiles.current': 'current', 'profiles.currentTitle': 'Current profile',
    'profiles.removeTitle': 'Remove saved profile', 'profiles.remove': 'Remove',
    'profiles.add': 'Add another profile', 'account.student': 'student', 'account.teacher': 'teacher',
    'settings.back': 'Back', 'settings.title': 'Settings', 'settings.subtitle': 'Set your language preferences',
    'settings.theme': 'Theme', 'settings.light': 'Light', 'settings.dark': 'Dark',
    'settings.background': 'Background', 'settings.none': 'None', 'settings.dots': 'Dots',
    'settings.lines': 'Lines', 'settings.noise': 'Noise', 'settings.grid': 'Grid',
    'settings.dailyWords': 'Daily new words', 'settings.ranking': 'Dictionary ranking build',
    'settings.rankingProgress': 'View live progress', 'settings.saved': 'Settings saved!',
    'settings.native': 'Native Language', 'settings.target': 'Target Language',
    'common.select': 'Select...', 'common.saving': 'Saving...', 'common.save': 'Save',
    'settings.backHome': 'Back to Home',
    'onboarding.title': 'Welcome to Polycast', 'onboarding.subtitle': "Let's set up your languages",
    'onboarding.both': 'Please select both languages.',
    'onboarding.different': 'Native and target languages must be different.',
    'onboarding.start': 'Get Started',
    'dictionary.title': 'My Dictionary', 'dictionary.search': 'Search words...',
    'dictionary.queue': 'Queue', 'dictionary.recent': 'Recent first', 'dictionary.frequencyHigh': 'Frequency high → low',
    'dictionary.frequencyLow': 'Frequency low → high', 'dictionary.dueSoon': 'Due soonest',
    'dictionary.count': '{count} {countLabel}', 'dictionary.word': 'word', 'dictionary.words': 'words',
    'dictionary.studyOrder': 'Study order', 'dictionary.studySummary': 'Dictionary study summary',
    'dictionary.upNext': 'Up next', 'dictionary.library': 'Library',
    'dictionary.newCardsCount': '{count} new cards today', 'dictionary.frequency': 'Frequency',
    'dictionary.frequencyRuleShort': 'Frequency: high → low',
    'dictionary.frequencyRule': 'New words are ordered from highest to lowest frequency. Assigned words come first.',
    'dictionary.frequencyOrder': 'Frequency order', 'dictionary.rebuildTitle': 'Rebuild frequency order',
    'dictionary.rebuildConfirm': 'Replace the current manual queue order with priority-first frequency order?',
    'dictionary.lookupTitle': 'Look up a word', 'dictionary.loading': 'Loading saved words...',
    'dictionary.noMatches': 'No words match your search.',
    'dictionary.empty': 'No saved words yet. Click on words in subtitles and press + to save them.',
    'dictionary.dueNext': 'DUE NEXT', 'dictionary.assigned': 'Assigned',
    'dictionary.translation': 'Translation', 'dictionary.definition': 'Definition', 'dictionary.forms': 'Forms',
    'dictionary.example': 'Example', 'dictionary.saved': 'Saved', 'dictionary.corpusCount': 'Corpus count',
    'dictionary.frequencyRank': 'Frequency rank', 'dictionary.unranked': 'Unranked tail',
    'dictionary.frequencySources': 'Frequency sources', 'dictionary.rankingFallback': 'Ranking fallback',
    'dictionary.remove': 'Remove',
    'learn.loadFailed': 'Failed to load cards: {error}', 'learn.emptyTitle': 'No words to study yet',
    'learn.emptyBody': 'Save words from conversations to start learning.',
    'learn.emptyHint': 'Tap words in subtitles during calls, then press + to save them to your dictionary.',
    'learn.checking': 'Checking for more cards...', 'learn.complete': 'Session Complete',
    'learn.reviewed': 'Cards reviewed', 'learn.accuracy': 'Accuracy', 'learn.duration': 'Duration',
    'learn.savingSession': 'Saving session...', 'learn.sessionCap': 'Session XP capped today', 'learn.done': 'Done',
    'learn.testStages': 'Test stages', 'learn.stage': 'Stage {stage}', 'learn.new': 'New',
    'learn.tapReveal': 'Tap to reveal', 'learn.incorrect': 'Incorrect', 'learn.correct': 'Correct',
    'learn.phraseMeaning': 'What does “{phrase}” mean?', 'learn.queueCounts': 'New, learning, and review cards',
    'learn.playAnswer': 'Play answer', 'learn.revealKey': 'Space',
    'learn.meetWord': 'What does the highlighted word mean?',
    'learn.sentenceMeaning': 'What does this sentence mean?', 'learn.wordProduction': 'How do you say this?',
    'learn.sentenceProduction': 'How do you say this sentence?',
    'practice.preparing': 'Preparing practice...', 'practice.complete': 'Practice complete',
    'practice.correctCount': '{correct}/{total} correct', 'practice.accuracy': 'accuracy',
    'practice.capped': 'Capped', 'practice.again': 'Practice again', 'practice.flashcards': 'Flashcards',
    'practice.title': 'Practice', 'practice.minimumWords': 'Save at least four words with distinct meanings before starting Practice.',
    'practice.unavailable': 'No exercise is available.', 'practice.openDictionary': 'Open dictionary',
    'practice.close': 'Close practice', 'practice.retry': 'Try this word again', 'practice.playWord': 'Play word',
    'practice.meaning': 'Meaning', 'practice.correct': 'Correct', 'practice.notQuite': 'Not quite',
    'practice.answer': 'Answer: {answer}', 'practice.next': 'Next', 'practice.finish': 'Finish',
    'practice.check': 'Check', 'practice.startFailed': 'Practice could not start',
    'practice.answerFailed': 'Answer could not be saved', 'practice.completeFailed': 'Session could not be completed',
    'popup.play': 'Play pronunciation', 'popup.close': 'Close', 'popup.add': '+ Add to dictionary',
    'popup.addPhrase': '+ Add phrase', 'popup.explain': 'Explain in context', 'popup.added': 'Added',
    'popup.inDictionary': 'In your dictionary', 'popup.removing': 'Removing...',
    'popup.removeConfirm': 'Remove {word} from dictionary?', 'popup.word': 'Word', 'popup.phrase': 'Phrase',
    'popup.inContext': 'In context', 'popup.goalComplete': 'Goal complete', 'popup.moreToday': '{count} more today',
  },
  es: {
    'nav.expand': 'Expandir barra lateral', 'nav.collapse': 'Contraer barra lateral',
    'nav.dictionary': 'Diccionario', 'nav.flashcards': 'Tarjetas', 'nav.practice': 'Práctica',
    'nav.books': 'Libros', 'nav.inProgress': 'En desarrollo', 'nav.home': 'Inicio', 'nav.social': 'Social',
    'nav.classwork': 'Trabajo de clase', 'nav.watch': 'Ver', 'nav.local': 'Local',
    'nav.profiles': 'Perfiles', 'nav.settings': 'Configuración',
    'profiles.subtitle': 'Cambia de cuenta o agrega otro inicio de sesión', 'profiles.close': 'Cerrar menú de perfiles',
    'profiles.current': 'actual', 'profiles.currentTitle': 'Perfil actual',
    'profiles.removeTitle': 'Quitar perfil guardado', 'profiles.remove': 'Quitar',
    'profiles.add': 'Agregar otro perfil', 'account.student': 'estudiante', 'account.teacher': 'docente',
    'settings.back': 'Atrás', 'settings.title': 'Configuración', 'settings.subtitle': 'Configura tus preferencias de idioma',
    'settings.theme': 'Tema', 'settings.light': 'Claro', 'settings.dark': 'Oscuro',
    'settings.background': 'Fondo', 'settings.none': 'Ninguno', 'settings.dots': 'Puntos',
    'settings.lines': 'Líneas', 'settings.noise': 'Ruido', 'settings.grid': 'Cuadrícula',
    'settings.dailyWords': 'Palabras nuevas por día', 'settings.ranking': 'Clasificación del diccionario',
    'settings.rankingProgress': 'Ver progreso en vivo', 'settings.saved': '¡Configuración guardada!',
    'settings.native': 'Idioma nativo', 'settings.target': 'Idioma que aprendes',
    'common.select': 'Seleccionar...', 'common.saving': 'Guardando...', 'common.save': 'Guardar',
    'settings.backHome': 'Volver al inicio',
    'onboarding.title': 'Te damos la bienvenida a Polycast', 'onboarding.subtitle': 'Configuremos tus idiomas',
    'onboarding.both': 'Selecciona ambos idiomas.',
    'onboarding.different': 'El idioma nativo y el idioma de aprendizaje deben ser diferentes.',
    'onboarding.start': 'Comenzar',
    'dictionary.title': 'Mi diccionario', 'dictionary.search': 'Buscar palabras...',
    'dictionary.queue': 'Cola', 'dictionary.recent': 'Más recientes', 'dictionary.frequencyHigh': 'Frecuencia alta → baja',
    'dictionary.frequencyLow': 'Frecuencia baja → alta', 'dictionary.dueSoon': 'Próximas primero',
    'dictionary.count': '{count} {countLabel}', 'dictionary.word': 'palabra', 'dictionary.words': 'palabras',
    'dictionary.studyOrder': 'Orden de estudio', 'dictionary.studySummary': 'Resumen de estudio del diccionario',
    'dictionary.upNext': 'A continuación', 'dictionary.library': 'Biblioteca',
    'dictionary.newCardsCount': '{count} palabras nuevas hoy', 'dictionary.frequency': 'Frecuencia',
    'dictionary.frequencyRuleShort': 'Frecuencia: alta → baja',
    'dictionary.frequencyRule': 'Las palabras nuevas se ordenan de mayor a menor frecuencia. Las palabras asignadas aparecen primero.',
    'dictionary.frequencyOrder': 'Orden por frecuencia', 'dictionary.rebuildTitle': 'Recrear orden por frecuencia',
    'dictionary.rebuildConfirm': '¿Reemplazar el orden manual actual por prioridad y frecuencia?',
    'dictionary.lookupTitle': 'Buscar una palabra', 'dictionary.loading': 'Cargando palabras guardadas...',
    'dictionary.noMatches': 'Ninguna palabra coincide con tu búsqueda.',
    'dictionary.empty': 'Aún no hay palabras guardadas. Haz clic en palabras de los subtítulos y pulsa + para guardarlas.',
    'dictionary.dueNext': 'PRÓXIMAS', 'dictionary.assigned': 'Asignada',
    'dictionary.translation': 'Traducción', 'dictionary.definition': 'Definición', 'dictionary.forms': 'Formas',
    'dictionary.example': 'Ejemplo', 'dictionary.saved': 'Guardada', 'dictionary.corpusCount': 'Conteo del corpus',
    'dictionary.frequencyRank': 'Rango de frecuencia', 'dictionary.unranked': 'Cola sin clasificar',
    'dictionary.frequencySources': 'Fuentes de frecuencia', 'dictionary.rankingFallback': 'Alternativa de clasificación',
    'dictionary.remove': 'Quitar',
    'learn.loadFailed': 'No se pudieron cargar las tarjetas: {error}', 'learn.emptyTitle': 'Aún no hay palabras para estudiar',
    'learn.emptyBody': 'Guarda palabras de conversaciones para comenzar a aprender.',
    'learn.emptyHint': 'Toca palabras en los subtítulos durante las llamadas y pulsa + para guardarlas en tu diccionario.',
    'learn.checking': 'Buscando más tarjetas...', 'learn.complete': 'Sesión completada',
    'learn.reviewed': 'Tarjetas repasadas', 'learn.accuracy': 'Precisión', 'learn.duration': 'Duración',
    'learn.savingSession': 'Guardando sesión...', 'learn.sessionCap': 'Límite diario de XP alcanzado', 'learn.done': 'Listo',
    'learn.testStages': 'Probar etapas', 'learn.stage': 'Etapa {stage}', 'learn.new': 'Nueva',
    'learn.tapReveal': 'Toca para revelar', 'learn.incorrect': 'Incorrecto', 'learn.correct': 'Correcto',
    'learn.phraseMeaning': '¿Qué significa «{phrase}»?', 'learn.queueCounts': 'Tarjetas nuevas, en aprendizaje y de repaso',
    'learn.playAnswer': 'Reproducir respuesta', 'learn.revealKey': 'Espacio',
    'learn.meetWord': '¿Qué significa la palabra resaltada?',
    'learn.sentenceMeaning': '¿Qué significa esta oración?', 'learn.wordProduction': '¿Cómo se dice esto?',
    'learn.sentenceProduction': '¿Cómo se dice esta oración?',
    'practice.preparing': 'Preparando la práctica...', 'practice.complete': 'Práctica completada',
    'practice.correctCount': '{correct}/{total} correctas', 'practice.accuracy': 'precisión',
    'practice.capped': 'Límite alcanzado', 'practice.again': 'Practicar de nuevo', 'practice.flashcards': 'Tarjetas',
    'practice.title': 'Práctica', 'practice.minimumWords': 'Guarda al menos cuatro palabras con significados distintos antes de comenzar la práctica.',
    'practice.unavailable': 'No hay ejercicios disponibles.', 'practice.openDictionary': 'Abrir diccionario',
    'practice.close': 'Cerrar práctica', 'practice.retry': 'Intenta esta palabra de nuevo', 'practice.playWord': 'Reproducir palabra',
    'practice.meaning': 'Significado', 'practice.correct': 'Correcto', 'practice.notQuite': 'Casi',
    'practice.answer': 'Respuesta: {answer}', 'practice.next': 'Siguiente', 'practice.finish': 'Terminar',
    'practice.check': 'Comprobar', 'practice.startFailed': 'No se pudo iniciar la práctica',
    'practice.answerFailed': 'No se pudo guardar la respuesta', 'practice.completeFailed': 'No se pudo completar la sesión',
    'popup.play': 'Reproducir pronunciación', 'popup.close': 'Cerrar', 'popup.add': '+ Agregar al diccionario',
    'popup.addPhrase': '+ Agregar frase', 'popup.explain': 'Explicar en contexto', 'popup.added': 'Agregada',
    'popup.inDictionary': 'En tu diccionario', 'popup.removing': 'Quitando...',
    'popup.removeConfirm': '¿Quitar {word} del diccionario?', 'popup.word': 'Palabra', 'popup.phrase': 'Frase',
    'popup.inContext': 'En contexto', 'popup.goalComplete': 'Meta completada', 'popup.moreToday': '{count} más hoy',
  },
} as const;

export type MessageKey = keyof typeof messages.en;

export function translate(language: UiLanguage, key: MessageKey, values: Record<string, string | number> = {}) {
  let message: string = messages[language][key] || messages.en[key];
  for (const [name, value] of Object.entries(values)) message = message.split(`{${name}}`).join(String(value));
  return message;
}

export function languageDisplayName(code: string, language: UiLanguage) {
  try {
    return new Intl.DisplayNames([language], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

export function wordPopupLabels(language: UiLanguage) {
  const base = {
    playPronunciation: translate(language, 'popup.play'), close: translate(language, 'popup.close'),
    addToDictionary: translate(language, 'popup.add'), addPhrase: translate(language, 'popup.addPhrase'),
    explainInContext: translate(language, 'popup.explain'), added: translate(language, 'popup.added'),
    inDictionary: translate(language, 'popup.inDictionary'), removing: translate(language, 'popup.removing'),
    removeConfirm: (word: string) => translate(language, 'popup.removeConfirm', { word }),
    word: translate(language, 'popup.word'), phrase: translate(language, 'popup.phrase'),
    inContext: translate(language, 'popup.inContext'),
  };
  if (language === 'es') {
    return {
      ...base,
      notInDictionary: 'No está en el diccionario',
      invalidWord: (target: string, languageName: string) => `«${target}» no es una palabra en ${languageName}`,
      definition: 'Definición', noDefinition: 'No se encontró una definición',
      contextUnavailable: 'La explicación contextual no está disponible',
      savesAs: 'Se guarda como', partOfSpeech: 'Categoría gramatical', newDefinition: '¡Nueva definición!',
    };
  }
  return base;
}
