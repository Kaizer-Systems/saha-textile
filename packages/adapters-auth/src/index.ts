/**
 * OAuth provider verification adapters.
 *
 * The edge of the hexagon: everything provider-specific — Google's JWKS handling, Meta's Graph
 * endpoints, their field names and their failure modes — stops here. Core sees only
 * `OAuthVerifierPort` and the settled `VerifiedOAuthIdentity` it returns.
 *
 * Storefront only. There is no admin equivalent and there must never be one: a compromised
 * social account must not open the back office.
 */
export { GoogleIdTokenVerifier } from './google-id-token.verifier.js';
export { FacebookTokenVerifier } from './facebook-token.verifier.js';
