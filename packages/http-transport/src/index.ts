/**
 * `@saha-textile/http-transport` — the shared browser transport primitive.
 *
 * Owns the parts of talking to the API that are IDENTICAL for storefront and admin: the
 * double-submit CSRF contract, refresh single-flight, base-URL resolution, request
 * correlation, and safe error mapping. It owns no business policy — no route paths, no
 * audience, no login method, no store — because those differ per app and a shared module
 * that knew them would become the god service the architecture contract forbids
 * (auth matrix §2.2).
 *
 * Framework-free and dependency-free by construction:
 *   - no Angular, RxJS, NestJS or DOM lib; ambient browser objects are reached through
 *     narrow `globalThis` declarations, so every export is unit-testable in Node and safe
 *     to evaluate under SSR;
 *   - no runtime dependency on `@saha-textile/contracts`, so consuming this package cannot
 *     pull Zod into a browser bundle. `test/contract-alignment.test.ts` keeps the duplicated
 *     error shape assignable to the contract in both directions, and
 *     `test/runtime-purity.test.ts` proves the compiled output imports nothing at all.
 */
export {
	CSRF_COOKIE_NAMES,
	CSRF_HEADER_NAME,
	hasBrowserCookieJar,
	isUnsafeMethod,
	readCsrfToken,
	readCsrfTokenFrom,
} from './csrf.js';
export { withBrowserLock } from './browser-lock.js';
export type { LockManagerLike } from './browser-lock.js';
export { isRelativeApiPath, joinApiUrl } from './api-url.js';
export { REQUEST_ID_HEADER, readRequestId } from './request-id.js';
export { RefreshCoordinator } from './refresh-coordinator.js';
export type { RefreshCoordinatorOptions, RefreshOperation } from './refresh-coordinator.js';
export {
	isApiErrorEnvelope,
	isForbidden,
	isRetryable,
	isUnauthorized,
	isUnrecoverableRefusal,
	readRefusalReason,
	toTransportFailure,
} from './errors.js';
export type {
	ApiErrorBody,
	ApiErrorCode,
	ApiErrorEnvelope,
	ApiFieldIssue,
	AuthRefusalReason,
	TransportFailure,
} from './errors.js';
