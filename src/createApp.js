import path from 'path';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import multer from 'multer';
import expressLayouts from 'express-ejs-layouts';
import { corsOriginList } from './lib/corsOrigins.js';
import { sessionSecret } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { createAdminRouter } from './routes/admin.js';
import { apiRoutes } from './routes/api.js';
import { createPublicShareRouter, renderShareGallery } from './routes/publicShares.js';
import { getShareByIdAsync } from './shareStore.js';
import { encodeShareId, decodeShareId } from './lib/shortId.js';

export function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(process.cwd(), 'src', 'views'));
  app.use(expressLayouts);
  app.set('layout', 'layout');
  app.locals.shortPath = (id) => {
    const code = encodeShareId(id);
    return code ? `/${code}` : `/s/${id}`;
  };
  app.use('/public', express.static(path.join(process.cwd(), 'public')));
  const viewerDir = path.join(process.cwd(), 'public', 'viewer');
  // Avoid 301 /viewer ↔ /viewer/ loops behind some proxies; serve index without redirects.
  app.get(['/viewer', '/viewer/'], (req, res) => {
    res.type('html');
    res.sendFile('index.html', { root: viewerDir, maxAge: 0 });
  });
  app.get('/viewer/share.html', (req, res) => {
    const id = (req.query.id || '').toString().trim();
    if (!id) {
      res.redirect(302, '/viewer/');
      return;
    }
    res.redirect(302, `/s/${encodeURIComponent(id)}`);
  });
  app.use(
    '/viewer',
    express.static(viewerDir, {
      index: false,
      extensions: ['html'],
    })
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.use(
    cors({
      origin: corsOriginList(),
      credentials: false,
    })
  );

  app.use(
    session({
      secret: sessionSecret(),
      resave: false,
      saveUninitialized: false,
    })
  );

  const upload = multer({ storage: multer.memoryStorage() });

  app.get('/healthz', (req, res) => {
    res.json({ ok: true });
  });

  app.use(authRoutes);
  app.use('/admin', createAdminRouter(upload));
  app.use('/api', apiRoutes);
  app.use('/s', createPublicShareRouter(upload));

  // Short alias for /s/:id (22-char base64url of the same UUID). Existing /s/<uuid> links are untouched.
  app.get('/:code([A-Za-z0-9_-]{22})', async (req, res, next) => {
    try {
      const id = decodeShareId(req.params.code);
      if (!id) return next();
      const share = await getShareByIdAsync(id);
      if (!share) return res.status(404).send('Share not found');
      return renderShareGallery(req, res, share);
    } catch (e) {
      return next(e);
    }
  });

  return app;
}
