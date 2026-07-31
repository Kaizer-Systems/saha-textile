import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
	ActiveLocaleConfig,
	ApiError,
	ApiErrorResponse,
	DEFAULT_PAGE_SIZE,
	LocaleCode,
	MAX_PAGE_SIZE,
	Money,
	PRIMARY_LOCALE,
	PageQuery,
	paginated,
} from '../src/index';

describe('LocaleCode', () => {
	it('accepts BCP-47 primary subtags with an optional region', () => {
		for (const code of ['en', 'fr', 'bn', 'hi', 'en-IN', 'fr-CA']) {
			expect(LocaleCode.safeParse(code).success).toBe(true);
		}
	});

	it('rejects malformed codes', () => {
		for (const code of ['EN', 'english', 'e', 'en_IN', 'en-in', '']) {
			expect(LocaleCode.safeParse(code).success).toBe(false);
		}
	});
});

describe('ActiveLocaleConfig', () => {
	it('defaults to the locked primary locale', () => {
		const config = ActiveLocaleConfig.parse({ active: ['en', 'fr'] });
		expect(config.default).toBe(PRIMARY_LOCALE);
		expect(config.active).toEqual(['en', 'fr']);
	});

	it('accepts any configured active set — locales are config, not a contract enum', () => {
		expect(ActiveLocaleConfig.safeParse({ default: 'fr', active: ['en', 'fr'] }).success).toBe(true);
		expect(ActiveLocaleConfig.safeParse({ active: ['en', 'bn', 'fr-CA'] }).success).toBe(true);
	});

	it('rejects a default that is not active', () => {
		expect(ActiveLocaleConfig.safeParse({ default: 'de', active: ['en', 'fr'] }).success).toBe(false);
	});

	it('rejects dropping the primary locale (I18nString requires `en`)', () => {
		expect(ActiveLocaleConfig.safeParse({ default: 'fr', active: ['fr'] }).success).toBe(false);
	});

	it('rejects an empty active set', () => {
		expect(ActiveLocaleConfig.safeParse({ active: [] }).success).toBe(false);
	});
});

describe('Money', () => {
	it('parses a derived display amount', () => {
		expect(Money.parse({ currency: 'USD', amount: 12.5 })).toEqual({ currency: 'USD', amount: 12.5 });
	});

	it('rejects a non-ISO-4217 currency code', () => {
		expect(Money.safeParse({ currency: 'usd', amount: 1 }).success).toBe(false);
		expect(Money.safeParse({ currency: 'RUPEE', amount: 1 }).success).toBe(false);
	});

	it('rejects a non-finite amount', () => {
		expect(Money.safeParse({ currency: 'INR', amount: Number.POSITIVE_INFINITY }).success).toBe(false);
	});
});

describe('PageQuery', () => {
	it('applies transport defaults', () => {
		expect(PageQuery.parse({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
	});

	it('rejects a non-positive page and an over-cap page size', () => {
		expect(PageQuery.safeParse({ page: 0 }).success).toBe(false);
		expect(PageQuery.safeParse({ pageSize: 0 }).success).toBe(false);
		expect(PageQuery.safeParse({ pageSize: MAX_PAGE_SIZE + 1 }).success).toBe(false);
		expect(PageQuery.safeParse({ pageSize: MAX_PAGE_SIZE }).success).toBe(true);
	});

	it('rejects a fractional page', () => {
		expect(PageQuery.safeParse({ page: 1.5 }).success).toBe(false);
	});
});

describe('paginated()', () => {
	const PageOfNames = paginated(z.string());

	it('wraps items in the standard envelope', () => {
		const page = PageOfNames.parse({
			items: ['saree', 'salwaar'],
			meta: { page: 1, pageSize: 24, total: 2, totalPages: 1, hasNext: false, hasPrev: false },
		});
		expect(page.items).toHaveLength(2);
		expect(page.meta.total).toBe(2);
	});

	it('rejects items of the wrong type and a malformed meta block', () => {
		expect(
			PageOfNames.safeParse({
				items: [1],
				meta: { page: 1, pageSize: 24, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
			}).success,
		).toBe(false);
		expect(PageOfNames.safeParse({ items: [], meta: { page: 1, pageSize: 24 } }).success).toBe(false);
	});
});

describe('ApiError', () => {
	it('applies safe defaults', () => {
		const error = ApiError.parse({ code: 'not_found', message: 'Product not found' });
		expect(error.issues).toEqual([]);
		expect(error.requestId).toBeNull();
	});

	it('carries flattened field issues for validation failures', () => {
		const response = ApiErrorResponse.parse({
			error: {
				code: 'validation_failed',
				message: 'Request validation failed',
				issues: [{ path: ['variations', 0, 'priceINR'], message: 'must be non-negative' }],
				requestId: 'req_01HTEST',
			},
		});
		expect(response.error.issues[0]?.path).toEqual(['variations', 0, 'priceINR']);
	});

	it('rejects an unknown error code and an empty message', () => {
		expect(ApiError.safeParse({ code: 'teapot', message: 'x' }).success).toBe(false);
		expect(ApiError.safeParse({ code: 'internal', message: '' }).success).toBe(false);
	});
});
