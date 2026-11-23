import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { EInvoiceRecord, EWayBillRecord, Order, TaxInvoice } from '@saha-textile/contracts';
import {
	buildEInvoiceJson,
	type EDocParty,
	EDocRefusedError,
	type EDocumentOutcome,
	eInvoiceProblems,
	type EInvoicePort,
	type EInvoiceResult,
	type EWayBillPort,
	istDay,
	type LocationRepository,
	saleFromTaxInvoice,
	type ShopDetailsRepository,
	type TaxInvoiceRepository,
	toGovDate,
} from '@saha-textile/core-domain';

import { LOCATION_REPOSITORY, SHOP_DETAILS_REPOSITORY, TAX_INVOICE_REPOSITORY } from '../infra/tokens';
import { EDocsService } from './edocs.service';

/** NIC's "duplicate IRN" answer: the invoice is already registered, so its IRN is fetched instead (AE7). */
const DUPLICATE_IRN = '2150';

/**
 * The order page's Generate e-invoice / Generate e-way bill through the chosen path (addendum 2, AE1, AE7): the
 * by-hand path, untested keys or a connection that doesn't answer all return "notConnected", so the same button
 * opens the by-hand popup. An automatic e-invoice registers the order's tax invoice (D1), issued when a packed
 * order's Generate is pressed. An automatic e-way bill needs Part B from the courier booking, which isn't connected
 * yet, so it falls back to the by-hand popup and says why.
 */
@Injectable()
export class EDocsOrderBridge implements OnModuleInit {
	private status = { eInvoice: false, eWayBill: false };

	constructor(
		private readonly edocs: EDocsService,
		@Inject(TAX_INVOICE_REPOSITORY) private readonly invoices: Pick<TaxInvoiceRepository, 'listForOrder'>,
		@Inject(LOCATION_REPOSITORY) private readonly locations: Pick<LocationRepository, 'list'>,
		@Inject(SHOP_DETAILS_REPOSITORY) private readonly shop: Pick<ShopDetailsRepository, 'get'>,
	) {}

	async onModuleInit(): Promise<void> {
		await this.refresh().catch(() => undefined);
	}

	/** Whether each document has a working automatic path (the order page's "Connected" label). */
	async refresh(): Promise<void> {
		this.status = {
			eInvoice: !!(await this.edocs.automatic('eInvoice')),
			eWayBill: !!(await this.edocs.automatic('eWayBill')),
		};
	}

	connected(kind: 'eInvoice' | 'eWayBill'): boolean {
		return this.status[kind];
	}

	async raise<T>(order: Order, kind: 'eInvoice' | 'eWayBill'): Promise<EDocumentOutcome<T>> {
		const auto = await this.edocs.automatic(kind);
		await this.refresh();
		if (!auto) return { kind: 'notConnected' };
		const issued = (await this.invoices.listForOrder(order.id)).filter((i) => i.status === 'issued');
		const invoice = issued.find((i) => !i.shipmentId) ?? issued.at(-1) ?? null;
		const log = (ok: boolean, code: string | null, message: string | null, durationMs: number | null = null) =>
			this.edocs.log({
				gstin: auto.gstin,
				path: auto.path,
				action: 'generate',
				documentNumber: invoice?.number ?? order.orderNumber,
				ok,
				code,
				message,
				durationMs,
				by: 'system',
			});
		if (!invoice) {
			await log(
				false,
				'invoice_not_issued',
				'The tax invoice is issued when a packed order is generated; by hand until then',
			);
			return { kind: 'notConnected' };
		}
		if (kind === 'eWayBill' || auto.gateway.kind !== 'eInvoice') {
			await log(
				false,
				'part_b_needed',
				'Part B comes from the courier booking, which is not connected yet; by hand',
			);
			return { kind: 'notConnected' };
		}
		const settings = await this.edocs.settingsFor(auto.gstin);
		const sale = saleFromTaxInvoice(invoice, await this.parties(invoice, order));
		const problems = eInvoiceProblems(sale, {
			enabledFrom: settings.eInvoiceEnabledFrom ?? null,
			todayIst: istDay(new Date()),
		});
		if (problems.length) {
			await log(false, problems[0] ?? 'refused', problems.join(', '));
			return { kind: 'refused', message: problems.join(', ') };
		}
		const gateway = auto.gateway.gateway;
		const started = Date.now();
		let result: EInvoiceResult | null;
		try {
			result = await gateway.generate(auto.gstin, buildEInvoiceJson(sale));
		} catch (error) {
			if (error instanceof EDocRefusedError && error.code === DUPLICATE_IRN) {
				result = await gateway
					.byDocument(auto.gstin, 'INV', invoice.number, toGovDate(invoice.date))
					.catch(() => null);
			} else if (error instanceof EDocRefusedError) {
				await log(false, error.code, error.message, Date.now() - started);
				return { kind: 'refused', message: `${error.code}: ${error.message}` };
			} else {
				// A connection that doesn't answer: the by-hand popup, with the reason in the activity log (AE7).
				await log(
					false,
					'unreachable',
					error instanceof Error ? error.message : 'No answer',
					Date.now() - started,
				);
				return { kind: 'notConnected' };
			}
		}
		if (!result) {
			await log(
				false,
				'duplicate_not_found',
				'Registered before, but its IRN could not be fetched',
				Date.now() - started,
			);
			return { kind: 'notConnected' };
		}
		const record: Omit<EInvoiceRecord, 'by' | 'at'> = {
			irn: result.irn,
			ackNo: result.ackNo,
			ackDate: result.ackDate,
			signedQr: result.signedQr,
			source: 'api',
		};
		return { kind: 'raised', record: record as T };
	}

	/** Seller from the invoice's location and the business's names; buyer from the order's delivery address. */
	private async parties(invoice: TaxInvoice, order: Order): Promise<{ seller: EDocParty; buyer: EDocParty }> {
		const [allLocations, shop] = await Promise.all([this.locations.list(), this.shop.get()]);
		const location = allLocations.find((l) => l.id === invoice.locationId);
		const delivery = order.addresses?.delivery;
		return {
			seller: {
				gstin: invoice.gstin,
				legalName: shop?.legalName || invoice.seller.name,
				tradeName: shop?.tradeName || null,
				line1: (location?.address || invoice.seller.address).slice(0, 100),
				city: location?.city || 'NA',
				pin: location?.pin || '',
				stateCode: invoice.seller.stateCode,
				phone: location?.phone || shop?.phone || null,
				email: shop?.email || null,
			},
			buyer: {
				gstin: invoice.buyer.gstin,
				legalName: invoice.buyer.name,
				line1: (delivery?.line1 ?? invoice.buyer.address).slice(0, 100),
				line2: delivery?.line2 ?? null,
				city: delivery?.city ?? 'NA',
				pin: delivery?.postalCode ?? '',
				stateCode: invoice.placeOfSupply,
				phone: order.buyer?.mobile?.number ?? null,
				email: order.buyer?.email ?? null,
			},
		};
	}
}

/** The two ports the orders service already uses, both answered by the bridge. */
export const eInvoicePortFrom = (bridge: EDocsOrderBridge): EInvoicePort => ({
	get connected() {
		return bridge.connected('eInvoice');
	},
	raise: (order) => bridge.raise<Omit<EInvoiceRecord, 'by' | 'at'>>(order, 'eInvoice'),
});
export const eWayBillPortFrom = (bridge: EDocsOrderBridge): EWayBillPort => ({
	get connected() {
		return bridge.connected('eWayBill');
	},
	raise: (order) => bridge.raise<Omit<EWayBillRecord, 'by' | 'at'>>(order, 'eWayBill'),
});
