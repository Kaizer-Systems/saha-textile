# MSG91 Notifications — Provider, Pricing & Use-Case Credit Map

Created: 2026-07-05
Status: **LOCKED** (provider + channel-direct OTP + split toggles). Reference doc for the `NotificationPort` implementation.
Source of truth for decisions: `owner-decisions-log.md` (2026-07-05 section). This file holds the detail those decisions point to.

---

## 1. Decisions (locked 2026-07-05)

- **Provider = MSG91** for all customer messaging: **SMS + WhatsApp + Email** (email consolidated into MSG91). This **revises the earlier "Resend primary" email lock → "MSG91 primary."** Resend/SES remain only as a **code-level `EmailPort` fallback** (swappable, not operated).
- **Team mailboxes = Google Workspace** (separate system; humans read/reply). Not MSG91.
- **Channel-direct OTP** — we generate/store/verify OTP ourselves (`otpChallenges`) and send the code through the **SMS / WhatsApp / Email** channel tools. We do **NOT** use MSG91's **OTP Widget** or **SendOTP** products for any use case. Billing is **per send only** (generate + verify are free in our code); a resend = +1 send.
- **Seam-first** — build `NotificationPort` + adapters + admin UI now; wire the live MSG91 account once DLT + WhatsApp template approvals land. All 3 channels ship code-ready.
- **Split kill-switches** — see §6.

---

## 2. Full pricing (all 10 MSG91 products) — captured from portal 2026-07-03

All prices **exclude 18% GST** unless noted. India origin.

### Hello (support desk — live chat + shared inbox + tickets)
| Plan | Price/mo | Included | Extra |
|---|---|---|---|
| Live Chat | ₹0 | Unlimited tickets, 1 inbox | — |
| Free | ₹0 | 2 inbox, 50 tickets | — |
| Basic | ₹1,500 | 2 inbox, 1,000 tickets | Inbox ₹500/unit, Tickets ₹0.50/unit |
| Premium | ₹3,000 | 3 inbox, 2,000 tickets | Inbox ₹500/unit, Tickets ₹0.75/unit |

### Campaign (bulk-send engine)
- Campaign usage **free**; pay the per-channel message cost. Third-party API calls to be charged per 1,000 "soon."

### Segmento (contacts + segmentation + automation — billed by contacts/mo, quota resets)
| Plan | Price/mo | Contacts | Extra |
|---|---|---|---|
| Unlimited Contacts | ₹0 | Unlimited (no Automations/Segmentation) | — |
| Free | ₹0 | 2,000 | not allowed |
| Starter | ₹1,999 (0 for 2 mo) | 10,000 | ₹499/1,000 |
| Cruiser | ₹4,999 (0 for 2 mo) | 30,000 | ₹349/1,000 |
| Turbo | ₹9,999 (0 for 2 mo) | 1,00,000 | ₹199/1,000 |
| Nitro | ₹19,999 | 3,00,000 | — |
| Supersonic | ₹49,999 | 10,00,000 | — |

### OTP Widget (free widget/SDK) — NOT USED by us (see §1)
- Email OTP ₹0.03/unit · Voice OTP ₹1/unit · Invisible OTP ₹0.15 (India) · SMS/WhatsApp OTP per channel rate card.

### SMS (volume-tiered, source→destination)
- **India→India:** ₹0.25 (5k) → ₹0.20 (16.5k) → ₹0.18 (30k) → ₹0.17 (60k–4.5L) → ₹0.16 (9.6L). Negotiable to ₹0.13. *(30k = ₹5,400 @ ₹0.18)*
- **India→UK:** ~₹5.12/SMS (→ ₹4.48 at high volume).
- ⚠️ **Failed SMS also charged.**

### SendOTP (OTP over SMS) — NOT USED by us
- India→India ₹0.25→₹0.18; India→UK ~₹5.76→₹5.12.

### Email (monthly quota, resets — no rollover)
| Plan | Price/mo | Emails | Validations | Overage | DMARC + Handlebars |
|---|---|---|---|---|---|
| Free | ₹0 | 5,000 | 50 | none | ❌ |
| Starter | ₹2,000 | 1,00,000 | 500 | ₹0.02/email | ✅ |
| Basic | ₹4,600 | 2,50,000 | 5,000 | ₹0.015/email | ✅ |
| Alpha | ₹7,500 | 5,00,000 | 8,000 | ₹0.01/email | ✅ |

⚠️ **DMARC compliance + Handlebars templating start at Starter** → Starter (₹2,000/mo) is our practical floor for transactional email.

### WhatsApp (Titan plan)
- **₹500/mo per number** (single fee, free first 2 months) covering **all** WA categories. Per-message billed per rate card by category × country:
- **India:** Utility **₹0.115** · Authentication **₹0.115** · Marketing **₹0.8631**.
- Examples abroad: Germany ₹4.03/₹4.03/₹10.01 · France –/–/₹6.30 · Brazil ₹0.50/₹0.50/₹4.58 · Indonesia ₹1.83/₹1.83/₹3.01.

### Voice
- India landline outgoing ₹0.5/min; international via premium A-Z. Voice OTP ₹1/unit. Add-ons (recording/analytics/monitoring/masking) free. → **defer / not launch.**

### RCS (emerging — defer as future seam)
| Plan | Price/mo | Wallet | iPhone RCS delivery |
|---|---|---|---|
| Launch | ₹2,000 | ₹2,000 | ❌ |
| Build | ₹5,000 | ₹5,000 | ❌ |
| Grow | ₹10,000 | ₹10,000 | ✅ |
- Rate card: single-text promo/transactional ₹0.15; rich promo/transactional ₹0.20.

---

## 3. Hybrid billing model — how credits are "used"

Three payment mechanics run in parallel:

1. **Prepaid wallet (pay-as-you-go, ROLLS OVER)** — SMS, SendOTP, WhatsApp messages, Voice, RCS, OTP-widget sends. Top up a ₹ balance; each send deducts its rate-card amount **at send time**; balance persists month-to-month; low/empty balance → sends fail until top-up. ⚠️ SMS charged even on failure; WhatsApp/RCS charged on delivered/processed.
2. **Monthly subscription quota (RESETS monthly, no rollover)** — Email (Free 5k … Alpha 500k) and Segmento (by contacts stored/mo). Each email decrements the month's counter; unused is lost at month-end; overage bills per unit. Segmento "used" = contacts stored that month, not sends.
3. **Fixed monthly add-on fees** — WhatsApp ₹500/mo per number; RCS plan fee (includes wallet); Hello flat tiers.

**Typical monthly bill = fixed pieces + variable wallet burn:** WhatsApp ₹500/number (if on) + Email plan (₹2,000 Starter) + Segmento plan (if marketing) + wallet top-ups for SMS/WhatsApp/Voice actually sent. **+18% GST on everything.**

**Wallet is one balance, route-based** — NOT separate domestic/international packages. Each message deducts at its **source(India)→destination-country** rate: domestic cheap & volume-tiered; each foreign country its own (higher) rate.

---

## 4. Tool glossary — keep / skip

| Tool | What it is | Our use |
|---|---|---|
| **SMS** | Transactional/promo SMS, wallet | ✅ channel adapter |
| **Email** | Transactional + marketing email, monthly quota | ✅ channel adapter (Starter+ for DMARC/Handlebars) |
| **WhatsApp** | WhatsApp Business API, wallet + ₹500/mo number | ✅ channel adapter |
| **Campaign** | Free bulk-send engine | ✅ marketing sends (pay channel cost) |
| **Segmento** | Contacts + segmentation + automation | ✅ marketing segmentation (contacts-billed) |
| **OTP (Widget)** | Managed multi-channel OTP widget | ❌ not used — we own OTP (channel-direct) |
| **SendOTP** | Managed OTP over SMS (API) | ❌ not used — we own OTP |
| **Voice** | Voice calls / Voice OTP | ⏸ defer (fallback seam only) |
| **RCS** | Rich messaging (Android-first) | ⏸ defer (future seam) |
| **Hello** | Omnichannel support desk | ⏸ optional; mailboxes are Google Workspace |

---

## 5. Use-case → MSG91 tool → type → stage → units → pricing map

**Pricing legend (India origin; +18% GST):** **[Email]** monthly quota, ~₹0.02/email effective (Starter), overage ₹0.02→₹0.01, flat/no-country. **[SMS]** India ~₹0.18 (₹0.16–0.25, ≤₹0.13 negotiated), per-destination-country abroad (UK ₹5.12), failed charged. **[WA-Util/Auth]** India ₹0.115; abroad higher. **[WA-Mktg]** India ₹0.8631; abroad higher. Single ₹500/mo WhatsApp number fee covers all WA. **[Campaign]** free + channel cost. **[Segmento]** contacts/mo subscription.

**One-to-many (origin = India, destination = many):** SMS & WhatsApp rows above are India→India; any customer abroad deducts that **destination country's** rate for the same message. Email is flat regardless of country; admin rows are India-cost.

### Storefront
| # | Use case | MSG91 Tool(s) | Type | Credit-consuming stage | Units per event | Pricing per tool (India→dest.) |
|---|---|---|---|---|---|---|
| 1 | Signup / login OTP | Email, (SMS), (WhatsApp) | Auth | On "send code" (verify = 0 sends) | 1 × enabled channel; +1 per resend | Email ~₹0.02 · SMS ₹0.18 (UK ₹5.12) · WA-Auth ₹0.115 |
| 2 | Password reset / email-change verify | Email, (SMS) | Auth/Utility | On request | 1 × channel | Email ~₹0.02 · SMS ₹0.18 |
| 3 | Welcome message | Email, (WhatsApp) | Utility (or Mktg if promo) | On signup complete | 1 × channel | Email ~₹0.02 · WA-Util ₹0.115 (or WA-Mktg ₹0.8631) |
| 4 | Order placed / confirmed | SMS + WhatsApp + Email | Utility | On order success | 1 each = up to 3 | SMS ₹0.18 · WA-Util ₹0.115 · Email ~₹0.02 |
| 5 | Order status updates | SMS + WhatsApp + Email | Utility | Each status change | 1 × channel × transition | as #4, × each transition |
| 6 | Payment events (success/fail/refund) | SMS + WhatsApp + Email | Utility | Each payment/refund change | 1 × channel × event | SMS ₹0.18 · WA-Util ₹0.115 · Email ~₹0.02 |
| 7 | Shipment/tracking (link, OFD, delivered) | WhatsApp + Email + (SMS) | Utility | Each shipping event | 1 × channel × event | WA-Util ₹0.115 · Email ~₹0.02 · SMS ₹0.18 |
| 8 | Abandoned-cart reminder | Campaign + Segmento → Email + WhatsApp + (SMS) | Marketing (consent) | Each reminder | 1 × channel × reminder × abandoner | WA-Mktg ₹0.8631 · Email ~₹0.02 · SMS ₹0.18 |
| 9 | Back-in-stock / price-drop / wishlist | Email + WhatsApp + SMS (via Campaign/Segmento) | Marketing | On trigger, per subscriber | 1 × channel × subscriber | WA-Mktg ₹0.8631 · Email ~₹0.02 · SMS ₹0.18 |
| 10 | Q&A answer notification | Email | Utility | When admin publishes answer | 1 | Email ~₹0.02 |
| 11 | Review request post-delivery | Email + (WhatsApp) | Marketing/Utility | After delivered | 1 × channel × order | Email ~₹0.02 · WA-Mktg ₹0.8631 (or Util) |
| 12 | Promotional campaign / newsletter | Campaign + Segmento → Email + WhatsApp + SMS | Marketing (consent) | On campaign send to segment | 1 × channel × contact | WA-Mktg ₹0.8631 · Email ~₹0.02 · SMS ₹0.18 — × contacts (biggest cost) |
| 13 | Account/security alerts | Email | Utility | Per security event | 1 | Email ~₹0.02 |

### Admin
| # | Use case | MSG91 Tool(s) | Type | Stage | Units | Pricing (India) |
|---|---|---|---|---|---|---|
| 14 | Staff invite | Email | Transactional | On invite | 1 | Email ~₹0.02 |
| 15 | Admin password reset | Email | Transactional | On request | 1 | Email ~₹0.02 |
| 16 | Ops alerts to admin (new order, low stock, failed payment, new Q&A) | Email + (WhatsApp) | Utility | Per event, per admin recipient | 1 × channel × recipient × event | Email ~₹0.02 · WA-Util ₹0.115 |
| 17 | Scheduled report digests (optional) | Email | Utility | On schedule | 1 × recipient | Email ~₹0.02 |

**Per-order multiplier:** all-3-channels order lifecycle ≈ 6 touchpoints × 3 channels ≈ **~18 transactional units/order**; cheap (WA-Util ₹0.115 / SMS ₹0.18 / Email quota). The runaway line is **Marketing WhatsApp (₹0.8631 × list)** — governed by the split marketing toggle.

---

## 6. Split kill-switches (locked)

Per-channel master toggles are **split by category** so promo spend caps independently of transactional:

- **Transactional/Utility** WhatsApp/SMS/Email toggles — keep ON (cheap, high value: OTP, order/status, payment, security).
- **Marketing** WhatsApp/SMS/Email toggles — separately capped/disable-able (consent-gated; WA-Mktg is the dominant cost).
- Each toggle short-circuits **all** outbound calls on that (channel × category) across every flow; graceful OTP fallback to an enabled channel. Plan-limit awareness warns/auto-disables near purchased limits.
- Caveats: the WhatsApp **₹500/mo number fee** is a subscription (persists while the number is active even if sends paused); Email/Segmento **monthly fees** are committed for the month regardless of volume. Toggles save the **per-message** burn, not the fixed monthly fees.
- Settings are on a **dedicated RBAC-gated admin page/menu (high-privilege only), authorized server-side**, audited, permission-version bumped on change.
