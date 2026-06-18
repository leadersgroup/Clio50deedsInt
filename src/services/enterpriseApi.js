import { config } from '../config.js';

// Low-level client for the 50deeds Enterprise API (Base44 serverless function) —
// the same processing pipeline fastwill.com orders flow through.
//
// Quirk of Base44: EVERY call is an HTTP POST to the single function URL. The
// intended REST method + path + API key all travel in the JSON body:
//   { "_path": "/orders", "_method": "POST", "_api_key": "...", ...fields }
//
// In MOCK mode (no ENTERPRISE_API_KEY) calls are short-circuited with sample
// responses so the whole flow is testable locally.

const MAX_RETRIES = 3;

export async function enterpriseRequest(path, method, fields = {}) {
  if (config.enterprise.mock) {
    return mockResponse(path, method, fields);
  }

  const body = JSON.stringify({
    _path: path,
    _method: method,
    _api_key: config.enterprise.apiKey,
    ...fields,
  });

  let attempt = 0;
  while (true) {
    const res = await fetch(config.enterprise.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });

    if (res.ok) return { status: res.status, data: await res.json() };

    // 404 is a meaningful "no data" signal for pricing — return it, don't retry.
    if (res.status === 404) {
      return { status: 404, data: await safeJson(res) };
    }
    // Retry transient server errors with backoff.
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await sleep(400 * 2 ** attempt);
      attempt++;
      continue;
    }
    const text = await safeText(res);
    const err = new Error(`Enterprise API ${res.status} for ${method} ${path}: ${text}`);
    err.status = res.status;
    throw err;
  }
}

// GET /pricing/{state}/{county} (deed_type affects FinCEN fee). Returns the price
// breakdown in DOLLARS, or null when the server has no pricing row (404).
export async function getPricing({ state, county, deedType }) {
  const path = `/pricing/${encodeURIComponent(state)}/${encodeURIComponent(county)}`;
  const { status, data } = await enterpriseRequest(path, 'GET', deedType ? { deed_type: deedType } : {});
  if (status === 404 || !data || data.error) return null;
  return data; // { service_fee, recording_fee, fincen_fee, premium_discount, total, currency, ... }
}

// POST /orders — create the deed order in the enterprise system of record.
// `fields` must include the required: property_address, grantor_name, grantee_name,
// deed_type, county, state, contact_email.
export async function createOrder(fields) {
  const { data } = await enterpriseRequest('/orders', 'POST', fields);
  // Response shape: { success, order: { id, custom_order_id, status, payment_status, ... } }
  return data.order || data;
}

export async function getOrder(orderId) {
  const { status, data } = await enterpriseRequest(`/orders/${orderId}`, 'GET');
  // 404 "Order not found" => the order was deleted/cancelled at 50deeds.
  if (status === 404 || data?.error) return { notFound: true };
  return data;
}

export async function registerWebhook(url) {
  const { data } = await enterpriseRequest('/webhooks/register', 'POST', { url });
  return data.webhook || data;
}

// Upload a file to 50deeds storage via the multipart uploadDocument endpoint
// (separate Base44 function, standard Bearer auth). Returns { file_url, file_name,
// file_size } — file_url is a public, downloadable URL hosted by 50deeds.
export async function uploadDocument(bytes, fileName, mime, { orderId, customOrderId } = {}) {
  if (config.enterprise.mock) {
    return { file_url: `mock://uploaded/${encodeURIComponent(fileName)}`, file_name: fileName, file_size: bytes.length };
  }
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime || 'application/octet-stream' }), fileName);
  // Sent so 50deeds can link the file to the order once uploadDocument honors it
  // (currently storage-only; harmless until then).
  if (orderId) form.append('order_id', String(orderId));
  if (customOrderId) form.append('custom_order_id', String(customOrderId));
  const res = await fetch(config.enterprise.uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.enterprise.apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const text = await safeText(res);
    const err = new Error(`uploadDocument failed (${res.status}): ${text}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return { file_url: data.file_url, file_name: data.file_name || fileName, file_size: data.file_size ?? bytes.length, uploaded_at: data.uploaded_at };
}

// ── mocks ────────────────────────────────────────────────────────────────────

function mockResponse(path, method, fields) {
  if (path.startsWith('/pricing/')) {
    // Mirror the documented FL/Miami-Dade example; +$95 for FinCEN-reportable types.
    const reportable = /reportable/i.test(fields.deed_type || '') && !/non-reportable/i.test(fields.deed_type || '');
    const fincen = reportable ? 95 : 0;
    return {
      status: 200,
      data: {
        state: path.split('/')[2],
        county: decodeURIComponent(path.split('/')[3] || ''),
        deed_type: fields.deed_type || '',
        service_fee: 299,
        recording_fee: 25,
        fincen_fee: fincen,
        fincen_required: reportable,
        premium_discount: 45,
        total: 279 + fincen,
        currency: 'USD',
      },
    };
  }
  if (path === '/orders' && method === 'POST') {
    const id = `mock_${shortHash(JSON.stringify(fields))}`;
    return {
      status: 201,
      data: {
        success: true,
        order: {
          id,
          custom_order_id: `MOCK-${id.slice(-6)}`,
          status: 'Submitted',
          payment_status: fields.payment_status || 'paid',
          property_address: fields.property_address,
          mock: true,
        },
      },
    };
  }
  if (path === '/webhooks/register') {
    return { status: 201, data: { success: true, webhook: { id: 'mock_webhook', url: fields.url, is_active: true } } };
  }
  return { status: 200, data: { mock: true } };
}

function shortHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
async function safeText(res) {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return '<no body>';
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
