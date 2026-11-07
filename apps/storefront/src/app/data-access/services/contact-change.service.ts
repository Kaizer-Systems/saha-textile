import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, map } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { toAccountUser } from '@data-access/adapters/customer-to-account-user';
import { IAccountUser } from '@data-access/interfaces/account.interface';
import { ICustomer } from '@data-access/interfaces/customer.interface';

import type { StepUpProof } from '@core/auth/auth-gateway';

/** A change in flight: what was asked for, and when another code may be requested. */
export interface PendingContactChange {
	field: 'email' | 'phone';
	newValue: string;
	sendsRemaining: number;
	resendAvailableAt: string | null;
	expiresAt: string;
}

/**
 * Moving the email or the phone on the account.
 *
 * Two steps, and NOTHING changes between them. Starting a change sends a code to the new value
 * while the account keeps the old one — it still signs in, still receives recovery mail — and
 * only confirmation moves it. So there is no half-changed state on the client worth protecting:
 * the server holds the pending value and will not act on anything the browser asserts about it.
 *
 * Confirmation carries a code and nothing else. Which credential is moving, and to what, are read
 * from the record the server kept; a client that could name them could name something it had not
 * proven.
 */
@Injectable({ providedIn: 'root' })
export class ContactChangeService {
	private http = inject(HttpClient);

	private url(path = ''): string {
		return `${runtimeConfig.apiUrl}/storefront/account/contact${path}`;
	}

	/** The change in flight, or null. Restores the code step after a reload. */
	pending(): Observable<PendingContactChange | null> {
		return this.http
			.get<{ pending: PendingContactChange | null }>(this.url())
			.pipe(map((response) => response.pending));
	}

	startEmailChange(newEmail: string, proof: StepUpProof): Observable<PendingContactChange> {
		return this.http.post<PendingContactChange>(this.url('/email'), { newEmail, ...proof });
	}

	startPhoneChange(newPhone: string, proof: StepUpProof): Observable<PendingContactChange> {
		return this.http.post<PendingContactChange>(this.url('/phone'), { newPhone, ...proof });
	}

	/** Sends the code again. Takes no proof — the destination is already fixed server-side. */
	resend(): Observable<PendingContactChange> {
		return this.http.post<PendingContactChange>(this.url('/resend'), {});
	}

	/** Spends the code and answers the updated customer, with the new value on it. */
	confirm(code: string): Observable<IAccountUser> {
		return this.http.post<ICustomer>(this.url('/confirm'), { code }).pipe(map(toAccountUser));
	}

	cancel(): Observable<void> {
		return this.http.delete<void>(this.url());
	}
}
