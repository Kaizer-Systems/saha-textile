import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { VersionBanner, clock } from './version-banner';
import { VersionWatch } from '../data/version-watch';

function bannerOf(newer: string | null, typed = false, hidden = false) {
	TestBed.resetTestingModule();
	const watch = {
		newer: signal(newer),
		hidden: signal(hidden),
		loadedAt: new Date(2026, 10, 24, 15, 44).toISOString(),
		typedNotSent: vi.fn(() => typed),
		reload: vi.fn(),
	};
	TestBed.configureTestingModule({ providers: [{ provide: VersionWatch, useValue: watch }] });
	const fixture = TestBed.createComponent(VersionBanner);
	fixture.detectChanges();
	const el = fixture.nativeElement as HTMLElement;
	const buttons = () => [...el.querySelectorAll('button')];
	return { el, watch, fixture, buttons };
}

describe('the newer-version banner', () => {
	it('shows nothing while this tab runs the newest console, or after Not yet', () => {
		expect(bannerOf(null).el.textContent?.trim()).toBe('');
		expect(bannerOf(new Date(2026, 10, 24, 15, 46).toISOString(), false, true).el.textContent?.trim()).toBe('');
	});

	it('says when the newer console started and reloads on Reload', () => {
		const { el, watch, buttons } = bannerOf(new Date(2026, 10, 24, 15, 46).toISOString());
		expect([...(el.querySelector('.rc-banner')?.classList ?? [])].sort()).toEqual(['cy', 'rc-banner', 'small']);
		expect(el.textContent?.replace(/\s+/g, ' ')).toContain(
			'A newer Release Console is running. It started at 15:46; this tab is still the one from 15:44.',
		);
		expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Reload']);
		buttons()[0]?.click();
		expect(watch.reload).toHaveBeenCalled();
	});

	it('turns amber while something typed is not sent, with Not yet and Reload and lose it', () => {
		const { el, watch, buttons, fixture } = bannerOf(new Date(2026, 10, 24, 15, 46).toISOString(), true);
		expect([...(el.querySelector('.rc-banner')?.classList ?? [])].sort()).toEqual(['amber', 'rc-banner', 'small']);
		expect(el.textContent).toContain('isn’t sent yet');
		expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Not yet', 'Reload and lose it']);
		buttons()[1]?.click();
		expect(watch.reload).toHaveBeenCalled();
		buttons()[0]?.click();
		fixture.detectChanges();
		expect(watch.hidden()).toBe(true);
		expect(el.querySelector('.rc-banner')).toBeNull();
	});

	it('says a time of day as hours and minutes', () => {
		expect(clock(new Date(2026, 10, 24, 9, 5).toISOString())).toBe('09:05');
	});
});
