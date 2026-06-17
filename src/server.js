import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { oauthRouter } from './routes/oauth.js';
import { customActionRouter } from './routes/customAction.js';
import { orderRouter } from './routes/order.js';
import { stripeRouter } from './routes/stripe.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Behind Railway's proxy: trust X-Forwarded-* so secure cookies + protocol detection work.
app.set('trust proxy', 1);

// Enforce HTTPS in production (Railway terminates TLS; redirect any http hit).
app.use((req, res, next) => {
  if (config.isProd && req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
  }
  // HSTS
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Stripe webhook needs the raw body for signature verification — mount BEFORE json parser.
app.use('/stripe/webhook', express.raw({ type: 'application/json' }));

// Limit raised to accommodate base64 supporting-document uploads on the order form.
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(config.cookieSecret));

// Health check for Railway.
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Landing / install entry point.
app.get('/', (_req, res) => {
  res.send(
    `<!doctype html><meta charset="utf-8"><div style="font-family:system-ui;max-width:520px;margin:80px auto">
     <h1>50deeds × Clio</h1>
     <p>Order a deed directly from a Clio estate matter.</p>
     <p><a href="/clio/install">Connect your Clio account →</a></p></div>`,
  );
});

app.use('/clio', oauthRouter);
app.use('/clio', customActionRouter);
app.use('/order', orderRouter);
app.use('/stripe', stripeRouter);

// 404
app.use((req, res) => res.status(404).send('Not found'));

// Error handler — never leak tokens/nonces; log message only.
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).send('Something went wrong. Please try again from the Clio matter.');
});

async function start() {
  await migrate();
  app.listen(config.port, () => {
    console.log(`[server] listening on :${config.port} (${config.isProd ? 'production' : 'development'})`);
  });
}

start().catch((err) => {
  console.error('[server] failed to start', err);
  process.exit(1);
});

export { app };
