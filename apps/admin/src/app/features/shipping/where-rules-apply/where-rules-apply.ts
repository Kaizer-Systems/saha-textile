import { Component, TemplateRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import {
	SHIPPING_KEY,
	SHIPPING_STALE_MS,
	ShippingGateway,
	injectShippingExceptionsQuery,
	injectShippingOverviewQuery,
	shippingProblemKey,
} from '@core/shipping/shipping.gateway';
import { AuthStore } from '@core/state/auth.store';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';
import { askConfirm } from '@features/purchasing/shared/popups';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import type {
	AdminProductRow,
	ShippingException,
	ShippingExceptionChoice,
	ShippingExceptionWrite,
	ShippingZone,
} from '@saha-textile/contracts';

/** The exception popup as edited (brief as02). */
interface ExceptionDraft {
	id: string | null;
	kind: 'category' | 'product';
	categoryId: string;
	includeSubcategories: boolean;
	product: { id: string; title: string } | null;
	domestic: string;
	international: string;
	note: string;
}

/** A choice as the popup's select holds it: `siteWide`, `free`, `cantShip` or `rs:<id>`. */
const choiceValue = (choice: ShippingExceptionChoice): string =>
	choice.kind === 'ruleSet' ? `rs:${choice.ruleSetId}` : choice.kind;
const choiceOf = (value: string): ShippingExceptionChoice =>
	value.startsWith('rs:')
		? { kind: 'ruleSet', ruleSetId: value.slice(3) }
		: ({ kind: value } as ShippingExceptionChoice);

/**
 * Admin › Shipping › Where rules apply (brief as01, as02): the rule set each zone uses site-wide,
 * then exceptions for a category (with or without its sub-categories) or a product. A product's own
 * exception wins, then its main category's, then parents nearest first, then site-wide.
 */
@Component({
	selector: 'app-where-rules-apply',
	templateUrl: './where-rules-apply.html',
	imports: [PageWrapper, FormFields, FormsModule, TranslocoModule],
})
export class WhereRulesApply {
	private readonly gateway = inject(ShippingGateway);
	private readonly categories = inject(CategoryService);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly modals = inject(NgbModal);
	private readonly auth = inject(AuthStore);

	readonly overview = injectShippingOverviewQuery();
	readonly exceptions = injectShippingExceptionsQuery();
	readonly categoryRows = injectQuery(() => ({
		queryKey: ['shipping', 'category-rows'],
		queryFn: () => firstValueFrom(this.categories.getCategoryRows()),
		staleTime: SHIPPING_STALE_MS,
	}));
	readonly canEdit = computed(() => this.auth.permissions().includes('shipping.edit'));
	readonly canAdd = computed(() => this.auth.permissions().includes('shipping.create'));
	readonly canDelete = computed(() => this.auth.permissions().includes('shipping.destroy'));
	readonly zones: ShippingZone[] = ['domestic', 'international'];

	/** Site-wide rule set per zone, as chosen on the page. */
	readonly siteWide = signal<Record<ShippingZone, string>>({ domestic: '', international: '' });
	readonly saving = signal(false);
	readonly draft = signal<ExceptionDraft | null>(null);
	readonly productResults = signal<AdminProductRow[]>([]);
	/** Product titles for product exceptions, looked up once. */
	readonly productTitles = signal<Record<string, string>>({});
	private readonly popup = viewChild<TemplateRef<unknown>>('exceptionPopup');
	private openPopup: NgbModalRef | null = null;

	constructor() {
		effect(() => {
			const data = this.overview.data();
			if (!data) return;
			const settings = data.settings ?? data.defaults;
			const id = (zone: ShippingZone) => {
				const method = settings[zone];
				return (method.kind === 'ruleSet' ? method.ruleSetId : method.fallbackRuleSetId) ?? '';
			};
			this.siteWide.set({ domestic: id('domestic'), international: id('international') });
		});
		effect(() => {
			for (const exception of this.exceptions.data() ?? []) {
				if (exception.target.kind === 'product') this.lookUpProduct(exception.target.productId);
			}
		});
	}

	/** Rule sets that can price a zone: made active, and meant for that zone or both. */
	activeFor(zone: ShippingZone | null) {
		return (this.overview.data()?.ruleSets ?? []).filter(
			(r) => r.activeVersion !== null && (zone === null || r.use === 'both' || r.use === zone),
		);
	}

	categoryName(id: string): string {
		const row = this.categoryRows.data()?.find((r) => r.id === id);
		return row ? (row.path ?? row.name['en'] ?? id) : id;
	}

	affected(exception: ShippingException): number | null {
		if (exception.target.kind === 'product') return 1;
		const { categoryId } = exception.target;
		return this.categoryRows.data()?.find((r) => r.id === categoryId)?.productCount ?? null;
	}

	choiceLabel(choice: ShippingExceptionChoice): string {
		if (choice.kind !== 'ruleSet') return this.transloco.translate(`ship_choice_${choice.kind}`);
		return this.overview.data()?.ruleSets.find((r) => r.id === choice.ruleSetId)?.name ?? choice.ruleSetId;
	}

	saveSiteWide() {
		const data = this.overview.data();
		if (!data || this.saving()) return;
		const { updatedAt: _at, updatedBy: _by, ...settings } = data.settings ?? data.defaults;
		void _at;
		void _by;
		const chosen = this.siteWide();
		this.saving.set(true);
		this.gateway
			.saveSettings({
				...settings,
				domestic: { kind: 'ruleSet', ruleSetId: chosen.domestic || null },
				international: { kind: 'ruleSet', ruleSetId: chosen.international || null },
			})
			.subscribe({
				next: () => this.saved('ship_settings_saved'),
				error: (error: unknown) => this.failed(error),
			});
	}

	setSiteWide(zone: ShippingZone, value: string) {
		this.siteWide.update((current) => ({ ...current, [zone]: value }));
	}

	add() {
		this.edit(null);
	}

	edit(exception: ShippingException | null) {
		this.productResults.set([]);
		this.draft.set(
			exception
				? {
						id: exception.id,
						kind: exception.target.kind,
						categoryId: exception.target.kind === 'category' ? exception.target.categoryId : '',
						includeSubcategories:
							exception.target.kind === 'category' ? exception.target.includeSubcategories : true,
						product:
							exception.target.kind === 'product'
								? {
										id: exception.target.productId,
										title:
											this.productTitles()[exception.target.productId] ??
											exception.target.productId,
									}
								: null,
						domestic: choiceValue(exception.domestic),
						international: choiceValue(exception.international),
						note: exception.note,
					}
				: {
						id: null,
						kind: 'category',
						categoryId: '',
						includeSubcategories: true,
						product: null,
						domestic: 'siteWide',
						international: 'siteWide',
						note: '',
					},
		);
		const popup = this.popup();
		if (popup)
			this.openPopup = this.modals.open(popup, {
				centered: true,
				size: 'lg',
				windowClass: 'theme-modal',
				ariaLabelledBy: 'ship_exception_title',
			});
	}

	patch(change: Partial<ExceptionDraft>) {
		this.draft.update((draft) => (draft ? { ...draft, ...change } : draft));
	}

	setZoneChoice(zone: ShippingZone, value: string) {
		this.patch(zone === 'domestic' ? { domestic: value } : { international: value });
	}

	searchProducts(text: string) {
		const search = text.trim();
		if (search.length < 2) return this.productResults.set([]);
		this.gateway.searchProducts(search).subscribe((list) => this.productResults.set(list.items));
	}

	pickProduct(row: AdminProductRow) {
		this.patch({ product: { id: row.id, title: row.title } });
		this.productTitles.update((titles) => ({ ...titles, [row.id]: row.title }));
		this.productResults.set([]);
	}

	readonly draftValid = computed(() => {
		const draft = this.draft();
		if (!draft) return false;
		return draft.kind === 'category' ? draft.categoryId !== '' : draft.product !== null;
	});

	saveException() {
		const draft = this.draft();
		if (!draft || !this.draftValid() || this.saving()) return;
		const body: ShippingExceptionWrite = {
			target:
				draft.kind === 'category'
					? {
							kind: 'category',
							categoryId: draft.categoryId,
							includeSubcategories: draft.includeSubcategories,
						}
					: { kind: 'product', productId: draft.product?.id ?? '' },
			domestic: choiceOf(draft.domestic),
			international: choiceOf(draft.international),
			note: draft.note.trim(),
		};
		this.saving.set(true);
		this.gateway.saveException(draft.id, body).subscribe({
			next: () => {
				this.openPopup?.close();
				this.saved('ship_exception_saved');
			},
			error: (error: unknown) => this.failed(error),
		});
	}

	async remove(exception: ShippingException) {
		const yes = await askConfirm(this.modals, {
			icon: 'ri-delete-bin-line',
			title: 'ship_exception_delete_title',
			body: 'ship_exception_delete_body',
			yes: 'delete',
		});
		if (!yes) return;
		this.gateway.removeException(exception.id).subscribe({
			next: () => this.saved('ship_exception_deleted'),
			error: (error: unknown) => this.failed(error),
		});
	}

	private lookUpProduct(id: string) {
		if (this.productTitles()[id]) return;
		this.productTitles.update((titles) => ({ ...titles, [id]: id }));
		this.gateway
			.productTitle(id)
			.subscribe((product) => this.productTitles.update((titles) => ({ ...titles, [id]: product.title })));
	}

	private saved(key: string) {
		this.saving.set(false);
		this.notifier.showSuccess(this.transloco.translate(key));
		void this.queryClient.invalidateQueries({ queryKey: SHIPPING_KEY });
	}

	private failed(error: unknown) {
		this.saving.set(false);
		this.notifier.showError(this.transloco.translate(shippingProblemKey(error)));
	}
}
