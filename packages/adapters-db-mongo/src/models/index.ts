/**
 * Every Mongoose schema, in one place.
 *
 * ## Enums are DERIVED, never re-listed
 *
 * A schema's `enum` comes from the contract (or core-domain) value that already names the
 * vocabulary — `SignupOrigin.options`, `CatalogStatus.options`, `IDENTITY_SUBJECT_TYPES` — and
 * never from a copy of it typed out beside it.
 *
 * This is not tidiness. `otpChallenges.purpose` was a hand-copied list, and adding
 * `change_contact` to the contract left it behind: the contract, the service and every unit test
 * agreed the value was legitimate, and Mongo rejected it, so every contact-change send answered
 * 500. Nothing in the type system or the suite could see it, because a string literal in a schema
 * agrees with nothing. Roughly thirty more lists were sitting in the same position; they are
 * derived now.
 *
 * Where a schema's vocabulary genuinely DIFFERS from the contract's, it is spelled as the
 * contract's values plus the difference — see `roleAtLogin` in `auth-session.model.ts` — so the
 * shared half still cannot drift and the extra half is visible as a deliberate choice.
 *
 * ## Importing this file creates every collection
 *
 * Pulling in this barrel registers all of them, so a script that imports it against a
 * non-default `MONGODB_DB_NAME` will create that database on connect.
 */

export * from './category.model';
export * from './product.model';
export * from './currency.model';
export * from './promotion.model';
export * from './cart.model';
export * from './order.model';
export * from './customer.model';
export * from './admin-user.model';
export * from './credential.model';
export * from './auth-session.model';
export * from './auth-challenge.model';
export * from './auth-token.model';
export * from './auth-rate-limit.model';
export * from './rbac.model';
export * from './consent.model';
export * from './catalog-structure.model';
export * from './product-variant.model';
export * from './merchandising.model';
export * from './media.model';
export * from './inventory.model';
export * from './governance.model';
export * from './content.model';
export * from './pending-signup.model';
export * from './pending-contact-change.model';
