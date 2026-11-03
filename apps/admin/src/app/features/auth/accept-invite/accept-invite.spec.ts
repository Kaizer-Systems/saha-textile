import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TranslocoTestingModule } from '@jsverse/transloco';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAuthGateway, type AdminInviteAcceptInput } from '@core/auth/auth-gateway';
import { NotificationService } from '@data-access/services/notification.service';

import { AcceptInvite } from './accept-invite';

/**
 * The class logic of the accept-invitation screen: what it sends, and when it refuses to send.
 * The template is blanked so the test does not depend on the keypad or toast plumbing.
 */
describe('AcceptInvite', () => {
	let acceptInvite: ReturnType<typeof vi.fn<(input: AdminInviteAcceptInput) => Observable<void>>>;
	let navigateByUrl: ReturnType<typeof vi.fn>;
	let showSuccess: ReturnType<typeof vi.fn>;

	function create(token: string | null): AcceptInvite {
		TestBed.configureTestingModule({
			imports: [AcceptInvite, TranslocoTestingModule.forRoot({ langs: { en: {} } })],
			providers: [
				{ provide: AdminAuthGateway, useValue: { acceptInvite } },
				{ provide: NotificationService, useValue: { showSuccess } },
				{ provide: Router, useValue: { navigateByUrl } },
				{
					provide: ActivatedRoute,
					useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
				},
			],
		}).overrideComponent(AcceptInvite, { set: { template: '' } });
		return TestBed.createComponent(AcceptInvite).componentInstance;
	}

	function fillPasswords(component: AcceptInvite): void {
		component.form.setValue({
			displayName: '  Rina  ',
			newPassword: 'correct-horse-battery',
			confirmPassword: 'correct-horse-battery',
		});
	}

	beforeEach(() => {
		acceptInvite = vi.fn<(input: AdminInviteAcceptInput) => Observable<void>>(() => of(undefined));
		navigateByUrl = vi.fn(() => Promise.resolve(true));
		showSuccess = vi.fn();
	});

	it('sends nothing without a token in the link', async () => {
		const component = create(null);
		fillPasswords(component);

		await component.submit();

		expect(acceptInvite).not.toHaveBeenCalled();
	});

	it('skips the PIN when none is entered and goes to sign-in on success', async () => {
		const component = create('tok');
		fillPasswords(component);

		await component.submit();

		expect(acceptInvite).toHaveBeenCalledWith({
			token: 'tok',
			password: 'correct-horse-battery',
			displayName: 'Rina',
		});
		expect(showSuccess).toHaveBeenCalled();
		expect(navigateByUrl).toHaveBeenCalledWith('/auth/login');
	});

	it('sends the PIN with the chosen login preference', async () => {
		const component = create('tok');
		fillPasswords(component);
		component.pin.set('384917');
		component.confirmPin.set('384917');
		component.preferPin.set(true);

		await component.submit();

		expect(acceptInvite).toHaveBeenCalledWith(
			expect.objectContaining({ pin: '384917', preferredLoginMethod: 'pin' }),
		);
	});

	it.each([
		['a half-typed PIN', '3849', ''],
		['a PIN that does not match its confirmation', '384917', '384918'],
	])('refuses %s without spending the invitation', async (_label, pin, confirmPin) => {
		const component = create('tok');
		fillPasswords(component);
		component.pin.set(pin);
		component.confirmPin.set(confirmPin);

		await component.submit();

		expect(acceptInvite).not.toHaveBeenCalled();
		expect(component.error()).not.toBeNull();
	});

	it("shows the server's reason for a weak credential and stays on the page", async () => {
		acceptInvite.mockReturnValue(
			throwError(
				() =>
					new HttpErrorResponse({
						status: 400,
						error: {
							error: { message: 'Invalid request', issues: [{ message: 'PIN is too easy to guess' }] },
						},
					}),
			),
		);
		const component = create('tok');
		fillPasswords(component);

		await component.submit();

		expect(component.error()).toBe('PIN is too easy to guess');
		expect(navigateByUrl).not.toHaveBeenCalled();
	});
});
