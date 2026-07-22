import crypto from 'node:crypto';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import pinoHttp from 'pino-http';
import logger from './logger.js';
import authRoutes from './routes/auth.js';
import classroomRoutes from './routes/classroom.js';
import classBookRoutes from './routes/classBooks.js';
import userLibraryBookRoutes from './routes/userLibraryBooks.js';
import dictionaryRoutes from './routes/dictionary.js';
import friendkeeperRoutes from './routes/friendkeeper.js';
import frequencyCatalogRoutes from './routes/frequencyCatalog.js';
import friendsRoutes from './routes/friends.js';
import groupClassRoutes from './routes/groupClass.js';
import homeRoutes from './routes/home.js';
import iceServersRoutes from './routes/iceServers.js';
import messagesRoutes from './routes/messages.js';
import newsRoutes from './routes/news.js';
import practiceRoutes from './routes/practice.js';
import progressionRoutes from './routes/progression.js';
import streamPostsRoutes from './routes/stream-posts.js';
import streamTopicsRoutes from './routes/stream-topics.js';
import streamWordsRoutes from './routes/stream-words.js';
import templatesRoutes from './routes/templates.js';
import translateRoutes from './routes/translate.js';
import usersRoutes from './routes/users.js';
import videosRoutes from './routes/videos.js';
import voicePracticeRoutes from './routes/voicePractice.js';
import { fallbackDiagnosticsMiddleware } from './lib/fallbackDiagnostics.js';
import { errorResponse } from './lib/httpErrors.js';
import { configuredOrigins } from './lib/origins.js';

export function createApp({ clientDist = path.resolve('client/dist') } = {}) {
  const app = express();
  const allowedOrigins = configuredOrigins();

  app.use(cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Correlation-ID'],
    exposedHeaders: ['Idempotency-Replayed', 'X-Polycast-Fallback-Diagnostics', 'X-Correlation-ID'],
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({
    logger,
    genReqId: (req) => req.headers['x-correlation-id'] || crypto.randomUUID(),
    autoLogging: {
      ignore: (req) => {
        const requestPath = req.url || '';
        return requestPath.startsWith('/assets/') || requestPath.endsWith('.js') || requestPath.endsWith('.css');
      },
    },
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, id: req.id }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
      censor: '[REDACTED]',
    },
  }));
  app.use((req, res, next) => {
    res.setHeader('X-Correlation-ID', req.id);
    next();
  });
  app.use(fallbackDiagnosticsMiddleware);
  app.use(express.static(clientDist));

  for (const routes of [
    authRoutes,
    usersRoutes,
    friendsRoutes,
    dictionaryRoutes,
    frequencyCatalogRoutes,
    messagesRoutes,
    classroomRoutes,
    classBookRoutes,
    userLibraryBookRoutes,
    iceServersRoutes,
    streamPostsRoutes,
    streamTopicsRoutes,
    streamWordsRoutes,
    videosRoutes,
    templatesRoutes,
    groupClassRoutes,
    newsRoutes,
    homeRoutes,
    progressionRoutes,
    practiceRoutes,
    voicePracticeRoutes,
    translateRoutes,
    friendkeeperRoutes,
  ]) app.use(routes);

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
    return res.sendFile(path.join(clientDist, 'index.html'));
  });

  app.use((err, req, res, _next) => {
    const response = errorResponse(err, req.id);
    const log = req.log || logger;
    const context = {
      err,
      code: response.body.code,
      status: response.status,
      correlationId: req.id,
      operation: `${req.method} ${req.path}`,
    };
    if (response.status >= 500) log.error(context, 'Server request failed');
    else log.warn(context, 'Server request rejected');
    return res.status(response.status).json(response.body);
  });

  return app;
}
