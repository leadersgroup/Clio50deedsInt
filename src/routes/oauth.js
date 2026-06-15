import express from 'express';
import { config } from '../config.js';
import { buildAuthorizeUrl, exchangeCodeForToken } from '../clio/oauth.js';
import { ensureCustomAction } from '../clio/customActions.js';
import { createState, verifyState } from '../util/signedState.js';

export const oauthRouter = express.Router();

// Kick off install: send the firm/user to Clio's consent screen.
// Optional ?return=<path> remembers where to send them after install.
oauthRouter.get('/install', (req, res) => {
  const state = createState({ return: typeof req.query.return === 'string' ? req.query.return : '/' });
  res.cookie('clio_oauth_state', state, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
  });
  res.redirect(buildAuthorizeUrl(state));
});

// OAuth callback: verify state, exchange code, persist tokens, register the action.
oauthRouter.get('/callback', async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.status(400).send(`Clio authorization was declined: ${escapeHtml(String(error))}`);
    if (!code) return res.status(400).send('Missing authorization code.');

    const cookieState = req.cookies?.clio_oauth_state;
    if (!state || !cookieState || state !== cookieState || !verifyState(String(state))) {
      return res.status(400).send('Invalid OAuth state. Please restart the install from /clio/install.');
    }
    res.clearCookie('clio_oauth_state');

    const { clioUserId } = await exchangeCodeForToken(String(code));

    // Register the custom action so "Order a deed with 50deeds" appears on matters.
    let actionResult;
    try {
      actionResult = await ensureCustomAction(clioUserId);
    } catch (e) {
      // Token is saved; the action can be (re)registered via /clio/register-action.
      console.error('[oauth] custom action registration failed', e.message);
    }

    const parsed = verifyState(String(state));
    res
      .status(200)
      .send(
        installSuccessHtml({
          clioUserId,
          actionRegistered: Boolean(actionResult?.action),
          returnPath: parsed?.return || '/',
        }),
      );
  } catch (err) {
    next(err);
  }
});

// Manual (re)registration of the custom action for an already-authorized user.
oauthRouter.get('/register-action', async (req, res, next) => {
  try {
    const clioUserId = Number(req.query.user_id);
    if (!clioUserId) return res.status(400).send('Provide ?user_id=<clio user id>');
    const result = await ensureCustomAction(clioUserId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

function installSuccessHtml({ clioUserId, actionRegistered, returnPath }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>50deeds × Clio installed</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 20px;color:#1a2b4a}
.ok{color:#1a7f4b}.warn{color:#b26a00}code{background:#f1f4f9;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>✅ 50deeds is connected to Clio</h1>
<p>Authorized as Clio user <code>${clioUserId}</code>.</p>
<p>${actionRegistered ? '<span class="ok">The “Order a deed with 50deeds” action is now on your Matter screen.</span>' : '<span class="warn">Custom action not registered yet — visit <code>/clio/register-action?user_id=' + clioUserId + '</code>.</span>'}</p>
<p>Open any estate matter in Clio and click <strong>Order a deed with 50deeds</strong>.</p>
<p><a href="${escapeHtml(returnPath)}">Continue</a></p></body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
