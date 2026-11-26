import { TestBed } from '@angular/core/testing';

import { REQUEST } from '@analogjs/router/tokens';
import { describe, expect, it } from 'vitest';

import { ACTIVE_LOCALE } from './active-locale';

const read = (request?: unknown) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: request ? [{ provide: REQUEST, useValue: request }] : [] });
	return TestBed.inject(ACTIVE_LOCALE);
};

describe('ACTIVE_LOCALE', () => {
	it('reads the original address on the server', () => {
		expect(read({ originalUrl: '/bn/cart', url: '/cart' })).toBe('bn');
	});

	it('falls back to the plain address, then to the root', () => {
		expect(read({ url: '/bn/cart' })).toBe('bn');
		expect(read({})).toBe('en');
	});

	it('reads the browser address', () => {
		expect(read()).toBe('en');
	});
});
