import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';

import { environment } from '../../../../public/environments/environment';

/** `ContactMessageRequest` from `@saha-textile/contracts`, as the storefront sends it. */
export interface ContactMessageRequest {
	name: string;
	email: string;
	phone: string;
	subject: string;
	message: string;
	locale: 'en' | 'bn';
	/** The hidden field; a person never fills it. */
	website: string;
	/** How long the form was open before sending. */
	elapsedMs: number;
}

/** Contact Us: the API stores the message, then places it in the shop's chosen Gmail mailbox. */
@Injectable({ providedIn: 'root' })
export class ContactMessageService {
	private http = inject(HttpClient);

	send(body: ContactMessageRequest): Observable<{ accepted: boolean }> {
		return this.http.post<{ accepted: boolean }>(`${environment.apiUrl}/storefront/contact-messages`, body);
	}
}
