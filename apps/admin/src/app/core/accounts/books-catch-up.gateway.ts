import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import { QUIET } from '../purchasing/purchasing.gateway';

import type { BooksCatchUp, BooksCatchUpResult } from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const CATCH_UP_KEY = ['accounts', 'catch-up'] as const;

/** "Post them" (Postings and Convert brief AP3): documents saved before the books took them. */
@Injectable({ providedIn: 'root' })
export class BooksCatchUpGateway {
	private readonly http = inject(HttpClient);
	private readonly url = () => `${runtimeConfig.apiUrl}/admin/accounts/catch-up`;

	/** Quiet: anyone but the super admin is refused, and the card says so in place. */
	summary(): Observable<BooksCatchUp> {
		return this.http.get<BooksCatchUp>(this.url(), QUIET);
	}
	run(): Observable<BooksCatchUpResult> {
		return this.http.post<BooksCatchUpResult>(this.url(), {});
	}
}
