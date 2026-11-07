// @vitest-environment node
import { Injector, runInInjectionContext } from '@angular/core';

import { describe, expect, it } from 'vitest';

import { ACTIVE_LOCALE } from './active-locale';

describe('ACTIVE_LOCALE without a window or a request', () => {
	it('uses the default language', () => {
		const provider = (ACTIVE_LOCALE as unknown as { ɵprov: { factory: () => string } }).ɵprov;
		const value = runInInjectionContext(Injector.create({ providers: [] }), () => provider.factory());
		expect(value).toBe('en');
	});
});
