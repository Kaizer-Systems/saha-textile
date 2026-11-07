import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import UnknownAddress from './[...not-found].page';

const status = vi.hoisted(() => ({ value: undefined as undefined | { status: number } }));
vi.mock('@core/i18n/legacy-address', () => ({ storefrontAddress: () => status.value }));

const render = (doc: unknown) => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(UnknownAddress, {
		set: { imports: [], template: '', providers: [{ provide: DOCUMENT, useValue: doc }] },
	});
	return TestBed.createComponent(UnknownAddress).componentInstance;
};
const browser = { defaultView: { location: { pathname: '/old', search: '?x=1' } } };

describe('UnknownAddress', () => {
	it('shows the gone page for a retired address', () => {
		status.value = { status: 410 };
		expect(render(browser).retired).toBe(true);
	});

	it('shows the 404 page otherwise', () => {
		status.value = undefined;
		expect(render(browser).retired).toBe(false);
	});

	it('reads the server document, with or without a location', () => {
		status.value = undefined;
		expect(render({ defaultView: null, location: { pathname: '/old' } }).retired).toBe(false);
		expect(render({ defaultView: null }).retired).toBe(false);
	});
});
