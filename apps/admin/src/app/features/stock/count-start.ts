import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { Select2, type Select2Data, type Select2UpdateEvent } from 'ng-select2-component';
import { catchError, firstValueFrom, of } from 'rxjs';

import { apiProblem } from '@core/purchasing/purchasing-format';
import { StockGateway } from '@core/purchasing/stock.gateway';
import { AuthStore } from '@core/state/auth.store';
import { injectAdminUsersQuery } from '@data-access/queries/admin-users.queries';
import { CategoryService } from '@data-access/services/category.service';
import { categoryPaths } from '@features/purchasing/purchase-entry/draft-product-popup';
import { LineSearch } from '@features/purchasing/shared/line-search';

import type { AdminCategoryRow, PurchaseItemOption, StockCount, StockCountScope } from '@saha-textile/contracts';

/** Whether the scope names something to count (some categories, some SKUs). */
export function scopeReady(scope: StockCountScope): boolean {
	if (scope.kind === 'categories') return scope.categoryIds.length > 0;
	if (scope.kind === 'skus') return scope.variantIds.length > 0;
	return true;
}

/**
 * Start a stock count (c02): the whole shop, some categories, a list of SKUs, or items that
 * differed last time. Blind by default, so counters count what is there. The shop keeps selling;
 * sales during the count are added back.
 */
@Component({
	selector: 'app-count-start',
	templateUrl: './count-start.html',
	imports: [FormsModule, LineSearch, Select2, TranslocoModule],
})
export class CountStart {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(StockGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly auth = inject(AuthStore);
	private readonly categories = inject(CategoryService);

	readonly kind = signal<StockCountScope['kind']>('all');
	readonly categoryIds = signal<string[]>([]);
	readonly items = signal<PurchaseItemOption[]>([]);
	readonly blind = signal(true);
	readonly counterIds = signal<string[]>([]);
	readonly label = signal('');
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);

	private readonly rows = toSignal(
		this.categories.getCategoryRows().pipe(catchError(() => of([] as AdminCategoryRow[]))),
		{
			initialValue: [] as AdminCategoryRow[],
		},
	);
	readonly categoryOptions = computed<Select2Data>(() =>
		categoryPaths(this.rows(), this.transloco.getActiveLang()).map((option) => ({
			value: option.id,
			label: option.label,
		})),
	);
	private readonly canListStaff = computed(() => this.auth.permissions().includes('admin_user.index'));
	private readonly staff = injectAdminUsersQuery(() => ({ page: 1, pageSize: 100 }));
	readonly staffOptions = computed<Select2Data>(() => {
		if (!this.canListStaff()) return [];
		const data = this.staff.data() as
			{ items?: Array<{ id: string; name?: string | null; email: string }> } | undefined;
		return (data?.items ?? []).map((user) => ({ value: user.id, label: user.name || user.email }));
	});

	readonly scope = computed<StockCountScope>(() => ({
		kind: this.kind(),
		categoryIds: this.kind() === 'categories' ? this.categoryIds() : [],
		variantIds: this.kind() === 'skus' ? this.items().map((item) => item.variantId) : [],
	}));
	readonly canStart = computed(() => !this.busy() && scopeReady(this.scope()));

	chooseCategories(event: Select2UpdateEvent): void {
		this.categoryIds.set(Array.isArray(event.value) ? event.value.map(String) : []);
	}

	chooseCounters(event: Select2UpdateEvent): void {
		this.counterIds.set(Array.isArray(event.value) ? event.value.map(String) : []);
	}

	add(option: PurchaseItemOption): void {
		if (!this.items().some((item) => item.variantId === option.variantId))
			this.items.update((list) => [...list, option]);
	}

	remove(variantId: string): void {
		this.items.update((list) => list.filter((item) => item.variantId !== variantId));
	}

	async start(): Promise<void> {
		if (!this.canStart()) return;
		this.busy.set(true);
		this.error.set(null);
		try {
			const count: StockCount = await firstValueFrom(
				this.gateway.startCount({
					scope: this.scope(),
					blind: this.blind(),
					counterIds: this.counterIds(),
					label: this.label().trim(),
				}),
			);
			this.modal.close(count);
		} catch (error) {
			this.error.set(apiProblem(error, this.transloco.translate('purchasing_action_failed')));
		} finally {
			this.busy.set(false);
		}
	}
}
