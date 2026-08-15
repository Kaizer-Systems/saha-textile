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
