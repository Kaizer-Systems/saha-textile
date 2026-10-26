import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthStore } from '@core/state/auth.store';
import { AuthService } from '@data-access/services/auth.service';

import { Login } from './login';

/**
 * The hand-over from a Google press that found an existing account.
 *
 * What matters is that the card ends up OFFERING a code to the proven address — code mode, the
 * address filled in, nothing sent until the person presses Send — and that a reload does not replay
 * the offer. The real template (select2, Google's button) is stood in for, as in the register spec.
 */
function harness() {
	const requestLoginOtp = vi.fn().mockResolvedValue(true);
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [Login],
		providers: [
			{ provide: AuthStore, useValue: { error: () => null, pending: () => false, requestLoginOtp } },
			{ provide: Router, useValue: { navigateByUrl: vi.fn() } },
			{ provide: AuthService, useValue: {} },
			{ provide: TranslocoService, useValue: { selectTranslate: () => of('') } },
		],
	});
	TestBed.overrideComponent(Login, { set: { template: '<div></div>' } });
	const fixture = TestBed.createComponent(Login);
	fixture.detectChanges();
	return { component: fixture.componentInstance, requestLoginOtp };
}

afterEach(() => history.replaceState(null, ''));

describe('a Google press that found an existing account', () => {
	it('switches to a one-time code for that address, and sends nothing yet', () => {
		const { component, requestLoginOtp } = harness();

		component.useCodeFor('ada@example.test');

		expect(component.method()).toBe('code');
		expect(component.channel()).toBe('email');
		expect(component.form.value.email).toBe('ada@example.test');
		expect(component.existingAccountNotice()).toBe(true);
		expect(component.codeSent()).toBe(false);
		expect(requestLoginOtp).not.toHaveBeenCalled();
	});

	it('takes the address from navigation state when arriving from the registration screen', () => {
		history.replaceState({ existingAccountEmail: 'ada@example.test' }, '');

		const { component } = harness();

		expect(component.method()).toBe('code');
		expect(component.form.value.email).toBe('ada@example.test');
	});

	/** history.state survives a reload; the offer must not be replayed from it. */
	it('consumes the hand-over, so a reload does not replay it', () => {
		history.replaceState({ existingAccountEmail: 'ada@example.test' }, '');
		harness();

		expect((history.state as { existingAccountEmail?: unknown }).existingAccountEmail).toBeUndefined();
	});

	it('drops the notice when the person moves to another way in', () => {
		const { component } = harness();
		component.useCodeFor('ada@example.test');

		component.selectMethod('password');

		expect(component.existingAccountNotice()).toBe(false);
	});
});
