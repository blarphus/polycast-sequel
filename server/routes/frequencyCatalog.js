import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { asyncHandler } from '../lib/httpErrors.js';
import { getLatestCatalogBuildProgress } from '../lib/catalogBuildProgress.js';

const router = Router();

router.get('/api/frequency-catalog/progress', authMiddleware, asyncHandler(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json(await getLatestCatalogBuildProgress());
}));

export default router;
