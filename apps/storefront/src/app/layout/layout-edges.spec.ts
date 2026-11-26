import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { describe, expect, it, vi } from 'vitest';

import { ThemeModeStore } from '@core/brand/theme-mode';

import { BasicFooter } from './footer/basic-footer/basic-footer';
import { FooterLogo } from './footer/widgets/logo/logo';
import { Logo } from './header/widgets/logo/logo';
import { Mode } from './header/widgets/mode/mode';
import { Search } from './header/widgets/search/search';

const brand = signal<unknown>(undefined);
vi.mock('@data-access/queries/brand.queries', async (original) => ({
	...(await original<object>()),
	injectBrandQuery: () => ({ data: brand }),
}));

const dark = signal(false);
const themeMode = {
	dark,
	pick: <T>(light: T | null | undefined, darkOne: T | null | undefined) => (dark() && darkOne) || light || null,
};

const make = <T>(type: new (...args: never[]) => T, template = '', providers: unknown[] = []) => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		providers: [{ provide: ThemeModeStore, useValue: themeMode }, ...(providers as never[])],
	});
	TestBed.overrideComponent(type as never, { set: { imports: [], template } });
	const fixture = TestBed.createComponent(
		type as never,
	) as unknown as import('@angular/core/testing').ComponentFixture<T>;
	fixture.detectChanges();
	return fixture;
};

describe('logos', () => {
	it('the footer shows the dark logo without its white plate in dark mode, and the light one otherwise', () => {
		brand.set({ logo: 'light.png', logoDark: 'dark.png' });
		const footer = make(FooterLogo).componentInstance;
		expect(footer.logo()).toBe('light.png');
		expect(footer.darkLogo()).toBe(false);
		dark.set(true);
		expect(footer.logo()).toBe('dark.png');
		expect(footer.darkLogo()).toBe(true);
		brand.set({ logo: 'light.png' });
		expect(footer.darkLogo()).toBe(false);
		dark.set(false);
	});

	it('the header picks the logo and the seal for the mode', () => {
		brand.set({ logo: 'l.png', logoDark: 'ld.png', seal: 's.png', sealDark: 'sd.png' });
		const header = make(Logo).componentInstance;
		expect([header.logo(), header.seal()]).toEqual(['l.png', 's.png']);
		brand.set(undefined);
		expect([header.logo(), header.seal()]).toEqual([null, null]);
	});
});

describe('the mode switch', () => {
	it('sits in the top bar by default', () => {
		expect(make(Mode).componentInstance.onTopBar()).toBe(true);
	});
});

describe('the header search', () => {
	it('opens ready to type, and searches for what is typed, or nothing', async () => {
		const navigate = vi.fn();
		const fixture = make(Search, '<input #field />', [{ provide: Router, useValue: { navigate } }]);
		const search = fixture.componentInstance;
		search.toggleSearchBox();
		fixture.detectChanges();
		TestBed.tick();
		expect(document.activeElement).toBe(fixture.nativeElement.querySelector('input'));
		search.toggleSearchBox();
		search.term.setValue(null);
		search.redirectToSearch();
		expect(navigate).toHaveBeenLastCalledWith(['/search'], { queryParams: { search: null } });
	});
});

describe('the footer', () => {
	it('shows no app badges until the Brand Kit names its app pages', () => {
		brand.set(undefined);
		expect(make(BasicFooter).componentInstance.apps()).toEqual({ android: '', ios: '' });
	});
});
