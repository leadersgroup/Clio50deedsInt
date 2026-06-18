import { clioPost } from './client.js';

// Post a Note to a Clio matter. It appears on the matter's activity feed, giving
// the attorney an in-Clio record of the deed order. Requires the OAuth app to have
// a Notes (write) permission; a 403 here means that permission isn't granted yet.
export async function postMatterNote(clioUserId, matterId, { subject, detail }) {
  const json = await clioPost(clioUserId, 'notes', {
    data: {
      type: 'Matter',
      matter: { id: Number(matterId) },
      subject,
      detail,
    },
  });
  console.log('[clio] note posted to matter', matterId, '-> note id', json.data?.id);
  return json.data;
}
