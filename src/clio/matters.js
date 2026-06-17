import { clioGet } from './client.js';

// Field selection for the matter. Clio allows only ONE level of nested-field
// selection ({ }); deeper nesting returns 400. We pull the matter + its client +
// related contacts shallowly, then fetch full contact detail separately when needed.
const MATTER_FIELDS = [
  'id',
  'display_number',
  'description',
  'client{id,name,first_name,last_name,type,primary_address{name,street,city,province,postal_code,country},primary_email_address}',
  'practice_area{id,name}',
  'relationships{id,description,contact{id,name,first_name,last_name,type}}',
  'custom_field_values{id,field_name,value,custom_field{id,name}}',
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
