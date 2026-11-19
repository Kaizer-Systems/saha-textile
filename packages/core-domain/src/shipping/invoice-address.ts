import type { AbroadOrderPolicy } from '@saha-textile/contracts';

/**
 * Which address the GST invoice is made out to, by the named "orders sent abroad" path
 * (owner, 2026-11-19). Saha Textile runs `exportOffIndianInvoice`; nothing here is specific to
 * one business, only to the path chosen in settings.
 */

export interface InvoiceAddressLike {
	fullName: string;
	line1: string;
	line2?: string | null;
	city: string;
	state?: string | null;
	postalCode: string;
	/** ISO 3166-1 alpha-2. The "Address in India" step has no country field; it is the home country. */
	country: string;
}

export type InvoiceAddressSource = 'billing' | 'delivery' | 'givenAtCheckout' | 'addedByStaff';

export interface InvoiceAddressInput {
	policy: AbroadOrderPolicy;
	homeCountry: string;
	billing: InvoiceAddressLike;
	delivery: InvoiceAddressLike;
	/** The optional "Address in India" from checkout, as typed (may be partial). */
	givenAtCheckout: Partial<InvoiceAddressLike> | null;
	/** Added by staff on the order after contacting the shopper. Wins over the checkout one. */
	addedByStaff: Partial<InvoiceAddressLike> | null;
}

export type InvoiceAddressDecision =
	| { status: 'ready'; source: InvoiceAddressSource; address: InvoiceAddressLike }
	/** Staff-only "Invoice address needed": the order can't be marked Packed until it is ready. */
	| { status: 'needed'; partial: Partial<InvoiceAddressLike> | null; missing: InvoiceAddressField[] }
	/** `standardExport` is designed but not built; `indiaOnly` never accepts a delivery abroad. */
	| { status: 'notAllowed'; reason: 'standardExportNotBuilt' | 'deliveryAbroadRefused' };

export type InvoiceAddressField = 'fullName' | 'line1' | 'city' | 'state' | 'postalCode';

const same = (a: string, b: string): boolean => a.trim().toUpperCase() === b.trim().toUpperCase();
const filled = (value: string | null | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

/** What an address in the home country still lacks: name, street, city, state, and a 6-digit PIN code. */
export function missingInvoiceFields(address: Partial<InvoiceAddressLike> | null): InvoiceAddressField[] {
	const missing: InvoiceAddressField[] = [];
	if (!filled(address?.fullName)) missing.push('fullName');
	if (!filled(address?.line1)) missing.push('line1');
	if (!filled(address?.city)) missing.push('city');
	if (!filled(address?.state)) missing.push('state');
	if (!/^\d{6}$/.test((address?.postalCode ?? '').replace(/\s+/g, ''))) missing.push('postalCode');
	return missing;
}

export function isCompleteIndianAddress(address: Partial<InvoiceAddressLike> | null): boolean {
	return missingInvoiceFields(address).length === 0;
}

const asHome = (address: Partial<InvoiceAddressLike>, homeCountry: string): InvoiceAddressLike => ({
	fullName: (address.fullName ?? '').trim(),
	line1: (address.line1 ?? '').trim(),
	line2: address.line2 ?? null,
	city: (address.city ?? '').trim(),
	state: address.state ?? null,
	postalCode: (address.postalCode ?? '').replace(/\s+/g, ''),
	country: homeCountry,
});

export function decideInvoiceAddress(input: InvoiceAddressInput): InvoiceAddressDecision {
	const { policy, homeCountry, billing, delivery } = input;
	const deliveryHome = same(delivery.country, homeCountry);

	if (policy === 'standardExport') return { status: 'notAllowed', reason: 'standardExportNotBuilt' };
	if (policy === 'indiaOnly') {
		return deliveryHome
			? { status: 'ready', source: 'billing', address: billing }
			: { status: 'notAllowed', reason: 'deliveryAbroadRefused' };
	}

	// exportOffIndianInvoice: every order is invoiced to an address in the home country.
	if (same(billing.country, homeCountry)) return { status: 'ready', source: 'billing', address: billing };
	if (deliveryHome) return { status: 'ready', source: 'delivery', address: delivery };
	if (input.addedByStaff && isCompleteIndianAddress(input.addedByStaff)) {
		return { status: 'ready', source: 'addedByStaff', address: asHome(input.addedByStaff, homeCountry) };
	}
	if (input.givenAtCheckout && isCompleteIndianAddress(input.givenAtCheckout)) {
		return { status: 'ready', source: 'givenAtCheckout', address: asHome(input.givenAtCheckout, homeCountry) };
	}
	const partial = input.addedByStaff ?? input.givenAtCheckout;
	return { status: 'needed', partial, missing: missingInvoiceFields(partial) };
}

/** Whether checkout shows the optional "Address in India" step: only when no address there exists yet. */
export function asksForAddressInHomeCountry(
	policy: AbroadOrderPolicy,
	homeCountry: string,
	billingCountry: string,
	deliveryCountry: string,
): boolean {
	return (
		policy === 'exportOffIndianInvoice' && !same(billingCountry, homeCountry) && !same(deliveryCountry, homeCountry)
	);
}
