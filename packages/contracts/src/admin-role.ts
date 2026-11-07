import { z } from 'zod';

/**
 * Coarse operator role (`DEC-ACCOUNT-SEPARATION` D2 / D7).
 *
 * Customers have no role. Fine-grained permissions remain authoritative; this tier
 * only decides which audience an operator session may serve and caps role assignments.
 *
 * Kept in its own module so session/auth contracts can import it without a cycle through
 * `admin-auth.ts` (which imports `Password` from `auth.ts`).
 */
export const AdminRole = z.enum(['staff', 'admin']);
export type AdminRole = z.infer<typeof AdminRole>;

/**
 * Operator primary key (`DEC-ACCOUNT-SEPARATION` D5).
 *
 * Prefix makes a cross-population id substitution fail on sight.
 */
export const AdminUserId = z.string().min(1).regex(/^adm_/, 'must start with adm_');
export type AdminUserId = z.infer<typeof AdminUserId>;

/**
 * Operator account lifecycle status.
 *
 * Four states, not the customer's five: there is no `deleted`. Offboarding an operator is
 * `disabled` — the row survives so the audit trail keeps its subject, and the email stays
 * claimed rather than becoming re-registerable by somebody else. That is the same reason the
 * permission registry carries no `admin_user.destroy`.
 *
 * Split from the customer enum on 2026-08-15. One shared `UserStatus` had spelled the
 * difference as `UserStatus.exclude(['deleted'])` at each admin call site, which meant the
 * exclusion was a thing every author had to remember rather than a thing the type knew.
 * Non-`active` accounts cannot receive new sessions, for either population.
 */
export const AdminUserStatus = z.enum(['active', 'pending', 'disabled', 'locked']);
export type AdminUserStatus = z.infer<typeof AdminUserStatus>;
