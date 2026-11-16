import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FM_PHONE_QUERY, FmPhone } from './fm-phone';

/** A stand-in for the browser's media query list: `turn` plays the screen turning or the window resizing. */
function screenQuery(matches: boolean) {
	let listener: ((event: { matches: boolean }) => void) | null = null;
	const query = {
		matches,
		addEventListener: (_type: string, next: (event: { matches: boolean }) => void) => (listener = next),
	};
	return { query, turn: (now: boolean) => listener?.({ matches: now }) };
}

describe('FmPhone (G01–G04)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const phone = (platform = 'browser') => {
		TestBed.resetTestingModule();
		TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
		return TestBed.inject(FmPhone);
	};

	it('follows the phone width as the screen turns or the window is resized', () => {
		const screen = screenQuery(true);
		const ask = vi.fn(() => screen.query);
		vi.stubGlobal('matchMedia', ask);
		const view = phone();
		expect(ask).toHaveBeenCalledWith(FM_PHONE_QUERY);
		expect(view.is()).toBe(true);
		screen.turn(false);
		expect(view.is()).toBe(false);
		screen.turn(true);
		expect(view.is()).toBe(true);
	});

	it('is off on the server, where there is no screen', () => {
		const ask = vi.fn(() => screenQuery(true).query);
		vi.stubGlobal('matchMedia', ask);
		expect(phone('server').is()).toBe(false);
		expect(ask).not.toHaveBeenCalled();
	});
});
