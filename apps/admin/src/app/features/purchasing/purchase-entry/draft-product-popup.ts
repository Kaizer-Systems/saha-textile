import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { catchError, firstValueFrom, of } from 'rxjs';

import { apiIssues, apiProblem } from '@core/purchasing/purchasing-format';
import { PurchasingGateway, type DraftProductDefaults } from '@core/purchasing/purchasing.gateway';
import { CategoryService } from '@data-access/services/category.service';

import type { AdminCategoryRow, PurchaseItemOption } from '@saha-textile/contracts';

/** Every category with its full path ("Sarees › Silk › Banarasi"), in the reader's language, sorted. */
export function categoryPaths(rows: readonly AdminCategoryRow[], lang: string): Array<{ id: string; label: string }> {
	const byId = new Map(rows.map((row) => [row.id, row]));
	const nameOf = (row: AdminCategoryRow) => row.name[lang] || row.name['en'] || row.slug;
	const pathOf = (row: AdminCategoryRow): string => {
		const names: string[] = [];
		const seen = new Set<string>();
		let current: AdminCategoryRow | undefined = row;
		while (current && !seen.has(current.id)) {
			seen.add(current.id);
			names.unshift(nameOf(current));
			current = current.parentId ? byId.get(current.parentId) : undefined;
		}
		return names.join(' › ');
	};
	return rows.map((row) => ({ id: row.id, label: pathOf(row) })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Whole rupees as typed ("15,500") → a positive whole number, or null. */
export function wholeRupees(text: string): number | null {
	const cleaned = text.replace(/[₹,\s]/g, '');
	if (!/^\d+$/.test(cleaned)) return null;
	const value = Number(cleaned);
	return value > 0 ? value : null;
}

/**
 * A new design that arrived in the parcel (p05): a draft product with the minimum the bill needs.
 * HSN and "can be returned" come from the category (the 15 Nov rule); the SKU is the next number
 * for the category's prefix. It stays a draft: photos, text in every language and Go Live happen
 * in the product form as for any product.
 */
@Component({
	selector: 'app-draft-product-popup',
	templateUrl: './draft-product-popup.html',
	imports: [FormsModule, TranslocoModule],
})
export class DraftProductPopup {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(PurchasingGateway);
	private readonly categories = inject(CategoryService);
	private readonly transloco = inject(TranslocoService);

	private readonly rows = toSignal(
		this.categories.getCategoryRows().pipe(catchError(() => of([] as AdminCategoryRow[]))),
		{
			initialValue: [] as AdminCategoryRow[],
		},
	);
	readonly categoryOptions = computed(() => categoryPaths(this.rows(), this.transloco.getActiveLang()));

	readonly name = signal('');
	readonly categoryId = signal('');
	readonly defaults = signal<DraftProductDefaults | null>(null);
	readonly typedPrefix = signal('');
	readonly selling = signal('');
	readonly mrp = signal('');
	readonly code = signal('');
	readonly saving = signal(false);
	readonly error = signal<string | null>(null);
	readonly fieldErrors = signal<Record<string, string>>({});
	private supplierId: string | null = null;

	readonly sellingValue = computed(() => wholeRupees(this.selling()));
	readonly mrpValue = computed(() => (this.mrp().trim() ? wholeRupees(this.mrp()) : null));
	/** MRP under the selling price can't be printed on a tag (Legal Metrology). */
	readonly mrpProblem = computed(() => {
		if (!this.mrp().trim()) return null;
		const mrp = this.mrpValue();
		if (mrp === null) return 'whole_rupees_only';
		const selling = this.sellingValue();
		return selling !== null && mrp < selling ? 'mrp_below_selling' : null;
	});
	readonly needsPrefix = computed(() => !!this.categoryId() && !!this.defaults() && !this.defaults()?.skuPrefix);
	readonly canSave = computed(
		() =>
			!this.saving() &&
			!!this.name().trim() &&
			!!this.categoryId() &&
			this.sellingValue() !== null &&
			!this.mrpProblem() &&
			(!this.needsPrefix() || /^[A-Za-z0-9-]+$/.test(this.typedPrefix().trim())),
	);

	start(name: string, supplierId: string | null): void {
		this.name.set(name);
		this.supplierId = supplierId;
	}

	async chooseCategory(id: string): Promise<void> {
		this.categoryId.set(id);
		this.defaults.set(null);
		if (!id) return;
		try {
			this.defaults.set(await firstValueFrom(this.gateway.draftProductDefaults(id)));
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		}
	}

	async save(): Promise<void> {
		const selling = this.sellingValue();
		if (!this.canSave() || selling === null) return;
		this.saving.set(true);
		this.error.set(null);
		this.fieldErrors.set({});
		try {
			const option: PurchaseItemOption = await firstValueFrom(
				this.gateway.createDraftProduct({
					name: this.name().trim(),
					categoryId: this.categoryId(),
					sellingPriceINR: selling,
					mrpINR: this.mrpValue(),
					...(this.supplierId ? { supplierId: this.supplierId } : {}),
					supplierItemCode: this.code().trim() || null,
					soldBy: 'piece',
					skuPrefix: this.needsPrefix() ? this.typedPrefix().trim().toUpperCase() : null,
				}),
			);
			this.modal.close(option);
		} catch (error) {
			const fields: Record<string, string> = {};
			for (const issue of apiIssues(error)) if (issue.target) fields[issue.target] = issue.message;
			this.fieldErrors.set(fields);
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.saving.set(false);
		}
	}
}
