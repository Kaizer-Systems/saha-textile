import { z } from 'zod';

import { Id, IsoDateTime } from './common';
import { Gstin, HOME_GST_STATE, gstStateName, panFromGstin } from './gst';

/**
 * Settings › Shop details (purchases brief revision 3, R3-1; owner round 2026-11-18): how the
 * shop names itself on business documents. Purchase orders print it now; debit notes, delivery
 * challans and tax invoices will. Names and addresses are printed as typed, never translated.
 *
 * One record for the shop. Its GSTIN's State is the home State for purchase tax (CGST + SGST
 * from suppliers in the same State, IGST from others); until a GSTIN is saved it stays
 * `HOME_GST_STATE` (West Bengal, 19).
 */
export const ShopDetails = z.object({
	legalName: z.string().trim().max(200).default(''),
	tradeName: z.string().trim().max(200).default(''),
	gstin: z.string().trim().max(15).nullable().default(null),
	/** The principal place of business, as on the registration; several lines allowed. */
	address: z.string().trim().max(400).default(''),
	city: z.string().trim().max(100).default(''),
	pin: z.string().trim().max(6).default(''),
	phone: z.string().trim().max(30).default(''),
	email: z.string().trim().max(200).default(''),
	updatedAt: IsoDateTime.nullable().default(null),
	updatedBy: Id.nullable().default(null),
});
export type ShopDetails = z.infer<typeof ShopDetails>;

export const EMPTY_SHOP_DETAILS: ShopDetails = ShopDetails.parse({});

const Pin = z
	.string()
	.trim()
	.regex(/^[1-9]\d{5}$/, { message: 'pin_shape' });

/** An Indian phone as printed on a document: digits, spaces, +, -, brackets; 8–15 digits in all. */
const DocumentPhone = z
	.string()
	.trim()
	.max(30)
	.refine((value) => value === '' || /^[+\d][\d\s()-]*$/.test(value), { message: 'phone_shape' })
	.refine(
		(value) => {
			const digits = value.replace(/\D/g, '').length;
			return value === '' || (digits >= 8 && digits <= 15);
		},
		{ message: 'phone_shape' },
	);

const DocumentEmail = z
	.string()
	.trim()
	.max(200)
	.refine((value) => value === '' || z.email().safeParse(value).success, { message: 'email_shape' });

/**
 * A save from X04. GSTIN, legal name, address, city and PIN are required (the drawing's starred
 * rows); trade name, phone and email may be empty. `expectedUpdatedAt` is the copy the editor
 * read: a save over a newer copy is refused with who saved it and when.
 */
export const ShopDetailsWrite = z.object({
	legalName: z.string().trim().min(1).max(200),
	tradeName: z.string().trim().max(200).default(''),
	gstin: Gstin,
	address: z.string().trim().min(1).max(400),
	city: z.string().trim().min(1).max(100),
	pin: Pin,
	phone: DocumentPhone.default(''),
	email: DocumentEmail.default(''),
	expectedUpdatedAt: IsoDateTime.nullable().default(null),
});
export type ShopDetailsWrite = z.infer<typeof ShopDetailsWrite>;

/** The fields X04 lists as missing while the record is not filled in. */
export const SHOP_DETAILS_REQUIRED = ['gstin', 'legalName', 'address', 'city', 'pin'] as const;
export type ShopDetailsRequiredField = (typeof SHOP_DETAILS_REQUIRED)[number];

/** X04 / X04D as one reader sees it: the record, what is read from the GSTIN, and whether they may change it. */
export const ShopDetailsView = ShopDetails.extend({
	stateCode: z.string().nullable(),
	stateName: z.string().nullable(),
	pan: z.string().nullable(),
	/** The State purchase tax is worked out from (the GSTIN's, or West Bengal while none is saved). */
	homeStateCode: z.string(),
	homeStateName: z.string(),
	missing: z.array(z.enum(SHOP_DETAILS_REQUIRED)),
	canEdit: z.boolean(),
	updatedByName: z.string().nullable(),
	/** The Brand Kit's full logo and shop name: shown on the page, changed in the Brand Kit. */
	logoUrl: z.string().nullable(),
	brandShopName: z.string(),
});
export type ShopDetailsView = z.infer<typeof ShopDetailsView>;

/**
 * X04 and X04B: a typed GSTIN checked by the server (the admin cannot load this package's code),
 * and, when it reads, what it would change: the State and the suppliers whose tax type moves.
 */
export const ShopDetailsImpact = z.object({
	/** Null when the GSTIN reads; otherwise why not (the right last character for a wrong check digit). */
	problem: z.enum(['shape', 'state', 'check_digit']).nullable(),
	expectedLastCharacter: z.string().nullable(),
	pan: z.string().nullable(),
	stateFrom: z.object({ code: z.string(), name: z.string() }),
	stateTo: z.object({ code: z.string(), name: z.string() }).nullable(),
	stateChanges: z.boolean(),
	/** Suppliers whose bills move from IGST to CGST + SGST (now in the shop's State). */
	toIntraState: z.array(z.object({ id: Id, name: z.string() })),
	/** Suppliers whose bills move from CGST + SGST to IGST. */
	toInterState: z.array(z.object({ id: Id, name: z.string() })),
});
export type ShopDetailsImpact = z.infer<typeof ShopDetailsImpact>;

/** The shop as one document prints it: kept on a purchase order when it is sent, so its PDF never changes. */
export const ShopOnDocument = z.object({
	legalName: z.string(),
	tradeName: z.string(),
	gstin: z.string().nullable(),
	addressLines: z.array(z.string()),
	phone: z.string(),
	email: z.string(),
});
export type ShopOnDocument = z.infer<typeof ShopOnDocument>;

/** The home State for purchase tax: the saved GSTIN's, else West Bengal (19). */
export function homeGstStateOf(details: Pick<ShopDetails, 'gstin'> | null): string {
	const gstin = details?.gstin?.trim();
	return gstin && gstin.length >= 2 && gstStateName(gstin.slice(0, 2)) ? gstin.slice(0, 2) : HOME_GST_STATE;
}

/** Which required fields are still empty. */
export function shopDetailsMissing(details: ShopDetails): ShopDetailsRequiredField[] {
	return SHOP_DETAILS_REQUIRED.filter((field) => !details[field]);
}

/**
 * The lines a document prints for the shop. The legal name falls back to the Brand Kit's shop
 * name while shop details are not filled in; the trade name only when it differs.
 */
export function shopOnDocument(details: ShopDetails, brandShopName: string): ShopOnDocument {
	const stateName = details.gstin ? gstStateName(details.gstin.slice(0, 2)) : null;
	const place = [details.city, [stateName, details.pin].filter(Boolean).join(' ')].filter(Boolean).join(', ');
	return {
		legalName: details.legalName || brandShopName,
		tradeName:
			details.tradeName && details.tradeName.toLowerCase() !== details.legalName.toLowerCase()
				? details.tradeName
				: '',
		gstin: details.gstin,
		addressLines: [
			...details.address
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean),
			place,
		].filter(Boolean),
		phone: details.phone,
		email: details.email,
	};
}

/** The PAN inside the saved GSTIN, or null. */
export function shopPan(details: Pick<ShopDetails, 'gstin'>): string | null {
	return details.gstin ? panFromGstin(details.gstin) : null;
}
