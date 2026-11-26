import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';

import {
	BAND_FIELDS,
	NODE_MENU,
	blockId,
	fieldKey,
	newCondition,
	newGroup,
	newNode,
	newResult,
	type NodeKind,
	type ResultKind,
} from '@core/shipping/blocks';

import { SrbGroup, type SrbCategoryOption } from './srb-group';

import type {
	ShippingAmountSource,
	ShippingBand,
	ShippingBandField,
	ShippingBandsNode,
	ShippingChargeKind,
	ShippingIfNode,
	ShippingNode,
	ShippingResult,
	ShippingResultNode,
	ShippingStep,
} from '@saha-textile/contracts';

/** What each band field is measured in: grams, rupees or a count. */
const BAND_UNITS: Readonly<Record<ShippingBandField, string>> = {
	'line.quantity': '#',
	'line.sellingPrice': '₹',
	'line.chargeableWeight': 'g',
	'cart.subtotal': '₹',
	'cart.units': '#',
	'cart.lines': '#',
	'cart.chargeableWeight': 'g',
};

/**
 * One block of the rule builder and everything inside it (brief rb02–rb10): an empty slot with
 * "Add a block inside", an "If … otherwise" decision, "Choose by value" bands, or a result (an
 * amount, the product's own charge, first and further units, a percentage, free, can't ship, a
 * courier quote). Edits are emitted upward as a new block; nothing here keeps state.
 */
@Component({
	selector: 'app-srb-node',
	templateUrl: './srb-node.html',
	imports: [FormsModule, NgbDropdownModule, TranslocoModule, SrbGroup],
})
export class SrbNode {
	readonly node = input.required<ShippingNode | null>();
	readonly scope = input.required<ShippingStep['scope']>();
	readonly readOnly = input(false);
	readonly errorIds = input<ReadonlySet<string>>(new Set());
	readonly categories = input<readonly SrbCategoryOption[]>([]);
	/** The shop's languages, for a can't-ship message. */
	readonly languages = input<readonly string[]>(['en']);
	/** The label of the slot this block fills: Then, Otherwise, a band. */
	readonly slot = input('ship_kw_then');
	/** The id the checks use for this slot when it is empty (`if-x:then`, a band id, a step id). */
	readonly slotId = input('');
	/** "₹100 on every category" beside a product charge (brief rb02, rb03), by charge. */
	readonly hints = input<Partial<Record<ShippingChargeKind, string>>>({});
	readonly nodeChange = output<ShippingNode | null>();

	readonly menu = NODE_MENU;
	readonly bandFields = BAND_FIELDS;
	readonly fieldKey = fieldKey;
	/** What the "Then" select offers (brief rb02): "Charge" covers an amount and the product's own charge. */
	readonly kindChoices = ['charge', 'firstAndFurther', 'percent', 'free', 'cantShip', 'courierQuote'] as const;
	readonly charges: ShippingChargeKind[] = ['domestic', 'internationalFirst', 'internationalFurther'];

	add(kind: NodeKind) {
		this.nodeChange.emit(newNode(kind));
	}

	asIf(node: ShippingNode): ShippingIfNode {
		return node as ShippingIfNode;
	}

	asBands(node: ShippingNode): ShippingBandsNode {
		return node as ShippingBandsNode;
	}

	asResult(node: ShippingNode): ShippingResultNode {
		return node as ShippingResultNode;
	}

	patchIf(node: ShippingIfNode, change: Partial<ShippingIfNode>) {
		this.nodeChange.emit({ ...node, ...change });
	}

	patchBands(node: ShippingBandsNode, change: Partial<ShippingBandsNode>) {
		this.nodeChange.emit({ ...node, ...change });
	}

	patchBand(node: ShippingBandsNode, index: number, change: Partial<ShippingBand>) {
		const bands = node.bands.map((band, i) => (i === index ? { ...band, ...change } : band));
		this.patchBands(node, { bands });
	}

	addBand(node: ShippingBandsNode) {
		const last = node.bands[node.bands.length - 1];
		const from = last?.to ?? null;
		this.patchBands(node, { bands: [...node.bands, { id: blockId('band'), from, to: null, then: null }] });
	}

	/** The unit a band field is measured in, for "From (g)" (brief rb10); a band with no field yet counts. */
	bandUnit(node: ShippingBandsNode): string {
		return node.field ? BAND_UNITS[node.field] : '#';
	}

	/** A band whose charge is a plain amount shows just the ₹ box in its row (brief rb10). */
	simpleAmount(node: ShippingNode | null): { amount: number | null; per: 'once' | 'unit' | 'kg' } | null {
		if (node?.kind !== 'result' || node.result.kind !== 'amount') return null;
		return { amount: node.result.amount, per: node.result.per };
	}

	setBandAmount(node: ShippingBandsNode, index: number, current: { per: 'once' | 'unit' | 'kg' }, value: unknown) {
		const band = node.bands[index];
		if (!band || band.then?.kind !== 'result') return;
		this.patchBand(node, index, {
			then: { ...band.then, result: { kind: 'amount', amount: this.numberOrNull(value), per: current.per } },
		});
	}

	removeBand(node: ShippingBandsNode, index: number) {
		this.patchBands(node, { bands: node.bands.filter((_, i) => i !== index) });
	}

	numberOrNull(value: unknown): number | null {
		const n = Number(value);
		return value === '' || value === null || !Number.isFinite(n) ? null : n;
	}

	setKind(node: ShippingResultNode, kind: ResultKind) {
		this.nodeChange.emit({ ...node, result: newResult(kind) });
	}

	kindOf(result: ShippingResult): (typeof this.kindChoices)[number] {
		return result.kind === 'amount' || result.kind === 'productCharge' ? 'charge' : result.kind;
	}

	setKindChoice(node: ShippingResultNode, choice: (typeof this.kindChoices)[number]) {
		if (choice === this.kindOf(node.result)) return;
		this.setKind(node, choice === 'charge' ? 'productCharge' : choice);
	}

	/** "the product's domestic charge" … or "an amount" (brief rb02, rb06). */
	chargeSource(result: ShippingResult): string {
		return result.kind === 'productCharge' ? `product:${result.charge}` : 'amount';
	}

	setChargeSource(node: ShippingResultNode, value: string) {
		const per = 'per' in node.result ? node.result.per : 'unit';
		if (value === 'amount') {
			const amount = node.result.kind === 'amount' ? node.result.amount : null;
			this.nodeChange.emit({ ...node, result: { kind: 'amount', amount, per } });
			return;
		}
		const charge = value.replace('product:', '') as ShippingChargeKind;
		this.nodeChange.emit({
			...node,
			result: { kind: 'productCharge', charge, per: per === 'kg' ? 'unit' : per },
		});
	}

	/** "Add condition (and / or)" sits at the bottom of the decision (brief rb02). */
	addCondition(node: ShippingIfNode) {
		this.patchIf(node, { when: { ...node.when, items: [...node.when.items, newCondition()] } });
	}

	addGroup(node: ShippingIfNode) {
		const join = node.when.join === 'all' ? 'any' : 'all';
		this.patchIf(node, { when: { ...node.when, items: [...node.when.items, newGroup(join)] } });
	}

	setJoin(node: ShippingIfNode, join: 'all' | 'any') {
		this.patchIf(node, { when: { ...node.when, join } });
	}

	patchResult(node: ShippingResultNode, change: Partial<ShippingResult>) {
		this.nodeChange.emit({ ...node, result: { ...node.result, ...change } as ShippingResult });
	}

	/** A first or further amount: the product's own charge, or a typed one. */
	sourceValue(source: ShippingAmountSource): string {
		return source.from === 'fixed' ? 'fixed' : source.charge;
	}

	setSource(node: ShippingResultNode, side: 'first' | 'further', value: string, current: ShippingAmountSource) {
		const next: ShippingAmountSource =
			value === 'fixed'
				? { from: 'fixed', amount: current.from === 'fixed' ? current.amount : null }
				: { from: 'product', charge: value as ShippingChargeKind };
		this.patchResult(node, { [side]: next } as Partial<ShippingResult>);
	}

	setSourceAmount(node: ShippingResultNode, side: 'first' | 'further', amount: unknown) {
		this.patchResult(node, {
			[side]: { from: 'fixed', amount: this.numberOrNull(amount) },
		} as Partial<ShippingResult>);
	}

	setMessage(node: ShippingResultNode, language: string, text: string, current: Record<string, string>) {
		this.patchResult(node, { message: { ...current, [language]: text } } as Partial<ShippingResult>);
	}

	remove() {
		this.nodeChange.emit(null);
	}

	/** A language's name in its own script (English, বাংলা), whatever the admin's language. */
	languageName(code: string): string {
		try {
			// With the default fallback ('code'), of() answers a name or the code itself, never undefined.
			return new Intl.DisplayNames([code], { type: 'language' }).of(code) as string;
		} catch {
			return code;
		}
	}

	asAny(value: unknown): Record<string, unknown> {
		return value as Record<string, unknown>;
	}
}
