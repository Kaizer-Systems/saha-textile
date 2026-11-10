import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { Contact } from './contact';
import { BasicFooter } from '../../basic-footer/basic-footer';

const brand = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('@data-access/queries/brand.queries', () => ({
	injectBrandQuery: () => ({ data: () => brand.data }),
}));

const make = <T>(type: new () => T) => {
	TestBed.resetTestingModule();
	TestBed.overrideComponent(type, { set: { imports: [], template: '' } });
	return TestBed.createComponent(type).componentInstance;
};

describe('footer app badges', () => {
	it('come from the Brand Kit, and are empty until it has app links', () => {
		brand.data = undefined;
		expect(make(Contact).apps()).toEqual({ android: '', ios: '' });
		const android = 'https://play.google.com/store/apps/details?id=com.shop.app';
		brand.data = { apps: { android, ios: '' } };
		expect(make(Contact).apps()).toEqual({ android, ios: '' });
		expect(make(BasicFooter).apps()).toEqual({ android, ios: '' });
	});
});
