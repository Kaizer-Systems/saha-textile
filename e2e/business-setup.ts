import { expect, type APIRequestContext } from '@playwright/test';

import { withDatabase } from './database';
import { API_URL } from './support';

/**
 * Setup shared by the specs that need Saha Textile's own selling rules in the throwaway database:
 * the pound beside the seeded ₹ and US$, and the two shipping rule sets with "export off, invoice to
 * an Indian address". Each call checks first, so whichever spec runs first sets them up and the
 * others find them in place, in any order and on any worker.
 */

export type Json = Record<string, unknown> & { id?: string };

/** The admin API with the signed-in test administrator's session and CSRF token. */
export class AdminApi {
	private token = '';
	constructor(private readonly request: APIRequestContext) {}

	private async csrf(): Promise<string> {
		if (!this.token) {
			const response = await this.request.get(`${API_URL}/auth/admin/csrf`);
			this.token = ((await response.json()) as { csrfToken: string }).csrfToken;
		}
		return this.token;
	}

	/** A call that must succeed; its body. */
	async ok<T = Json>(method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown): Promise<T> {
		const answer = await this.try(method, path, data);
		expect(answer.status, `${method} ${path}: ${JSON.stringify(answer.body).slice(0, 600)}`).toBeLessThan(300);
		return answer.body as T;
	}

	/** A call that may be refused; its status and body. */
	async try(
		method: 'GET' | 'POST' | 'PUT',
		path: string,
		data?: unknown,
	): Promise<{ status: number; body: unknown }> {
		const headers: Record<string, string> = method === 'GET' ? {} : { 'x-csrf-token': await this.csrf() };
		const response = await this.request.fetch(`${API_URL}${path}`, { method, headers, data });
		const text = await response.text();
		let body: unknown = text;
		try {
			body = text ? JSON.parse(text) : null;
		} catch {
			// not JSON
		}
		return { status: response.status(), body };
	}
}

/** The owner's shop sells in eight currencies; the seeded test database has ₹ and US$ only. */
export async function ensurePounds(): Promise<void> {
	await withDatabase(async (db) => {
		const currencies = db.collection('currencies');
		const usd = await currencies.findOne({ _id: 'USD' as never });
		if (!usd) return;
		// One atomic "add it if it is missing": business-flows and checkout-rules call this at the same
		// time on parallel workers, and a look-then-insert let both insert (E11000 on GBP).
		const { _id: _usd, ...fields } = usd;
		await currencies.updateOne(
			{ _id: 'GBP' as never },
			{ $setOnInsert: { ...fields, symbol: '£', paypalFixed: 0.2, rateFromINR: 1 / 107.5 } },
			{ upsert: true },
		);
	});
}

interface ShippingOverview {
	settings: {
		revision: number;
		abroadPolicy?: string;
		domestic?: { kind: string };
		international?: { kind: string };
	} | null;
}

const sahaTextileShippingSet = (overview: ShippingOverview): boolean =>
	overview.settings?.abroadPolicy === 'exportOffIndianInvoice' &&
	overview.settings.domestic?.kind === 'ruleSet' &&
	overview.settings.international?.kind === 'ruleSet';

/**
 * Saha Textile's two shipping rule sets, site-wide: ₹100 per discounted piece in India (full-price
 * pieces free), and abroad the first piece's charge once then each further piece's, with export off
 * and an Indian invoice address. Already in place → nothing is done.
 */
export async function ensureSahaTextileShipping(api: AdminApi, run: string): Promise<void> {
	if (sahaTextileShippingSet(await api.ok<ShippingOverview>('GET', '/admin/shipping/overview'))) return;
	const domestic = await api.ok<{ ruleSet: { id: string } }>('POST', '/admin/shipping/rule-sets', {
		name: `Saha Textile — Domestic ${run}`,
		description: '',
		use: 'domestic',
		copyFromId: null,
	});
	const international = await api.ok<{ ruleSet: { id: string } }>('POST', '/admin/shipping/rule-sets', {
		name: `Saha Textile — International ${run}`,
		description: '',
		use: 'international',
		copyFromId: null,
	});
	const bodies = {
		[domestic.ruleSet.id]: {
			steps: [
				{
					id: 'step-1',
					scope: 'eachLine',
					combine: 'sum',
					node: {
						kind: 'if',
						id: 'if-1',
						when: {
							kind: 'group',
							id: 'when-1',
							join: 'all',
							items: [{ kind: 'condition', id: 'c-1', field: 'line.discounted', op: 'is', value: true }],
						},
						then: {
							kind: 'result',
							id: 'r-1',
							result: { kind: 'productCharge', charge: 'domestic', per: 'unit' },
						},
						otherwise: { kind: 'result', id: 'r-2', result: { kind: 'free' } },
					},
				},
			],
			adjust: [],
		},
		[international.ruleSet.id]: {
			steps: [
				{
					id: 'step-1',
					scope: 'wholeCart',
					combine: 'sum',
					node: {
						kind: 'result',
						id: 'r-1',
						result: {
							kind: 'firstAndFurther',
							first: { from: 'product', charge: 'internationalFirst' },
							further: { from: 'product', charge: 'internationalFurther' },
							count: 'acrossCart',
						},
					},
				},
			],
			adjust: [],
		},
	};
	for (const [id, draft] of Object.entries(bodies)) {
		const opened = await api.ok<{ ruleSet: { name: string; use: string; revision: number } }>(
			'GET',
			`/admin/shipping/rule-sets/${id}`,
		);
		const saved = await api.ok<{ ruleSet: { revision: number } }>('POST', `/admin/shipping/rule-sets/${id}`, {
			name: opened.ruleSet.name,
			description: '',
			use: opened.ruleSet.use,
			draft,
			testCarts: [],
			revision: opened.ruleSet.revision,
		});
		const activated = await api.ok<{ outcome: string }>('POST', `/admin/shipping/rule-sets/${id}/activate`, {
			revision: saved.ruleSet.revision,
			acceptChanges: [],
		});
		expect(activated.outcome).toBe('activated');
	}
	const overview = await api.ok<ShippingOverview>('GET', '/admin/shipping/overview');
	if (sahaTextileShippingSet(overview)) return;
	const answer = await api.try('POST', '/admin/shipping/settings', {
		homeCountry: 'IN',
		domestic: { kind: 'ruleSet', ruleSetId: domestic.ruleSet.id },
		international: { kind: 'ruleSet', ruleSetId: international.ruleSet.id },
		mixedRuleSets: 'sum',
		defaultCharges: { domestic: 100, internationalFirst: 2000, internationalFurther: 900 },
		abroadPolicy: 'exportOffIndianInvoice',
		abroadOptions: { askForHomeAddress: true, holdPackingUntilComplete: true },
		revision: overview.settings?.revision ?? 0,
	});
	// Another spec may have saved the same settings a moment earlier (its revision wins).
	if (answer.status >= 300)
		expect(sahaTextileShippingSet(await api.ok<ShippingOverview>('GET', '/admin/shipping/overview'))).toBe(true);
}
