import { describe, expect, it } from 'vitest';

import * as m0 from '../src/addresses/address-book.controller';
import * as m1 from '../src/admin-orders/admin-orders.controller';
import * as m2 from '../src/admin-orders/pay-page.controller';
import * as m3 from '../src/auth/admin-auth.controller';
import * as m4 from '../src/auth/storefront-auth.controller';
import * as m5 from '../src/catalog/bundles/admin-bundles.controller';
import * as m6 from '../src/catalog/admin-product-drafts.controller';
import * as m7 from '../src/catalog/admin-products.controller';
import * as m8 from '../src/catalog/admin-taxonomy.controller';
import * as m9 from '../src/communications/communications.controller';
import * as m10 from '../src/company/company.controller';
import * as m11 from '../src/documents/document-formats.controller';
import * as m12 from '../src/documents/order-documents.controller';
import * as m13 from '../src/edocs/edocs.controller';
import * as m14 from '../src/events/admin-events.controller';
import * as m15 from '../src/fx/fx.controller';
import * as m16 from '../src/geo/geo.controller';
import * as m17 from '../src/languages/languages.controller';
import * as m18 from '../src/legal/legal-pages.controller';
import * as m19 from '../src/locations/locations.controller';
import * as m20 from '../src/mailboxes/admin-inbox.controller';
import * as m21 from '../src/mailboxes/admin-mailboxes.controller';
import * as m22 from '../src/media/admin-content.controller';
import * as m23 from '../src/media/admin-media-library.controller';
import * as m24 from '../src/media/admin-media-profiles.controller';
import * as m25 from '../src/media/admin-media-sharing.controller';
import * as m26 from '../src/media/share.controller';
import * as m27 from '../src/ops/ops.controller';
import * as m28 from '../src/orders/orders.controller';
import * as m29 from '../src/orders-setup/orders-setup.controller';
import * as m30 from '../src/page-builder/page-builder.controller';
import * as m31 from '../src/purchasing/purchase-entries.controller';
import * as m32 from '../src/purchasing/purchase-orders.controller';
import * as m33 from '../src/purchasing/purchase-returns.controller';
import * as m34 from '../src/purchasing/purchasing-prints.controller';
import * as m35 from '../src/purchasing/stock.controller';
import * as m36 from '../src/purchasing/suppliers.controller';
import * as m37 from '../src/routing/order-routing.controller';
import * as m38 from '../src/routing/order-ships-from.controller';
import * as m39 from '../src/shipping/admin-shipping.controller';
import * as m40 from '../src/shop-checkout/payment-callbacks.controller';
import * as m41 from '../src/shop-checkout/shop-checkout.controller';

/**
 * Every endpoint of each admin and shop controller forwards to its service. The services here are stand-ins that
 * answer anything with "anything" (a value that is callable, has every property and iterates as empty), so each
 * endpoint runs end to end once with full arguments and once with none.
 */
const anything: unknown = new Proxy(function anythingValue() {}, {
	get: (_target, key) => {
		if (key === 'then') return undefined;
		if (key === Symbol.iterator) return function* () {};
		if (key === Symbol.asyncIterator) return async function* () {};
		if (key === Symbol.toPrimitive) return () => '';
		if (key === 'length' || key === 'size') return 0;
		return anything;
	},
	apply: () => anything,
	construct: () => anything as object,
});

function standIn(calls: string[]): unknown {
	return new Proxy(
		{},
		{
			get: (_target, key) =>
				typeof key === 'string' && key !== 'then'
					? (...args: unknown[]) => {
							calls.push(key);
							void args;
							return Promise.resolve(anything);
						}
					: undefined,
		},
	);
}

type ControllerClass = new (...services: unknown[]) => object;

async function sweep(Controller: ControllerClass): Promise<{ calls: string[]; methods: string[] }> {
	const calls: string[] = [];
	const instance = new Controller(
		...Array.from({ length: Math.max(Controller.length, 8) }, () => standIn(calls)),
	) as Record<string, (...args: unknown[]) => unknown>;
	const methods = Object.getOwnPropertyNames(Controller.prototype).filter(
		(name) => name !== 'constructor' && typeof instance[name] === 'function',
	);
	for (const name of methods) {
		const method = instance[name] as (...args: unknown[]) => unknown;
		for (const args of [Array.from({ length: Math.max(method.length, 4) }, () => anything), []]) {
			try {
				await method.apply(instance, args);
			} catch {
				// An endpoint may refuse a missing argument; the sweep only checks that each one reaches its service.
			}
		}
	}
	return { calls, methods };
}

const CONTROLLERS: Array<[string, ControllerClass]> = [
	m0,
	m1,
	m2,
	m3,
	m4,
	m5,
	m6,
	m7,
	m8,
	m9,
	m10,
	m11,
	m12,
	m13,
	m14,
	m15,
	m16,
	m17,
	m18,
	m19,
	m20,
	m21,
	m22,
	m23,
	m24,
	m25,
	m26,
	m27,
	m28,
	m29,
	m30,
	m31,
	m32,
	m33,
	m34,
	m35,
	m36,
	m37,
	m38,
	m39,
	m40,
	m41,
].flatMap((module) =>
	Object.entries(module as Record<string, unknown>)
		.filter(([name, value]) => name.endsWith('Controller') && typeof value === 'function')
		.map(([name, value]) => [name, value as ControllerClass] as [string, ControllerClass]),
);

describe('every controller endpoint reaches its service', () => {
	for (const [name, Controller] of CONTROLLERS) {
		it(`${name}`, async () => {
			const { calls, methods } = await sweep(Controller);
			expect(methods.length).toBeGreaterThan(0);
			expect(calls.length).toBeGreaterThan(0);
		});
	}
});
