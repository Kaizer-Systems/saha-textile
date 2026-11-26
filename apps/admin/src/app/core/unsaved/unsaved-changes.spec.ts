import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UnsavedChanges } from './unsaved-changes';

/**
 * Reload or close with unsaved form work, locked or not: the browser asks first (owner, 2026-11-20).
 * Angular marks an edited form `ng-dirty`; these tests set the same classes by hand.
 */
const form = (html: string) => {
	const host = document.createElement('div');
	host.innerHTML = html;
	document.body.appendChild(host);
	return host;
};
const type = (el: Element | null) => el?.dispatchEvent(new Event('input', { bubbles: true }));
const leave = (service: UnsavedChanges) => {
	const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
	window.dispatchEvent(event);
	return { asked: event.defaultPrevented, unsaved: service.hasUnsaved() };
};

describe('UnsavedChanges', () => {
	let service: UnsavedChanges;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
		service = new UnsavedChanges();
		service.start(document);
	});
	afterEach(() => {
		document.body.innerHTML = '';
		vi.useRealTimers();
	});

	it('asks before leaving a form typed into and not saved', () => {
		const host = form('<form class="ng-dirty"><input class="ng-dirty" id="title"></form>');
		type(host.querySelector('#title'));
		expect(leave(service)).toEqual({ asked: true, unsaved: true });
	});

	it('does not ask for an untouched form', () => {
		form('<form class="ng-pristine"><input class="ng-pristine"></form>');
		expect(leave(service)).toEqual({ asked: false, unsaved: false });
	});

	it('stops asking once a save came back fine, and asks again after a later edit', () => {
		const host = form('<form class="ng-dirty"><input class="ng-dirty" id="title"></form>');
		type(host.querySelector('#title'));
		vi.advanceTimersByTime(1000);
		service.markSaved();
		expect(leave(service).unsaved).toBe(false);
		vi.advanceTimersByTime(1000);
		type(host.querySelector('#title'));
		expect(leave(service).unsaved).toBe(true);
	});

	it('treats an edit made while a save was in flight as unsaved', () => {
		const host = form('<form class="ng-dirty"><input class="ng-dirty" id="title"></form>');
		const sentAt = Date.now();
		vi.advanceTimersByTime(500);
		type(host.querySelector('#title'));
		service.markSaved(sentAt);
		expect(leave(service).unsaved).toBe(true);
	});

	it('never counts search boxes, filters marked off, or the lock screen', () => {
		const host = form(`
			<form class="ng-dirty"><input type="search" class="ng-dirty" id="q"></form>
			<form class="ng-dirty"><div class="table-search"><input class="ng-dirty" id="filter"></div></form>
			<form class="ng-dirty" data-unsaved="off"><input type="password" class="ng-dirty" id="pw"></form>`);
		for (const id of ['#q', '#filter', '#pw']) type(host.querySelector(id));
		expect(leave(service).unsaved).toBe(false);
	});

	it('asks for unsaved work a screen registers (not a form), until it is unregistered', () => {
		let dirty = true;
		const remove = service.register(() => dirty);
		expect(leave(service).unsaved).toBe(true);
		dirty = false;
		expect(leave(service).unsaved).toBe(false);
		dirty = true;
		remove();
		expect(leave(service).unsaved).toBe(false);
	});

	it('survives a registered check that throws', () => {
		service.register(() => {
			throw new Error('gone');
		});
		expect(leave(service).unsaved).toBe(false);
	});

	it('starts once', () => {
		const add = vi.spyOn(window, 'addEventListener');
		service.start(document);
		expect(add).not.toHaveBeenCalled();
		add.mockRestore();
	});
});
