import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import {
	LABEL_SHEETS,
	code128Bars,
	code128Encodable,
	labelSlots,
	labelsPerSheet,
	sheetsNeeded,
	type LabelSheetKind,
} from '@saha-textile/core-domain/purchasing';
import { firstValueFrom } from 'rxjs';

import { RupeesPipe, apiProblem, saveBlob } from '@core/purchasing/purchasing-format';
import { PurchasingGateway } from '@core/purchasing/purchasing.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { PluralPipe } from '@shared/pipes/language.pipes';

import { LineSearch } from '../shared/line-search';

import type { LabelField, PurchaseItemOption } from '@saha-textile/contracts';

export interface LabelItem {
	variantId: string;
	sku: string;
	title: string;
	optionsLabel: string;
	soldBy: 'piece' | 'metre';
	priceINR: number;
	mrpINR: number | null;
	count: number;
}

export const SHEET_KINDS: readonly LabelSheetKind[] = ['a4_65', 'a4_40', 'a4_24', 'a4_21'];
export const LABEL_FIELDS: readonly LabelField[] = ['name', 'sku', 'barcode', 'price', 'mrp'];

/** One label per piece received; fabric by the metre prints one label per roll or cut, not per metre (l01). */
export function labelsForLine(accepted: number, soldBy: 'piece' | 'metre'): number {
	if (accepted <= 0) return 0;
	return soldBy === 'metre' ? 1 : accepted;
}

/** The bars of one label as an SVG path, in modules, with a quiet zone either side. */
export function barsPath(sku: string): { d: string; width: number } | null {
	if (!code128Encodable(sku)) return null;
	const { bars, modules } = code128Bars(sku);
	return { d: bars.map((bar) => `M${bar.x + 10} 0h${bar.width}v30h-${bar.width}z`).join(''), width: modules + 20 };
}

/**
 * Print barcode labels on A4 sheets (l01, P10): opened from a posted entry with one label per
 * piece received; any other item can be added, so one print holds many items on one sheet. Start
 * at label skips used labels on a part-used sheet. The PDF is drawn by the server to the sheet's
 * exact sizes; the preview here uses the same geometry and barcode.
 */
@Component({
	selector: 'app-label-sheet',
	templateUrl: './label-sheet.html',
	imports: [FormsModule, LineSearch, PageWrapper, PluralPipe, RouterModule, RupeesPipe, TranslocoModule],
})
export class LabelSheet {
	private readonly route = inject(ActivatedRoute);
	private readonly gateway = inject(PurchasingGateway);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly entryId = signal<string | null>(this.route.snapshot.paramMap.get('id'));
	readonly entryNumber = signal<string | null>(null);
	readonly kinds = SHEET_KINDS;
	readonly fieldsList = LABEL_FIELDS;
	readonly sheet = signal<LabelSheetKind>('a4_65');
	readonly startAt = signal(1);
	readonly fields = signal<ReadonlySet<LabelField>>(new Set(LABEL_FIELDS));
	readonly items = signal<LabelItem[]>([]);
	readonly busy = signal(false);

	readonly geometry = computed(() => LABEL_SHEETS[this.sheet()]);
	readonly perSheet = computed(() => labelsPerSheet(this.sheet()));
	readonly total = computed(() =>
		this.items().reduce((sum, item) => sum + Math.max(0, Math.floor(item.count) || 0), 0),
	);
	readonly sheets = computed(() => sheetsNeeded(this.sheet(), this.startAt(), this.total()));
	/** The first sheet as it will print: used labels hatched, then the labels in order, then blanks. */
	readonly preview = computed(() => {
		const perSheet = this.perSheet();
		const start = Math.min(Math.max(1, this.startAt()), perSheet);
		const flat: LabelItem[] = [];
		for (const item of this.items()) for (let i = 0; i < item.count; i += 1) flat.push(item);
		const slots = labelSlots(this.sheet(), start, flat.length);
		const cells: Array<{
			kind: 'used' | 'label' | 'blank';
			item?: LabelItem;
			bars?: { d: string; width: number } | null;
		}> = [];
		for (let position = 1; position <= perSheet; position += 1) {
			if (position < start) {
				cells.push({ kind: 'used' });
				continue;
			}
			const index = slots.findIndex((slot) => slot.sheet === 0 && slot.position === position);
			const item = index >= 0 ? flat[index] : undefined;
			cells.push(
				item
					? { kind: 'label', item, bars: this.fields().has('barcode') ? barsPath(item.sku) : null }
					: { kind: 'blank' },
			);
		}
		return cells;
	});

	constructor() {
		const id = this.entryId();
		if (id) void this.fromEntry(id);
	}

	private async fromEntry(id: string): Promise<void> {
		try {
			const entry = await firstValueFrom(this.gateway.entry(id));
			this.entryNumber.set(entry.number);
			this.items.set(
				entry.lines
					.map((line) => ({
						variantId: line.variantId,
						sku: line.sku,
						title: line.title,
						optionsLabel: line.optionsLabel,
						soldBy: line.soldBy,
						priceINR: line.sellingPriceINR,
						mrpINR: null,
						count: labelsForLine(line.accepted ?? 0, line.soldBy),
					}))
					.filter((item) => item.count > 0),
			);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	add(option: PurchaseItemOption): void {
		this.items.update((items) => {
			const at = items.findIndex((item) => item.variantId === option.variantId);
			if (at >= 0) return items.map((item, i) => (i === at ? { ...item, count: item.count + 1 } : item));
			return [
				...items,
				{
					variantId: option.variantId,
					sku: option.sku,
					title: option.title,
					optionsLabel: option.optionsLabel,
					soldBy: option.soldBy,
					priceINR: option.sellingPriceINR,
					mrpINR: option.mrpINR,
					count: 1,
				},
			];
		});
	}

	setCount(index: number, value: string | number): void {
		const count = Math.max(0, Math.min(1000, Math.floor(Number(value)) || 0));
		this.items.update((items) => items.map((item, i) => (i === index ? { ...item, count } : item)));
	}

	remove(index: number): void {
		this.items.update((items) => items.filter((_, i) => i !== index));
	}

	toggle(field: LabelField): void {
		this.fields.update((fields) => {
			const next = new Set(fields);
			if (next.has(field)) next.delete(field);
			else next.add(field);
			return next;
		});
	}

	setStart(value: string | number): void {
		this.startAt.set(Math.min(Math.max(1, Math.floor(Number(value)) || 1), this.perSheet()));
	}

	setSheet(kind: LabelSheetKind): void {
		this.sheet.set(kind);
		this.setStart(this.startAt());
	}

	canPrint(): boolean {
		return !this.busy() && this.total() > 0 && this.total() <= 2000 && this.fields().size > 0;
	}

	async print(): Promise<void> {
		if (!this.canPrint()) return;
		this.busy.set(true);
		try {
			const blob = await firstValueFrom(
				this.gateway.labelsPdf({
					sheet: this.sheet(),
					startAt: this.startAt(),
					fields: [...this.fields()],
					items: this.items()
						.filter((item) => item.count > 0)
						.map((item) => ({ variantId: item.variantId, count: item.count })),
					...(this.entryId() ? { purchaseEntryId: this.entryId() as string } : {}),
				}),
			);
			saveBlob(`barcode-labels-${this.total()}.pdf`, blob);
		} catch (error) {
			this.notifier.showError(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
