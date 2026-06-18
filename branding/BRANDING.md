# 50deeds for Clio — Branding & App Release Package

Everything needed to publish the **50deeds for Clio** integration in the
[Clio App Directory](https://www.clio.com/app-directory/), plus the brand system
used inside the app itself.

> Note: align the palette and wordmark with 50deeds.com's existing brand before
> publishing — if 50deeds has official hex values or a logo file, swap them in.
> The values below match the integration's current UI.

---

## 1. Naming

| Field | Value |
|---|---|
| **App / listing name** | 50deeds for Clio |
| **Vendor** | 50deeds.com |
| **In-matter action (primary)** | `Order deed transfer with 50deeds` |
| **In-matter action (manage)** | `View/manage 50deeds order` |

> Clio custom-action labels have a **32-character maximum** — both labels above
> are within it. Don't lengthen them.

---

## 2. Positioning & messaging

**One-liner (tagline):**
> Order recorded deed transfers without leaving your Clio matter.

**Short description (~150 chars, for cards/search):**
> Order, pay for, and track recorded deed transfers from any Clio matter — with
> documents and live status synced back automatically.

**Long description (listing body):**
> 50deeds for Clio turns a Clio matter into a one-click deed-ordering desk. Open
> any matter, click **Order deed transfer with 50deeds**, and the order form is
> pre-filled from the matter and its contacts. Pick who's transferring to whom —
> we map it to the correct deed type — confirm the property address (with live
> pricing pulled per county), and pay by card. The order is submitted straight to
> 50deeds' fulfillment pipeline.
>
> From then on, everything stays in sync with the matter. A confirmation note is
> posted back to Clio, status changes from 50deeds appear automatically, and you
> can exchange the signed deed and supporting documents from a **View/manage**
> screen right inside Clio. No re-keying, no second portal, no lost paperwork.

**Value props (by reason to care):**
- **Faster turnaround** — order in under a minute; the matter fills the form for you.
- **No double entry** — parties, property, and contact details come from the matter.
- **Right deed type, every time** — choose the parties; the correct deed type is selected automatically.
- **Transparent pricing** — county-accurate service + recording fees shown before you pay.
- **Stays in Clio** — confirmation, live status, and documents all sync to the matter.
- **Built for trust work** — handles state-specific requirements (e.g. New York SSNs) and keeps sensitive data encrypted.

**Categories (pick 2–3 on submission):** Document Management · Document Automation · Real Estate.

---

## 3. Voice & tone

Professional, plain-spoken, and reassuring — written for busy estate-planning and
real-estate attorneys.

- **Do:** be concrete and benefit-led ("order in under a minute", "synced back to the matter").
- **Do:** use legal-correct terms (grantor, grantee, recorded deed) but never bury the reader in jargon.
- **Don't:** overpromise legal outcomes or use hype ("revolutionary", "AI-powered").
- **Tense/voice:** active, second person ("you order", "we submit").

---

## 4. Logo & icon

| File | Use |
|---|---|
| `icon.svg` | App tile / favicon / Directory icon (square, 512×512) |
| `logo-horizontal.svg` | Wordmark lockup for docs, emails, the in-app header |

**The mark:** a deed page with an amber "recorded" seal and checkmark on a blue
tile — "an official deed, done." It reads clearly down to 16px.

**Export targets** (rasterize `icon.svg`):
- Clio Directory icon: **512×512 PNG** (and a 1024×1024 master).
- Favicon: 32×32 and 16×16 PNG / ICO.
- App stores / social: 1024×1024 PNG.

**Clear space:** keep padding ≥ 25% of the icon height around the horizontal lockup.
**Minimum size:** icon 24px; horizontal lockup 120px wide.

**Don'ts:** don't recolor the tile, stretch the mark, add effects, place the
wordmark on a low-contrast background, or rename the app in the lockup.

---

## 5. Color palette

| Token | Hex | Role |
|---|---|---|
| Primary Blue | `#2563eb` | Primary actions, links, brand |
| Deep Navy | `#1a2b4a` | Headings, body text, depth |
| Brand Gradient | `#3b82f6 → #1d3a8f` | App tile background |
| Seal Amber | `#f59e0b` | Accent — "recorded / official" |
| Success Green | `#1a7f4b` | Confirmed / paid states |
| Alert Amber (text) | `#b26a00` | Warnings / blocked states |
| Surface | `#f1f4f9` | Card and section backgrounds |
| Line | `#e2e8f0` | Borders / dividers |
| Muted | `#64748b` | Secondary text, timestamps |

These match the live order form, success, and manage screens.

---

## 6. Typography

- **Primary typeface:** Inter (web). Fallback stack: `Inter, "Segoe UI", system-ui, -apple-system, sans-serif`.
- **Wordmark:** Inter ExtraBold (800), `50` in Primary Blue, `deeds` in Deep Navy, tight tracking (~-2.5).
- **Headings:** 700–800. **Body:** 400–600. **Eyebrow/labels:** 600, uppercase, +6 tracking (e.g. "FOR CLIO").

---

## 7. Screenshot shot list (for the listing)

Capture at a clean 1280–1600px wide. Suggested order + captions:

1. **In the matter** — the `Order deed transfer with 50deeds` action on a Clio matter.
   _Caption: "Start from any matter — one click."_
2. **Order form** — transfer-parties chips, address autocomplete, the Price Estimate breakdown.
   _Caption: "Pre-filled from the matter, with county-accurate pricing."_
3. **Checkout** — Stripe payment.
   _Caption: "Pay by card; the order is submitted automatically."_
4. **Confirmation** — the success page with "View & track this order".
5. **Manage screen** — live status badge, documents with upload + ET timestamps.
   _Caption: "Track status and exchange documents inside Clio."_
6. **Matter note** — the confirmation/status note synced back into the Clio matter.
   _Caption: "Status and confirmations sync back to the matter."_

---

## 8. In-product branding touchpoints

Apply the system consistently across the screens the app already renders:

- **OAuth consent screen** — horizontal lockup, Primary Blue CTA.
- **Order form header** — "New Order" with the mark; Primary Blue submit.
- **Success page** — Success Green confirmation, Primary Blue "View & track".
- **Manage page** — header with the mark + matter reference.
- **Favicon** — `icon.svg` export.

---

## 9. Submission checklist (Clio App Directory)

- [ ] App name + vendor: **50deeds for Clio** / 50deeds.com
- [ ] App icon — 512×512 PNG (from `icon.svg`)
- [ ] Tagline + short + long descriptions (§2)
- [ ] 5–6 screenshots with captions (§7)
- [ ] Categories selected (§2)
- [ ] OAuth scopes documented (matters, contacts, custom_actions, notes/documents as used)
- [ ] Support email + website (`https://50deeds.com`)
- [ ] Privacy Policy URL
- [ ] Terms of Service URL
- [ ] Pricing model (per-order; deed fees shown at checkout)
- [ ] Production redirect URI + HTTPS verified

---

## 10. Boilerplate (for the listing footer / press)

> **50deeds for Clio** lets estate-planning and real-estate attorneys order
> recorded deed transfers directly from a Clio matter — pre-filled, paid by card,
> and synced back to the matter with documents and live status. Learn more at
> [50deeds.com](https://50deeds.com).
