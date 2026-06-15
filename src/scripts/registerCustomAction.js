import { pool } from '../db/index.js';
import { ensureCustomAction } from '../clio/customActions.js';

// One-time / idempotent registration of the "Order a deed with 50deeds" custom action
// for an already-authorized Clio user.
//
//   npm run register-action -- <clio_user_id>
//
// Normally this runs automatically at the end of the OAuth install (see routes/oauth.js).
async function main() {
  const userId = Number(process.argv[2]);
  if (!userId) {
    console.error('Usage: npm run register-action -- <clio_user_id>');
    process.exit(1);
  }
  const result = await ensureCustomAction(userId);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
