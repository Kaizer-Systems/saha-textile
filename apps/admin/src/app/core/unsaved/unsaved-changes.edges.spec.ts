import { afterEach, describe, expect, it } from 'vitest';

import { UnsavedChanges } from './unsaved-changes';

/** A page the service can start on, with the address and forms the test gives it. */
function page(pathname: string | null, forms: Element[] = []): Document {
	return {
		location: pathname === null ? null : { pathname },
		addEventListener: () => undefined,
		querySelectorAll: () => forms,
	} as unknown as Document;
}

describe('UnsavedChanges edges', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('notes typing only inside a form, and a dirty form nobody typed into is not unsaved', () => {
		const service = new UnsavedChanges();
		service.start(document);
		document.body.innerHTML = '<input id="loose"><form class="ng-dirty"><input class="ng-dirty"></form>';
		document.getElementById('loose')?.dispatchEvent(new Event('input', { bubbles: true }));
		document.dispatchEvent(new Event('change'));
		expect(service.hasUnsaved()).toBe(false);
	});

	it('counts a typed-into form that only marked itself dirty (a custom control)', () => {
		const service = new UnsavedChanges();
		service.start(document);
		document.body.innerHTML = '<form class="ng-dirty"><div id="picker"></div></form>';
		document.getElementById('picker')?.dispatchEvent(new Event('input', { bubbles: true }));
		expect(service.hasUnsaved()).toBe(true);
	});

	it('never counts the sign-in pages, and reads a page with no address', () => {
		const form = document.createElement('form');
		const signIn = new UnsavedChanges();
		signIn.start(page('/auth/login', [form]));
		signIn.register(() => false);
		expect(signIn.hasUnsaved()).toBe(false);
		const blank = new UnsavedChanges();
		blank.start(page(null, []));
		expect(blank.hasUnsaved()).toBe(false);
	});
});
