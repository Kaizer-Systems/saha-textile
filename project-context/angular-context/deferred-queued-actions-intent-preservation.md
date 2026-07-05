# Deferred / Queued-Action (Intent-Preservation) — DRAFT

Created: 2026-07-05
Status: **DRAFT — NOT yet verified or locked by owner.** Reference copy for review/modification. Do not treat as final until folded into `owner-decisions-log.md`.
Related: RBAC settings pattern, guest-cart merge (`owner-decisions-log.md`), auth flows (`codex-auth-...`).

---

## Mechanics (one contract for all rows)

A guest triggers an account-tied action → system stores a `pendingIntent {action, params, originRoute, ts}` (short TTL) → redirects to login/signup.

- **On cancel/abandon:** discard the intent; return to origin screen unchanged.
- **On auth success:** (a) run the existing guest-cart → user-cart **merge first**, (b) **suppress** the default post-auth destination (dashboard/welcome), (c) **replay** the intent, (d) return to the **origin screen** with updated UI (e.g. active ♥) + a top-right toaster status.
- **At replay, re-validate** (availability / stock / eligibility); if now invalid, show error toaster, do not execute, stay put.
- Only one pending intent (latest wins) or a small bounded queue.

---

## Storefront

| #   | Action                                 | Origin screen(s)                          | Auth?                     | Normal (logged-in) end state             | Guest → after auth                              | If invalid at replay                 | My Comments                                                                                                                                                                                                        |
| --- | -------------------------------------- | ----------------------------------------- | ------------------------- | ---------------------------------------- | ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Add to **Wishlist** (♥)                | category, search, product-list, PDP, cart | **Yes**                   | added, ♥ active, toaster, stay on origin | replay add, ♥ active, toaster, return to origin | product gone → error toaster, no add |                                                                                                                                                                                                                    |
| 2   | **Save for Later**                     | cart                                      | **Yes**                   | item → Saved list, toaster, stay on cart | replay move, toaster, return to cart            | OOS/gone → error, stay               |                                                                                                                                                                                                                    |
| 3   | **Notify-me / Back-in-stock**          | PDP (OOS), product-list                   | **Yes**                   | subscribed, toaster                      | replay subscribe, return to PDP                 | back in stock → info toaster         |                                                                                                                                                                                                                    |
| 4   | **Write review / rate**                | PDP, order-detail, order-history          | **Yes + purchased**       | review form/submit, toaster              | replay (after purchase check), return           | not purchased → block w/ message     |                                                                                                                                                                                                                    |
| 5   | **Reorder / Buy again**                | order-history, order-detail               | **Yes**                   | items → cart, go to cart                 | replay add-to-cart, go to cart                  | some gone → partial + notice         | order-history or order-detail are already logged in screens so i dont know why the intent needs to be saved, seeing as those actions cannot be initiated by user unless they are in that logged in screen already. |
| 6   | **Save/Add address**                   | checkout, account-addresses               | **Yes**                   | address saved                            | replay, resume checkout, toaster                | —                                    | same as the above point.                                                                                                                                                                                           |
| 7   | **Clip/save coupon to account**        | promotions, PDP, cart                     | **Yes** (account-bound)   | coupon saved                             | replay clip, toaster, return                    | expired → error                      |                                                                                                                                                                                                                    |
| 8   | **Follow brand/category / price-drop** | category, PDP                             | **Yes**                   | following, toaster                       | replay follow, return                           | —                                    |                                                                                                                                                                                                                    |
| 9   | **Proceed to checkout**                | cart                                      | **Depends** ⚠️            | → checkout                               | if login chosen: merge cart → checkout          | **guest-checkout decision PENDING**  |                                                                                                                                                                                                                    |
| 10  | Add to cart                            | any product surface                       | **No** (guest cart)       | added, badge updates                     | n/a — guest allowed                             | OOS → disabled                       |                                                                                                                                                                                                                    |
| 11  | Submit product Q&A                     | PDP                                       | **No** (guest name+email) | question pending                         | n/a — guest allowed                             | —                                    |                                                                                                                                                                                                                    |
| 12  | Track order                            | footer/track page                         | **No** (order id + email) | tracking shown                           | n/a                                             | —                                    |                                                                                                                                                                                                                    |

⚠️ **Open decision (row 9):** allow guest checkout, or force login/registration at checkout? Affects checkout + auth API design.

## Admin (no guest; analog = resume-after-auth)

| #   | Case                       | Trigger                              | Behavior                                                                          | My Comments |
| --- | -------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- | ----------- |
| A1  | Deep-link while logged out | admin opens a gated URL              | after login → land on **that** URL, not dashboard                                 | yes         |
| A2  | Session expiry mid-action  | token expires during a form/submit   | re-auth modal, **preserve in-progress form/draft**, resume submit, stay on screen | yes         |
| A3  | RBAC-insufficient          | user lacks permission                | **blocked** (403 + message) — NOT queued/replayed                                 | yes         |
| A4  | Unsaved-draft protection   | navigating away with unsaved changes | warn; drafts (e.g. purchase invoice) autosaved → resumable                        | yes         |

---

## Open items to resolve before locking

- Row 9: guest checkout vs forced login.
- Whether Wishlist and Save-for-Later are separate collections/lists or one with a flag.
- Pending-intent TTL and storage (client-only vs short-lived server token).
- Owner to add/remove rows, then fold into `owner-decisions-log.md`.
