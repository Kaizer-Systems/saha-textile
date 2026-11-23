import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Order, TaxInvoice } from '@saha-textile/contracts';
import {
	buildInvoiceLines,
	type CompanyRepository,
	defaultStockLocation,
	invoicePosting,
	istDay,
	type LocationRepository,
	type ProductRepository,
	type ShopDetailsRepository,
	type TaxInvoiceRepository,
	type TransactionContext,
} from '@saha-textile/core-domain';

import {
	COMPANY_REPOSITORY,
	LOCATION_REPOSITORY,
	PRODUCT_REPOSITORY,
	SHOP_DETAILS_REPOSITORY,
	TAX_INVOICE_REPOSITORY,
} from '../infra/tokens';
import { LedgerService } from '../ledger/ledger.service';
import { DocumentNumbersService } from '../orders-setup/document-numbers.service';

export interface DispatchInput {
	order: Order;
	shipmentId: string;
	/** The lines in this parcel. */
	lineIds: readonly string[];
	actorId: string | null;
	at: string;
}

/**
 * Tax invoices issued when goods leave (accounts brief D1, D3; owner-approved 2026-11-23). With Settings ›
 * Features › Tax invoices at dispatch on, Shipped issues the parcel's invoice in its own transaction: numbered per
 * GSTIN, HSN and GST on every line at today's rates (marked "rates wait for the CA"), and posted to the books.
 */
@Injectable()
export class InvoicesService {
	constructor(
		@Inject(TAX_INVOICE_REPOSITORY) private readonly invoices: TaxInvoiceRepository,
		@Inject(COMPANY_REPOSITORY) private readonly company: CompanyRepository,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(SHOP_DETAILS_REPOSITORY) private readonly shop: Pick<ShopDetailsRepository, 'get'>,
		@Inject(PRODUCT_REPOSITORY) private readonly products: Pick<ProductRepository, 'findById'>,
		private readonly numbers: DocumentNumbersService,
		private readonly ledger: LedgerService,
	) {}

	async enabled(): Promise<boolean> {
		return (await this.company.getFeatures())?.on.tax_invoices === true;
	}

	listForOrder(orderId: string): Promise<TaxInvoice[]> {
		return this.invoices.listForOrder(orderId);
	}

	async get(id: string): Promise<TaxInvoice> {
		const invoice = await this.invoices.get(id);
		if (!invoice) throw new NotFoundException('invoice_not_found');
		return invoice;
	}

	/** The parcel's invoice, in the Shipped transaction; null while the switch is off. A repeat returns the first. */
	async issueAtDispatch(input: DispatchInput, context: TransactionContext): Promise<TaxInvoice | null> {
		if (!(await this.enabled())) return null;
		const existing = await this.invoices.findByShipment(input.shipmentId, context);
		if (existing) return existing;
		const { order } = input;
		const shipped = order.lines.filter(
			(line) => line.lineId && input.lineIds.includes(line.lineId) && line.role !== 'bundle',
		);
		const [allLocations, earlier, shop] = await Promise.all([
			this.locations.list(),
			this.invoices.listForOrder(order.id),
			this.shop.get(),
		]);
		const locationId = order.shipsFromLocationId ?? defaultStockLocation(allLocations);
		const location = allLocations.find((l) => l.id === locationId);
		if (!location) throw new BadRequestException('invoice_problem:no_location');
		const registration =
			(location.gstRegistrationId ? await this.company.getRegistration(location.gstRegistrationId) : null) ??
			(shop?.gstin ? await this.company.findRegistrationByGstin(shop.gstin) : null);
		if (!registration) throw new BadRequestException('invoice_problem:no_gst_registration');
		const delivery = order.addresses?.delivery;
		const sellerState = registration.stateCode;
		const abroad = !!delivery?.country && !['IN', 'India'].includes(delivery.country);
		const placeOfSupply = abroad ? '96' : (delivery?.gstStateCode ?? sellerState);
		const interState = placeOfSupply !== sellerState;
		const inputs = [];
		for (const line of shipped) {
			const product = line.tax?.hsn ? null : await this.products.findById(line.productId).catch(() => null);
			inputs.push({
				lineId: line.lineId ?? line.sku,
				sku: line.sku,
				title: line.title['en'] ?? Object.values(line.title)[0] ?? line.sku,
				hsn: line.tax?.hsn ?? product?.hsnCode ?? null,
				quantity: line.quantity,
				unit: 'PCS' as const,
				lineTotalINR: line.lineTotalINR,
			});
		}
		// The delivery charge goes on the order's first invoice.
		const shippingINR = earlier.length ? 0 : (order.shipping?.chargeINR ?? 0);
		const built = buildInvoiceLines(inputs, { interState, shippingINR });
		const problem = built.problems[0];
		if (problem) {
			const sku = inputs.find((l) => l.lineId === problem.lineId)?.sku ?? '';
			throw new BadRequestException(`invoice_problem:${problem.problem}${sku ? `:${sku}` : ''}`);
		}
		const id = `ti_${randomUUID()}`;
		const date = istDay(input.at);
		const number = await this.numbers.issue('taxInvoice', context, new Date(input.at), registration.id);
		const costINR = shipped.reduce((sum, line) => sum + (line.unitCostINR ?? 0) * line.quantity, 0);
		const voucher = await this.ledger.post(
			{
				date,
				narration: `Tax invoice ${number} · order ${order.orderNumber}`,
				lines: invoicePosting({
					totals: built.totals,
					paidInAdvance: order.paymentStatus === 'paid',
					costINR,
				}).map((row) => ({ ledger: { systemKey: row.systemKey }, locationId: location.id, ...row })),
				source: { type: 'taxInvoice', id, number },
				idempotencyKey: `taxInvoice:${id}`,
			},
			context,
			input.actorId,
		);
		const invoice = TaxInvoice.parse({
			id,
			number,
			date,
			gstRegistrationId: registration.id,
			gstin: registration.gstin,
			locationId: location.id,
			orderId: order.id,
			orderNumber: order.orderNumber,
			shipmentId: input.shipmentId,
			seller: {
				name: shop?.tradeName || shop?.legalName || registration.gstin,
				gstin: registration.gstin,
				address: [location.address, location.city, location.pin].filter(Boolean).join(', '),
				stateCode: sellerState,
			},
			buyer: {
				name: order.buyer?.name ?? delivery?.fullName ?? 'Customer',
				gstin: order.buyer?.gstin ?? null,
				address: [delivery?.line1, delivery?.city, delivery?.postalCode].filter(Boolean).join(', '),
				stateCode: placeOfSupply,
			},
			placeOfSupply,
			interState,
			lines: built.lines,
			...built.totals,
			ratesPendingCa: true,
			voucherId: voucher.id,
			createdBy: input.actorId,
			createdAt: input.at,
		});
		await this.invoices.insert(invoice, context);
		return invoice;
	}
}
