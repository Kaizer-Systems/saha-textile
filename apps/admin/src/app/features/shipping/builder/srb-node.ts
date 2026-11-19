import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';

import {
	BAND_FIELDS,
	NODE_MENU,
	blockId,
	fieldKey,
	newNode,
	newResult,
	type NodeKind,
	type ResultKind,
} from '@core/shipping/blocks';

import { SrbGroup, type SrbCategoryOption } from './srb-group';

import type {
	ShippingAmountSource,
	ShippingBand,
	ShippingBandsNode,
	ShippingChargeKind,
	ShippingIfNode,
	ShippingNode,
	ShippingResult,
	ShippingResultNode,
	ShippingStep,
} from '@saha-textile/contracts';

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
	readonly nodeChange = output<ShippingNode | null>();

	readonly menu = NODE_MENU;
	readonly bandFields = BAND_FIELDS;
	readonly fieldKey = fieldKey;
	readonly resultKinds: ResultKind[] = [
		'amount',
		'productCharge',
		'firstAndFurther',
		'percent',
		'free',
		'cantShip',
		'courierQuote',
	];
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
			return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
		} catch {
			return code;
		}
	}

	asAny(value: unknown): Record<string, unknown> {
		return value as Record<string, unknown>;
	}
}
