import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom, Observable } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	AdminProductList,
	AdminShippingOverview,
	AdminShippingRuleSetDetail,
	AdminShippingRuleSetRow,
	ShippingException,
	ShippingExceptionWrite,
	ShippingRuleSetActivate,
	ShippingRuleSetActivateResult,
	ShippingRuleSetCreate,
	ShippingRuleSetSave,
	ShippingSettingsWrite,
	ShippingCartTryRequest,
	ShippingCartTryResult,
	ShippingTryRequest,
	ShippingTryResult,
} from '@saha-textile/contracts';

/** Every shipping screen reads under this key, so a save refreshes them all. */
/**
 * Settings change only through these pages, and every save refreshes them, so a read stays fresh
 * for half a minute: coming back to the tab doesn't cover the page with the loader again.
 */
export const SHIPPING_STALE_MS = 30_000;
export const SHIPPING_KEY = ['shipping'] as const;

/** Admin › Shipping (brief approved 2026-11-19): overview, rule sets, Try it, exceptions. */
@Injectable({ providedIn: 'root' })
export class ShippingGateway {
	private readonly http = inject(HttpClient);
	private readonly base = (path = '') => `${runtimeConfig.apiUrl}/admin/shipping${path}`;
	private readonly id = (value: string) => encodeURIComponent(value);

	overview(): Observable<AdminShippingOverview> {
		return this.http.get<AdminShippingOverview>(this.base('/overview'));
	}

	saveSettings(body: ShippingSettingsWrite): Observable<AdminShippingOverview> {
		return this.http.post<AdminShippingOverview>(this.base('/settings'), body);
	}

	ruleSets(): Observable<AdminShippingRuleSetRow[]> {
		return this.http.get<AdminShippingRuleSetRow[]>(this.base('/rule-sets'));
	}

	ruleSet(id: string): Observable<AdminShippingRuleSetDetail> {
		return this.http.get<AdminShippingRuleSetDetail>(this.base(`/rule-sets/${this.id(id)}`));
	}

	create(body: ShippingRuleSetCreate): Observable<AdminShippingRuleSetDetail> {
		return this.http.post<AdminShippingRuleSetDetail>(this.base('/rule-sets'), body);
	}

	save(id: string, body: ShippingRuleSetSave): Observable<AdminShippingRuleSetDetail> {
		return this.http.post<AdminShippingRuleSetDetail>(this.base(`/rule-sets/${this.id(id)}`), body);
	}

	activate(id: string, body: ShippingRuleSetActivate): Observable<ShippingRuleSetActivateResult> {
		return this.http.post<ShippingRuleSetActivateResult>(this.base(`/rule-sets/${this.id(id)}/activate`), body);
	}

	remove(id: string, revision: number): Observable<{ ok: boolean }> {
		return this.http.delete<{ ok: boolean }>(this.base(`/rule-sets/${this.id(id)}`), { params: { revision } });
	}

	tryIt(body: ShippingTryRequest): Observable<ShippingTryResult> {
		return this.http.post<ShippingTryResult>(this.base('/try'), body);
	}

	/** Overview › Try any cart: priced with the live settings, the way checkout prices it. */
	tryCart(body: ShippingCartTryRequest): Observable<ShippingCartTryResult> {
		return this.http.post<ShippingCartTryResult>(this.base('/try-cart'), body);
	}

	/** Category form: how many products read this category's charges, and how many set their own. */
	categoryUsage(categoryId: string): Observable<{ products: number; ownCharges: number }> {
		return this.http.get<{ products: number; ownCharges: number }>(
			this.base(`/category-usage/${this.id(categoryId)}`),
		);
	}

	exceptions(): Observable<ShippingException[]> {
		return this.http.get<ShippingException[]>(this.base('/exceptions'));
	}

	saveException(id: string | null, body: ShippingExceptionWrite): Observable<ShippingException> {
		return this.http.post<ShippingException>(this.base(id ? `/exceptions/${this.id(id)}` : '/exceptions'), body);
	}

	removeException(id: string): Observable<{ ok: boolean }> {
		return this.http.delete<{ ok: boolean }>(this.base(`/exceptions/${this.id(id)}`));
	}

	/** One product's title, for a product exception's row. */
	productTitle(id: string): Observable<{ id: string; title: string }> {
		return this.http.get<{ id: string; title: string }>(
			`${runtimeConfig.apiUrl}/admin/catalog/products/${this.id(id)}`,
		);
	}

	/** Live products by name or SKU, for building a cart to try a rule set on. */
	searchProducts(search: string): Observable<AdminProductList> {
		return this.http.get<AdminProductList>(`${runtimeConfig.apiUrl}/admin/catalog/products`, {
			params: { search, status: 'live', pageSize: 10 },
		});
	}
}

export function injectShippingOverviewQuery() {
	const gateway = inject(ShippingGateway);
	return injectQuery(() => ({
		queryKey: [...SHIPPING_KEY, 'overview'],
		queryFn: () => firstValueFrom(gateway.overview()),
		staleTime: SHIPPING_STALE_MS,
	}));
}

export function injectShippingRuleSetsQuery() {
	const gateway = inject(ShippingGateway);
	return injectQuery(() => ({
		queryKey: [...SHIPPING_KEY, 'rule-sets'],
		queryFn: () => firstValueFrom(gateway.ruleSets()),
		staleTime: SHIPPING_STALE_MS,
	}));
}

export function injectShippingExceptionsQuery() {
	const gateway = inject(ShippingGateway);
	return injectQuery(() => ({
		queryKey: [...SHIPPING_KEY, 'exceptions'],
		queryFn: () => firstValueFrom(gateway.exceptions()),
		staleTime: SHIPPING_STALE_MS,
	}));
}

/**
 * The translation key for a failed shipping call: the server's code (`stale_revision`,
 * `rule_set_in_use`, `courier_not_connected`, …) as `ship_err_<code>`, or a general line.
 */
export function shippingProblemKey(error: unknown): string {
	// The API's error body, sometimes wrapped once more under `error` by the exception filter.
	const outer = (error as { error?: unknown } | null)?.error;
	const inner = outer && typeof outer === 'object' ? (outer as { error?: unknown }).error : undefined;
	const body = (inner && typeof inner === 'object' ? inner : outer) as
		{ code?: unknown; issues?: Array<{ code?: unknown }> } | undefined;
	const code =
		typeof body?.code === 'string'
			? body.code
			: typeof body?.issues?.[0]?.code === 'string'
				? body.issues[0].code
				: null;
	return code && KNOWN_PROBLEMS.has(code) ? `ship_err_${code}` : 'ship_err_general';
}

const KNOWN_PROBLEMS = new Set([
	'stale_revision',
	'rule_set_in_use',
	'premade_locked',
	'courier_not_connected',
	'abroad_policy_not_built',
	'rule_set_not_active',
	'rule_set_wrong_zone',
	'unknown_product',
	'unknown_category',
	'measurements_required',
	'unknown_variant',
	'bundle_not_on_sale',
]);
