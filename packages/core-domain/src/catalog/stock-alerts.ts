import type { StockAlert } from '@saha-textile/contracts';

import type { ProductVariantRepository, StockAlertRepository } from '../ports/catalog-extended.repository';
import type { ProductRepository } from '../ports/catalog.repository';
import type { CustomerRepository } from '../ports/customer.repository';
import type { NotificationPort } from '../ports/notification.port';

const BATCH = 100;
/** The provider took the message. Anything else, suppressed included, is not a send. */
const ACCEPTED = new Set(['queued', 'sent', 'delivered']);

export interface StockAlertDeps {
	alerts: StockAlertRepository;
	products: Pick<ProductRepository, 'findById'>;
	variants: Pick<ProductVariantRepository, 'findById'>;
	customers: Pick<CustomerRepository, 'findById'>;
	notifications: NotificationPort;
	now: () => Date;
}

export interface StockAlertRun {
	sent: number;
	held: number;
	waiting: number;
}

/**
 * Tells signed-in customers when a variant they asked about can be bought.
 *
 * A row is marked notified only after a real send; a failed or suppressed send records why and
 * stays. Walks every pending row, so alerts for sold-out variants cannot block the rest.
 */
export async function deliverStockAlerts(deps: StockAlertDeps): Promise<StockAlertRun> {
	const run: StockAlertRun = { sent: 0, held: 0, waiting: 0 };
	let cursor: { createdAt: string; id: string } | undefined;
	for (;;) {
		const batch = await deps.alerts.listPending(BATCH, cursor);
		for (const alert of batch) await deliverOne(deps, alert, run);
		const last = batch.at(-1);
		if (!last || batch.length < BATCH) return run;
		cursor = { createdAt: last.createdAt, id: last.id };
	}
}

async function deliverOne(deps: StockAlertDeps, alert: StockAlert, run: StockAlertRun): Promise<void> {
	const [product, variant, customer] = await Promise.all([
		deps.products.findById(alert.productId, 'public'),
		deps.variants.findById(alert.variantId, 'public'),
		deps.customers.findById(alert.customerId),
	]);
	const canBuy = !!variant && (variant.stock.quantity > 0 || !!product?.madeToOrder);
	if (!product || !canBuy || !customer || customer.status === 'deleted') {
		run.waiting += 1;
		return;
	}
	if (!customer.email) {
		await hold(deps, alert, 'no email address', run);
		return;
	}
	try {
		const result = await deps.notifications.send({
			channel: 'email',
			category: 'transactional',
			templateKey: 'back_in_stock',
			destination: customer.email,
			userId: alert.customerId,
			idempotencyKey: `stock:${alert.id}`,
			variables: { productSlug: product.slug, productName: product.title.en, variantSku: variant.sku },
		});
		if (!ACCEPTED.has(result.status)) {
			await hold(deps, alert, result.status, run);
			return;
		}
		await deps.alerts.markNotified(alert.id, deps.now().toISOString());
		run.sent += 1;
	} catch {
		await hold(deps, alert, 'could not send', run);
	}
}

async function hold(deps: StockAlertDeps, alert: StockAlert, error: string, run: StockAlertRun): Promise<void> {
	await deps.alerts.markFailed(alert.id, error);
	run.held += 1;
}
