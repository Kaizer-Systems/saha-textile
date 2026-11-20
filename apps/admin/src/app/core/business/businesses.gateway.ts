import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { queryParams } from '@core/purchasing/purchasing.gateway';
import { PAGE_EXPLAINS_ERRORS } from '@core/shipping/shipping.gateway';

import type {
	AdminZoneRow,
	Business,
	BusinessListQuery,
	BusinessListResponse,
	BusinessAddressWrite,
	BusinessOpenOrder,
	BusinessReceiptWrite,
	BusinessStandingWrite,
	BusinessWrite,
	BusinessZoneWrite,
	LedgerQuery,
	LedgerStatement,
	SetOffSettingWrite,
	SetOffReverseWrite,
	SetOffWrite,
} from '@saha-textile/contracts';

/** Every business screen reads under this key, so a change refreshes them all. */
export const BUSINESSES_KEY = ['admin-businesses'] as const;

/**
 * Admin › Customers › Businesses (orders and checkout brief bz01–bz06, so01–so04): one record for a
 * business that buys from us, sells to us or both, each side with its own account.
 */
@Injectable({ providedIn: 'root' })
export class BusinessesGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path = '') => `${runtimeConfig.apiUrl}/admin/businesses${path}`;
	private readonly id = (value: string) => encodeURIComponent(value);

	list(query: Partial<BusinessListQuery>): Observable<BusinessListResponse> {
		return this.http.get<BusinessListResponse>(this.api(), { params: queryParams(query) });
	}

	get(id: string): Observable<Business> {
		return this.http.get<Business>(this.api(`/${this.id(id)}`));
	}

	save(id: string | null, body: BusinessWrite): Observable<Business> {
		return id
			? this.http.put<Business>(this.api(`/${this.id(id)}`), body, PAGE_EXPLAINS_ERRORS)
			: this.http.post<Business>(this.api(), body, PAGE_EXPLAINS_ERRORS);
	}

	setStanding(id: string, body: BusinessStandingWrite): Observable<Business> {
		return this.http.post<Business>(this.api(`/${this.id(id)}/standing`), body, PAGE_EXPLAINS_ERRORS);
	}

	setZone(id: string, body: BusinessZoneWrite): Observable<Business> {
		return this.http.post<Business>(this.api(`/${this.id(id)}/zone`), body, PAGE_EXPLAINS_ERRORS);
	}

	ledger(id: string, query: Partial<LedgerQuery> & Pick<LedgerQuery, 'side'>): Observable<LedgerStatement> {
		return this.http.get<LedgerStatement>(this.api(`/${this.id(id)}/ledger`), { params: queryParams(query) });
	}

	/** bz02: a business's delivery addresses, checked against the country rules on the server. */
	addAddress(id: string, body: BusinessAddressWrite): Observable<Business> {
		return this.http.post<Business>(this.api(`/${this.id(id)}/addresses`), body, PAGE_EXPLAINS_ERRORS);
	}

	replaceAddress(id: string, addressId: string, body: BusinessAddressWrite): Observable<Business> {
		return this.http.put<Business>(
			this.api(`/${this.id(id)}/addresses/${this.id(addressId)}`),
			body,
			PAGE_EXPLAINS_ERRORS,
		);
	}

	removeAddress(id: string, addressId: string): Observable<Business> {
		return this.http.delete<Business>(this.api(`/${this.id(id)}/addresses/${this.id(addressId)}`), PAGE_EXPLAINS_ERRORS);
	}

	/** bz06: the orders on account that still owe money, oldest first (the receipt's Settles table). */
	openOrders(id: string): Observable<BusinessOpenOrder[]> {
		return this.http.get<BusinessOpenOrder[]>(this.api(`/${this.id(id)}/open-orders`), PAGE_EXPLAINS_ERRORS);
	}

	recordReceipt(id: string, body: BusinessReceiptWrite): Observable<unknown> {
		return this.http.post(this.api(`/${this.id(id)}/receipts`), body, PAGE_EXPLAINS_ERRORS);
	}

	setSetOff(id: string, body: SetOffSettingWrite): Observable<Business> {
		return this.http.post<Business>(this.api(`/${this.id(id)}/set-off-setting`), body, PAGE_EXPLAINS_ERRORS);
	}

	/** so04: a reversing entry with its own reason, in both accounts. */
	reverseSetOff(id: string, documentId: string, body: SetOffReverseWrite): Observable<unknown> {
		return this.http.post(
			this.api(`/${this.id(id)}/set-offs/${this.id(documentId)}/reverse`),
			body,
			PAGE_EXPLAINS_ERRORS,
		);
	}

	/** Where things stand: what they owe us and what we owe them (unpaid bills plus set-offs). */
	balances(id: string): Observable<{ theyOweUsINR: number; weOweThemINR: number }> {
		return this.http.get<{ theyOweUsINR: number; weOweThemINR: number }>(this.api(`/${this.id(id)}/balances`));
	}

	recordSetOff(id: string, body: SetOffWrite): Observable<unknown> {
		return this.http.post(this.api(`/${this.id(id)}/set-offs`), body, PAGE_EXPLAINS_ERRORS);
	}

	zones(): Observable<AdminZoneRow[]> {
		return this.http.get<AdminZoneRow[]>(`${runtimeConfig.apiUrl}/admin/zones`);
	}
}

export function injectBusinessesQuery(query: () => Partial<BusinessListQuery>) {
	const gateway = inject(BusinessesGateway);
	return injectQuery(() => ({
		queryKey: [...BUSINESSES_KEY, 'list', query()],
		queryFn: () => firstValueFrom(gateway.list(query())),
		placeholderData: (previous: BusinessListResponse | undefined) => previous,
	}));
}

export function injectBusinessQuery(id: () => string | null) {
	const gateway = inject(BusinessesGateway);
	return injectQuery(() => ({
		queryKey: [...BUSINESSES_KEY, 'one', id()],
		queryFn: () => firstValueFrom(gateway.get(id() as string)),
		enabled: !!id(),
	}));
}

export function injectBusinessLedgerQuery(id: () => string | null, side: () => 'receivable' | 'payable') {
	const gateway = inject(BusinessesGateway);
	return injectQuery(() => ({
		queryKey: [...BUSINESSES_KEY, 'ledger', id(), side()],
		queryFn: () => firstValueFrom(gateway.ledger(id() as string, { side: side(), pageSize: 200 })),
		enabled: !!id(),
	}));
}

/** The zones a business can be put in; RETAIL first. */
export function injectZoneChoicesQuery(enabled: () => boolean = () => true) {
	const gateway = inject(BusinessesGateway);
	return injectQuery(() => ({
		queryKey: [...BUSINESSES_KEY, 'zones'],
		queryFn: () => firstValueFrom(gateway.zones()),
		enabled: enabled(),
		staleTime: 60_000,
	}));
}

export function injectBusinessBalancesQuery(id: () => string | null) {
	const gateway = inject(BusinessesGateway);
	return injectQuery(() => ({
		queryKey: [...BUSINESSES_KEY, 'balances', id()],
		queryFn: () => firstValueFrom(gateway.balances(id() as string)),
		enabled: !!id(),
	}));
}
