import { describe, expect, it, vi } from 'vitest';

import { deliverStockAlerts, type StockAlertDeps } from '../src/catalog/stock-alerts';

const alert = (id: string) => ({
	id,
	customerId: 'cus_1',
	productId: 'prd_1',
	variantId: 'var_1',
	createdAt: `2026-11-06T00:00:0${id.slice(-1)}.000Z`,
	notifiedAt: null,
	lastError: null,
});

function deps(overrides: {
	pending?: unknown[][];
	product?: unknown;
	variant?: unknown;
	customer?: unknown;
	send?: () => Promise<unknown>;
}) {
	const pages = overrides.pending ?? [[alert('a1')]];
	const listPending = vi.fn(async () => pages.shift() ?? []);
	const markNotified = vi.fn(async () => undefined);
	const markFailed = vi.fn(async () => undefined);
	const send = vi.fn(overrides.send ?? (async () => ({ status: 'sent' })));
	const has = (key: string) => key in overrides;
	const value: unknown = {
		alerts: { listPending, markNotified, markFailed, save: vi.fn() },
		products: {
			findById: async () =>
				has('product') ? overrides.product : { slug: 'silk', title: { en: 'Silk' }, madeToOrder: false },
		},
		variants: {
			findById: async () => (has('variant') ? overrides.variant : { sku: 'S-1', stock: { quantity: 2 } }),
		},
		customers: {
			findById: async () => (has('customer') ? overrides.customer : { email: 'a@example.com', status: 'active' }),
		},
		notifications: { send, isChannelEnabled: vi.fn() },
		now: () => new Date('2026-11-06T12:00:00.000Z'),
	};
	return { deps: value as StockAlertDeps, listPending, markNotified, markFailed, send };
}

describe('delivering stock alerts', () => {
	it('sends once a variant can be bought and marks the row', async () => {
		const run = deps({});

		await expect(deliverStockAlerts(run.deps)).resolves.toEqual({ sent: 1, held: 0, waiting: 0 });
		expect(run.send).toHaveBeenCalledWith(
			expect.objectContaining({
				templateKey: 'back_in_stock',
				destination: 'a@example.com',
				idempotencyKey: 'stock:a1',
				variables: { productSlug: 'silk', productName: 'Silk', variantSku: 'S-1' },
			}),
		);
		expect(run.markNotified).toHaveBeenCalledWith('a1', '2026-11-06T12:00:00.000Z');
	});

	it.each([
		['the variant is sold out', { variant: { sku: 'S-1', stock: { quantity: 0 } } }],
		['the variant is gone', { variant: null }],
		['the product is not live', { product: null }],
		['the customer is gone', { customer: null }],
		['the customer was deleted', { customer: { email: 'a@example.com', status: 'deleted' } }],
	])('waits while %s', async (_reason, overrides) => {
		const run = deps(overrides);

		await expect(deliverStockAlerts(run.deps)).resolves.toEqual({ sent: 0, held: 0, waiting: 1 });
		expect(run.send).not.toHaveBeenCalled();
		expect(run.markFailed).not.toHaveBeenCalled();
	});

	it('sends for a made-to-order product even with no stock', async () => {
		const run = deps({
			variant: { sku: 'S-1', stock: { quantity: 0 } },
			product: { slug: 'silk', title: { en: 'Silk' }, madeToOrder: true },
		});

		await expect(deliverStockAlerts(run.deps)).resolves.toMatchObject({ sent: 1 });
	});

	it('records why when the customer has no address', async () => {
		const run = deps({ customer: { email: null, status: 'active' } });

		await expect(deliverStockAlerts(run.deps)).resolves.toMatchObject({ held: 1 });
		expect(run.markFailed).toHaveBeenCalledWith('a1', 'no email address');
	});

	it('keeps the row when the provider suppresses the send', async () => {
		const run = deps({ send: async () => ({ status: 'suppressed_channel_disabled' }) });

		await expect(deliverStockAlerts(run.deps)).resolves.toMatchObject({ sent: 0, held: 1 });
		expect(run.markFailed).toHaveBeenCalledWith('a1', 'suppressed_channel_disabled');
		expect(run.markNotified).not.toHaveBeenCalled();
	});

	it('keeps the row when the send throws', async () => {
		const run = deps({
			send: async () => {
				throw new Error('down');
			},
		});

		await expect(deliverStockAlerts(run.deps)).resolves.toMatchObject({ held: 1 });
		expect(run.markFailed).toHaveBeenCalledWith('a1', 'could not send');
	});

	it('walks past a full batch, so sold-out rows cannot block the rest', async () => {
		const full = Array.from({ length: 100 }, (_, index) => alert(`a${index % 10}`));
		const run = deps({ pending: [full, [alert('b1')]] });

		await expect(deliverStockAlerts(run.deps)).resolves.toMatchObject({ sent: 101 });
		expect(run.listPending).toHaveBeenCalledTimes(2);
		expect(run.listPending.mock.calls[1]).toEqual([100, { createdAt: full[99]?.createdAt, id: full[99]?.id }]);
	});

	it('stops cleanly when nothing is pending', async () => {
		const run = deps({ pending: [[]] });

		await expect(deliverStockAlerts(run.deps)).resolves.toEqual({ sent: 0, held: 0, waiting: 0 });
	});
});
