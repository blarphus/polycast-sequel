import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../auth.js';
import { asyncHandler } from '../../lib/httpErrors.js';
import { validate } from '../../lib/validate.js';
import { spanishConjugationService } from '../../services/spanishConjugationService.js';

const conjugationQuery = z.object({
  verb: z.string().trim().min(2, 'verb is required').max(100),
  region: z.enum(['castellano', 'voseo', 'canarias', 'formal']).default('castellano'),
});

export function createDictionaryConjugationRoutes({ service = spanishConjugationService } = {}) {
  const router = Router();

  router.get(
    '/api/dictionary/conjugations',
    authMiddleware,
    validate({ query: conjugationQuery }),
    asyncHandler(async (req, res) => {
      return res.json(service.conjugate(req.query.verb, req.query.region, { correlationId: req.id }));
    }),
  );

  return router;
}
