import { Injectable } from '@angular/core';

import { environment } from '../../../../public/environments/environment';

/** `ShareOpenAnswer` from `@saha-textile/contracts`, as the shop reads it. */
export type ShareOpenAnswer =
	| { state: 'open'; url: string; fileName: string; contentType: string; bytes: number }
	| { state: 'password'; wrong?: boolean }
	| { state: 'admins_only' }
	| { state: 'expired' }
	/** The API's per-address or per-link limit answered 429. */
	| { state: 'too_many' };

/**
 * Opening a Media share link (`/s/{code}`). This uses the browser's `fetch`, not the app's
 * HttpClient, on purpose:
 *
 * - The check sends cookies, so an admin signed in to the admin in this browser opens an
 *   admins-only link (the API reads the admin session for this one route).
 * - The password goes WITHOUT cookies. A password link is never admins-only, so it needs no
 *   session, and a request carrying the admin's cookies would have to echo the admin's CSRF value,
 *   which the shop cannot read. The app's interceptor always sends cookies and the shop's CSRF
 *   value, so it is the wrong tool for both.
 */
@Injectable({ providedIn: 'root' })
export class ShareLinkService {
	check(code: string): Promise<ShareOpenAnswer> {
		return this.ask(code, { method: 'GET', credentials: 'include' });
	}

	openWithPassword(code: string, password: string): Promise<ShareOpenAnswer> {
		return this.ask(code, {
			method: 'POST',
			credentials: 'omit',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ password }),
		});
	}

	private async ask(code: string, init: RequestInit): Promise<ShareOpenAnswer> {
		const answer = await fetch(`${environment.apiUrl}/share/${encodeURIComponent(code)}`, init);
		if (answer.status === 429) return { state: 'too_many' };
		if (!answer.ok) return { state: 'expired' };
		return (await answer.json()) as ShareOpenAnswer;
	}
}
