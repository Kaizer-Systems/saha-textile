/**
 * Roles (accounts templates T1, owner-approved 2026-11-24): posting rules post to a role, never to a named ledger.
 * Which ledger or group plays a role is the company's books (installed from a template); this file holds only the list
 * of roles the engine knows and how a role is found. Today's system keys are the first roles, so books seeded before
 * roles existed resolve through their system keys.
 */

export interface RoleDefinition {
	key: string;
	/** A ledger is posted to; a group classifies (cash, bank). */
	target: 'ledger' | 'group';
	/** The documents that cannot post until the role has a ledger. */
	neededBy: readonly string[];
}

const ledger = (key: string, ...neededBy: string[]): RoleDefinition => ({ key, target: 'ledger', neededBy });
const group = (key: string): RoleDefinition => ({ key, target: 'group', neededBy: ['receipt', 'payment', 'contra'] });

/** Every role a posting rule uses today. */
export const ROLE_REGISTRY: readonly RoleDefinition[] = [
	ledger('sales', 'taxInvoice'),
	ledger('sales_returns', 'creditNote', 'debitNote'),
	ledger('output_cgst', 'taxInvoice', 'creditNote', 'debitNote'),
	ledger('output_sgst', 'taxInvoice', 'creditNote', 'debitNote'),
	ledger('output_igst', 'taxInvoice', 'creditNote', 'debitNote'),
	ledger('input_cgst', 'inputTaxReversal', 'purchaseEntry', 'purchaseReturn'),
	ledger('input_sgst', 'inputTaxReversal', 'purchaseEntry', 'purchaseReturn'),
	ledger('input_igst', 'purchaseEntry', 'purchaseReturn'),
	ledger('debtors_control', 'taxInvoice', 'creditNote', 'debitNote', 'creditNoteRefund', 'receipt'),
	ledger('customer_advances', 'taxInvoice', 'refundVoucher', 'receipt'),
	ledger('cost_of_goods_sold', 'taxInvoice', 'creditNote', 'debitNote'),
	ledger('stock_in_hand', 'taxInvoice', 'creditNote', 'debitNote', 'purchaseEntry', 'purchaseReturn'),
	ledger('stock_loss', 'inputTaxReversal'),
	ledger('rounding_off', 'taxInvoice', 'creditNote', 'debitNote', 'purchaseEntry', 'purchaseReturn'),
	ledger('gateway_clearing', 'refundVoucher', 'creditNoteRefund', 'receipt'),
	ledger('upi_card_clearing', 'receipt'),
	ledger('cod_receivable', 'receipt'),
	ledger('creditors_control', 'selfInvoice', 'paymentVoucher', 'purchaseEntry', 'purchaseReturn', 'supplierPayment'),
	ledger('input_gst_rcm', 'selfInvoice'),
	ledger('rcm_payable', 'selfInvoice'),
	ledger('cash', 'paymentVoucher', 'supplierPayment'),
	group('cash_in_hand'),
	group('bank_accounts'),
	group('bank_od'),
];

interface RoleHolder {
	id: string;
	systemKey: string | null;
	roles?: readonly string[];
	active?: boolean;
}

/** The roles an installed ledger or group plays: its own list, else the role its system key names. */
export function rolesOf(holder: Pick<RoleHolder, 'systemKey' | 'roles'>): string[] {
	if (holder.roles?.length) return [...holder.roles];
	return holder.systemKey ? [holder.systemKey] : [];
}

/**
 * The one active ledger (or group) playing a role. Refused with `role_not_mapped:<role>` when none does, and with
 * `role_ambiguous:<role>` when several do, so a posting never guesses.
 */
export function resolveRole<T extends RoleHolder>(holders: readonly T[], role: string): T {
	const found = holders.filter((h) => h.active !== false && rolesOf(h).includes(role));
	if (found.length > 1) throw new Error(`role_ambiguous:${role}`);
	const [only] = found;
	if (!only) throw new Error(`role_not_mapped:${role}`);
	return only;
}

/** The roles a document needs that the books don't map yet (checked before a template is published or installed). */
export function missingRoles(
	chart: { ledgers: readonly RoleHolder[]; groups: readonly RoleHolder[] },
	documentType: string,
): string[] {
	return ROLE_REGISTRY.filter((role) => role.neededBy.includes(documentType))
		.filter((role) => {
			const holders = role.target === 'ledger' ? chart.ledgers : chart.groups;
			return !holders.some((h) => h.active !== false && rolesOf(h).includes(role.key));
		})
		.map((role) => role.key);
}

/** The roles list of a ledger that plays none (an empty list would fall back to its system key). */
export const PLAYS_NO_ROLE = 'none';

/** AT4: the roles a ledger plays once it also plays this one. */
export function withRole(holder: Pick<RoleHolder, 'systemKey' | 'roles'>, role: string): string[] {
	return [...new Set([...rolesOf(holder).filter((r) => r !== PLAYS_NO_ROLE), role])];
}

/** AT4: the roles a ledger plays once another ledger takes this one over. */
export function withoutRole(holder: Pick<RoleHolder, 'systemKey' | 'roles'>, role: string): string[] {
	const roles = rolesOf(holder).filter((r) => r !== role);
	return roles.length ? roles : [PLAYS_NO_ROLE];
}
