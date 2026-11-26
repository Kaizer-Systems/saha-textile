import { TestBed } from '@angular/core/testing';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsoleSession } from './session';

afterEach(() => {
	vi.restoreAllMocks();
	sessionStorage.clear();
});

describe('where a locked tab returns', () => {
	it('opens the kept place once after unlocking, and the start page otherwise', () => {
		const session = TestBed.inject(ConsoleSession);
		expect(session.take()).toBe('/');
		session.keep('/p/id-1/r/id-1/code?tab=files&path=AGENTS.md');
		expect(session.take()).toBe('/p/id-1/r/id-1/code?tab=files&path=AGENTS.md');
		expect(session.take()).toBe('/');
	});

	it('never returns to the lock screen or to anything but one of its own addresses', () => {
		const session = TestBed.inject(ConsoleSession);
		session.keep('/lock');
		expect(session.take()).toBe('/');
		session.keep('https://example.com/');
		expect(session.take()).toBe('/');
	});

	it('opens the start page when the browser blocks storage', () => {
		const session = TestBed.inject(ConsoleSession);
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(() => session.keep('/p/id-1/overview')).not.toThrow();
		expect(session.take()).toBe('/');
	});
});
