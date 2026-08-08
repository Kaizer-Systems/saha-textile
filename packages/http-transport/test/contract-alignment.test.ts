import type {
	ApiError,
	ApiErrorCode as ContractApiErrorCode,
	ApiErrorResponse,
	AuthRefusalReason as ContractAuthRefusalReason,
	FieldIssue,
} from '@saha-textile/contracts';
import { describe, expect, it } from 'vitest';

import { isApiErrorEnvelope, readRefusalReason } from '../src/errors.js';
import type { ApiErrorBody, ApiErrorCode, ApiErrorEnvelope, ApiFieldIssue, AuthRefusalReason } from '../src/errors.js';

/**
 * Drift guard for the deliberately duplicated error shape.
 *
 * `@saha-textile/contracts` owns the API's error envelope, but it is a Zod package: a RUNTIME
 * dependency on it here would pull Zod into both browser bundles as a side effect of using
 * this transport primitive — which is exactly the bundle-size question the contracts-adoption
 * pass is supposed to answer deliberately, not have decided for it. So the shape is declared
 * structurally in `src/errors.ts` and this file imports the contract TYPES ONLY (erased at
 * compile time, proven by `runtime-purity.test.ts`) to assert the two stay interchangeable.
 *
 * The assertions are bidirectional on purpose. One direction alone would let this package's
 * copy silently narrow or widen relative to the contract and still compile.
 */

/** Fails to compile if `Actual` is not assignable to `Expected`. */
function assignable<Expected>(_value: Expected): void {
	/* compile-time only */
}

describe('error shapes stay aligned with @saha-textile/contracts', () => {
	it('ApiErrorEnvelope and ApiErrorResponse are mutually assignable', () => {
		const fromContract = null as unknown as ApiErrorResponse;
		const fromTransport = null as unknown as ApiErrorEnvelope;

		assignable<ApiErrorEnvelope>(fromContract);
		assignable<ApiErrorResponse>(fromTransport);

		expect(true).toBe(true);
	});

	it('ApiErrorBody and ApiError are mutually assignable', () => {
		const fromContract = null as unknown as ApiError;
		const fromTransport = null as unknown as ApiErrorBody;

		assignable<ApiErrorBody>(fromContract);
		assignable<ApiError>(fromTransport);

		expect(true).toBe(true);
	});

	it('ApiFieldIssue and FieldIssue are mutually assignable', () => {
		const fromContract = null as unknown as FieldIssue;
		const fromTransport = null as unknown as ApiFieldIssue;

		assignable<ApiFieldIssue>(fromContract);
		assignable<FieldIssue>(fromTransport);

		expect(true).toBe(true);
	});

	it('the code unions are identical in both directions', () => {
		const fromContract = null as unknown as ContractApiErrorCode;
		const fromTransport = null as unknown as ApiErrorCode;

		assignable<ApiErrorCode>(fromContract);
		assignable<ContractApiErrorCode>(fromTransport);

		expect(true).toBe(true);
	});

	// The runtime guard must accept every code the contract can produce. Enumerated as a
	// Record keyed by the contract union rather than an array, so a code added to the
	// contract and forgotten here fails to COMPILE instead of silently going unchecked.
	it('the runtime guard accepts every code in the contract union', () => {
		const everyCode: Record<ContractApiErrorCode, true> = {
			bad_request: true,
			validation_failed: true,
			unauthorized: true,
			forbidden: true,
			not_found: true,
			conflict: true,
			rate_limited: true,
			payload_too_large: true,
			unsupported_media_type: true,
			internal: true,
		};

		for (const code of Object.keys(everyCode)) {
			expect(isApiErrorEnvelope({ error: { code, message: 'x' } })).toBe(true);
		}
	});

	it('the refusal-reason unions are identical in both directions', () => {
		const fromContract = null as unknown as ContractAuthRefusalReason;
		const fromTransport = null as unknown as AuthRefusalReason;

		assignable<AuthRefusalReason>(fromContract);
		assignable<ContractAuthRefusalReason>(fromTransport);

		expect(true).toBe(true);
	});

	// Same Record-keyed trick as the codes above: a reason added to the contract and forgotten
	// here fails to COMPILE, rather than silently becoming a value this client drops on the
	// floor as "unrecognised" — which would look like the server declining to say why.
	it('the reader recognises every reason in the contract union', () => {
		const everyReason: Record<ContractAuthRefusalReason, true> = {
			session_missing: true,
			session_expired: true,
			session_revoked: true,
			permissions_changed: true,
			account_inactive: true,
		};

		for (const reason of Object.keys(everyReason)) {
			expect(readRefusalReason({ error: { code: 'unauthorized', message: 'x', reason } })).toBe(reason);
		}
	});
});
