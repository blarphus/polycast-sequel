import { Router } from 'express';
import { createDictionaryMediaRoutes } from './dictionary/mediaRoutes.js';
import { createDictionarySemanticRoutes } from './dictionary/semanticRoutes.js';
import { createDictionaryStudyRoutes } from './dictionary/studyRoutes.js';
import { createDictionaryWordRoutes } from './dictionary/wordRoutes.js';
import { createDictionaryConjugationRoutes } from './dictionary/conjugationRoutes.js';

const router = Router();

router.use(createDictionarySemanticRoutes());
router.use(createDictionaryConjugationRoutes());
router.use(createDictionaryMediaRoutes());
router.use(createDictionaryStudyRoutes());
router.use(createDictionaryWordRoutes());

export default router;
