import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	CheckoutConfirm,
	CheckoutHandoff,
	CheckoutPaymentOutcome,
	CheckoutPlace,
	CheckoutQuote,
	CheckoutRequest,
	PayPageView,
	SavedAddressWrite,
} from '@saha-textile/contracts';

/** One cart line as the server prices it, with what the checkout's summary draws (picture, MRP). */
export interface CheckoutCartLine {
	id: string;
	title: string;
	quantity: number;
	unitPriceINR: number;
	mrpINR: number | null;
	image: { roles: Record<string, Array<{ url: string }>> } | null;
}

/**
 * The shop checkout (shipping brief shop01–shop06; orders brief shop07–shop17): the server prices
 * every step (addresses, shipping with its reason, coupons, the gateway the currency picks) and the
 * shop only shows its answer. Saved addresses go through the checked address-book routes.
 */
@Injectable({ providedIn: 'root' })
export class CheckoutGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}${path}`;

	cart(): Observable<{ lines: CheckoutCartLine[] }> {
		return this.http.get<{ lines: CheckoutCartLine[] }>(this.api('/cart/current'));
	}

	quote(body: CheckoutRequest): Observable<CheckoutQuote> {
		return this.http.post<CheckoutQuote>(this.api('/storefront/checkout/quote'), body);
	}

	place(body: CheckoutPlace): Observable<CheckoutHandoff> {
		return this.http.post<CheckoutHandoff>(this.api('/storefront/checkout/place'), body);
	}

	attempt(attemptId: string): Observable<CheckoutPaymentOutcome> {
		return this.http.get<CheckoutPaymentOutcome>(
			this.api(`/storefront/checkout/attempts/${encodeURIComponent(attemptId)}`),
		);
	}

	confirm(attemptId: string, body: CheckoutConfirm): Observable<CheckoutPaymentOutcome> {
		return this.http.post<CheckoutPaymentOutcome>(
			this.api(`/storefront/checkout/attempts/${encodeURIComponent(attemptId)}/confirm`),
			body,
		);
	}

	/** Saved addresses with the country rules (shop15, shop16, shop17 "Save to my addresses"). */
	saveAddress(addressId: string | null, body: SavedAddressWrite): Observable<unknown> {
		const base = this.api('/storefront/account/address-book');
		return addressId ? this.http.put(`${base}/${encodeURIComponent(addressId)}`, body) : this.http.post(base, body);
	}

	/** Our pay page (shop10, shop11): the order, its total and the gateway's request, or why it ended. */
	payPage(token: string): Observable<PayPageView> {
		return this.http.get<PayPageView>(this.api(`/storefront/pay/${encodeURIComponent(token)}`));
	}
}

/** Sends the browser to the gateway: a plain redirect, or CCAvenue's signed form post. */
export function followHandoff(handoff: CheckoutHandoff['handoff'], doc: Document): void {
	if (handoff.kind === 'redirect') {
		doc.location.assign(handoff.url);
		return;
	}
	if (handoff.kind === 'form-post') {
		const form = doc.createElement('form');
		form.method = 'POST';
		form.action = handoff.url;
		for (const [name, value] of Object.entries(handoff.fields)) {
			const input = doc.createElement('input');
			input.type = 'hidden';
			input.name = name;
			input.value = value;
			form.appendChild(input);
		}
		doc.body.appendChild(form);
		form.submit();
	}
}
