import { clioGet } from './client.js';

// Field selection for the matter. Clio's `fields` parser supports only ONE level
// of {} nesting — nesting a grandchild (e.g. client{primary_address{...}}) returns
// 400 InvalidFields. So the matter fetch stays shallow (one level), and the data
// that lives a level deeper — the client's mailing address and the related
// contacts — is pulled with separate top-level requests (fetchContact /
// fetchMatterRelationships), each of which is itself only one level deep.
const MATTER_FIELDS = [
  'id',
  'display_number',
  'description',
  'client{id,name,first_name,last_name,type,primary_email_address}',
  'practice_area{id,name}',
  'custom_field_values{id,field_name,value}',
].join(',');

// Related people on the matter (trustees, beneficiaries, co-owners). Fetched via
// the top-level /relationships resource filtered by matter_id, so contact{...} is
// one level deep (allowed) instead of two (matter -> relationships -> contact).
const RELATIONSHIP_FIELDS = [
  'id',
  'description',
  'contact{id,name,first_name,last_name,type}',
].join(',');

const CONTACT_FIELDS = [
  'id',
  'name',
  'first_name',
  'last_name',
  'type',
  'date_of_birth',
  'primary_address{name,street,city,province,postal_code,country}',
  'primary_email_address',
].join(',');

// Fetch a matter via its Clio subject_url, passing the single-use custom-action nonce
// so Clio authorizes the read. Returns the raw `data` object.
// IMPORTANT: the nonce expires in 60s and is single-use — call this immediately.
export async function fetchMatter(clioUserId, subjectUrl, nonce) {
  const json = await clioGet(clioUserId, subjectUrl, {
    query: { fields: MATTER_FIELDS, custom_action_nonce: nonce },
    allowOneAuthRetry: false, // nonce is single-use; never silently retry the GET
  });
  return json.data;
}

// Fetch the matter's relationships (related contacts) as a separate top-level query
// so the contact association is only one nesting level deep. Returns an array.
export async function fetchMatterRelationships(clioUserId, matterId) {
  const json = await clioGet(clioUserId, 'relationships', {
    query: { matter_id: matterId, fields: RELATIONSHIP_FIELDS },
  });
  return Array.isArray(json.data) ? json.data : [];
}

// Fetch full detail for a single contact (DOB, full address, etc.).
// Returns { contact, redacted } — `redacted` true when the user lacks permission
// and Clio stripped fields (it sets a `redacted` flag on the resource).
export async function fetchContact(clioUserId, contactId) {
  const json = await clioGet(clioUserId, `contacts/${contactId}`, {
    query: { fields: CONTACT_FIELDS },
  });
  const contact = json.data;
  return { contact, redacted: Boolean(contact?.redacted) };
}
