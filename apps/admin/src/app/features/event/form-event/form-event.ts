import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, NgbNavModule } from '@ng-bootstrap/ng-bootstrap';
import type {
	SaleCategoryLine,
	SaleException,
	SaleProductLine,
	SaleRule,
	ShopEvent,
	ShopEventCategoryProducts,
	ShopEventProblem,
	ShopEventReview,
	ShopEventType,
	ShopEventWrite,
} from '@saha-textile/contracts';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Select2, Select2Data, Select2SearchEvent, Select2UpdateEvent } from 'ng-select2-component';
import { Subject, debounceTime, of, switchMap, takeUntil } from 'rxjs';

import { goLiveLabels } from '@core/catalog/go-live-report';
import { istInputToUtc, utcToIstInput } from '@core/i18n/ist-time';
import {
	ADMIN_LOCALES,
	focusField,
	gapsByLocale,
	type LanguageGap,
	LocalizedFields,
} from '@core/i18n/localized-fields';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { ICategory } from '@data-access/interfaces/category.interface';
import { ITableClickedAction } from '@data-access/interfaces/table.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductService } from '@data-access/services/product.service';
import { ShopEventService } from '@data-access/services/shop-event.service';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';

import { istLabel } from '../events';

const LANGUAGE_FIELDS = ['title', 'message'];

/** A new rule starts at 10% off: a value that can never be refused. */
const NEW_RULE = (): SaleRule => ({ kind: 'percent', value: 10, skuPrices: {} });

/** Every category in the tree, flat, so a picked id can show its name. */
function flatten(rows: readonly ICategory[] = []): ICategory[] {
	return rows.flatMap((row) => [row, ...flatten((row as { subcategories?: ICategory[] }).subcategories ?? [])]);
}

/**
 * The event form, one for both types (owner brief 2026-11-08, approved 2026-11-09): General,
 * Items (launch) or Discounts (sale), Message, Review. Times are typed and shown in India time
 * whatever the computer's own zone; Save never touches the shop, Publish arms the event.
 */
@Component({
	selector: 'app-form-event',
	templateUrl: './form-event.html',
	imports: [
		ReactiveFormsModule,
		NgbNavModule,
		FormFields,
		LanguageSwitch,
		AdvancedDropdown,
		ImageUpload,
		Select2,
		Button,
		ConfirmationModal,
		HasPermissionDirective,
		TranslocoModule,
	],
})
export class FormEvent {
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private events = inject(ShopEventService);
	private products = inject(ProductService);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private queryClient = inject(QueryClient);
	private modal = inject(NgbModal);
	private page = inject<Document>(DOCUMENT);
	readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'product' }));
	readonly categoryOptions = computed(() => this.categoriesQuery.data()?.data ?? []);
	private readonly categoryNames = computed(
		() => new Map(flatten(this.categoryOptions()).map((row) => [String(row.id), row.name])),
	);

	readonly exceptionsModal = viewChild.required<TemplateRef<unknown>>('exceptionsModal');
	readonly confirm = viewChild.required(ConfirmationModal);

	active = 'general';
	readonly type = signal<ShopEventType>('sale');
	readonly event = signal<ShopEvent | null>(null);
	readonly review = signal<ShopEventReview | null>(null);
	readonly problems = signal<ShopEventProblem[]>([]);
	readonly locales = ADMIN_LOCALES;
	readonly gaps = signal<Record<string, LanguageGap[]>>({});
	popupImage: IAttachment | null = null;

	// Launch picks.
	readonly launchCategoryIds = signal<string[]>([]);
	readonly launchProductIds = signal<string[]>([]);
	readonly heldProductIds = signal<string[]>([]);
	// Sale lines.
	readonly saleCategories = signal<SaleCategoryLine[]>([]);
	readonly saleProducts = signal<SaleProductLine[]>([]);
	/** Product titles seen so far, from searches and Review. */
	private readonly titles = signal(new Map<string, string>());

	readonly productOptions = signal<Select2Data>([]);
	private readonly search$ = new Subject<string>();
	private readonly destroy$ = new Subject<void>();

	/** The category whose exceptions the modal is editing, with its products. */
	readonly exceptionsFor = signal<{ line: SaleCategoryLine; products: ShopEventCategoryProducts } | null>(null);

	readonly form = new FormGroup({
		name: new FormControl('', { nonNullable: true }),
		title: new FormControl('', { nonNullable: true }),
		message: new FormControl('', { nonNullable: true }),
		starts_at: new FormControl('', { nonNullable: true }),
		ends_at: new FormControl('', { nonNullable: true }),
		link_href: new FormControl('', { nonNullable: true }),
		show_countdown: new FormControl(true, { nonNullable: true }),
		show_popup: new FormControl(true, { nonNullable: true }),
		popup_asset_id: new FormControl<string | null>(null),
		now_live_days: new FormControl(3, { nonNullable: true }),
	});
	readonly fields = new LocalizedFields(this.form, LANGUAGE_FIELDS, []);

	readonly status = computed(() => this.event()?.status ?? 'draft');
	/** Draft and scheduled events change freely; a running sale only its end, rules and holds. */
	readonly editable = computed(() => ['draft', 'scheduled'].includes(this.status()));
	readonly runningSale = computed(() => this.status() === 'live' && this.type() === 'sale');
	readonly readOnly = computed(() => !this.editable() && !this.runningSale());

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => {
					if (params['type'] === 'launch' || params['type'] === 'sale') this.type.set(params['type']);
					return params['id'] ? this.events.get(params['id']) : of(null);
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((event) => {
				if (event) this.load(event);
				this.refreshMissing();
			});
		this.search$
			.pipe(
				debounceTime(300),
				switchMap((search) => this.products.getCatalogProducts({ search, pageSize: 15 })),
				takeUntil(this.destroy$),
			)
			.subscribe((list) => {
				const titles = new Map(this.titles());
				for (const row of list.items) titles.set(row.id, `${row.title} · ${row.sku}`);
				this.titles.set(titles);
				this.productOptions.set(
					list.items
						.filter((row) => this.type() === 'sale' || row.status !== 'live')
						.map((row) => ({
							value: row.id,
							label: `${row.title} · ${row.sku}`,
							data: { name: row.title },
						})),
				);
			});
		this.search$.next('');
	}

	private load(event: ShopEvent) {
		this.event.set(event);
		this.type.set(event.type);
		this.form.patchValue({
			name: event.name,
			starts_at: event.startsAt ? utcToIstInput(event.startsAt) : '',
			ends_at: event.endsAt ? utcToIstInput(event.endsAt) : '',
			link_href: event.linkHref ?? '',
			show_countdown: event.showCountdown,
			show_popup: event.showPopup,
			popup_asset_id: event.popupAssetId,
			now_live_days: event.nowLiveDays,
		});
		this.fields.load({ title: event.title, message: event.message });
		this.launchCategoryIds.set(event.launch.categoryIds);
		this.launchProductIds.set(event.launch.productIds);
		this.heldProductIds.set(event.launch.heldProductIds);
		this.saleCategories.set(event.sale.categories);
		this.saleProducts.set(event.sale.products);
		this.popupImage = event.popupAssetId
			? ({ id: event.popupAssetId, original_url: '' } as unknown as IAttachment)
			: null;
		if (this.readOnly()) this.form.disable();
		this.loadReview();
	}

	private loadReview() {
		const id = this.event()?.id;
		if (!id) return;
		this.events.review(id).subscribe((review) => {
			this.review.set(review);
			this.problems.set(review.problems);
			const titles = new Map(this.titles());
			for (const row of review.items) titles.set(row.productId, `${row.title} · ${row.sku}`);
			for (const row of review.prices) titles.set(row.productId, row.productTitle);
			this.titles.set(titles);
		});
	}

	// ── Names ─────────────────────────────────────────────────────────────────

	categoryName(id: string): string {
		return this.categoryNames().get(id) ?? id;
	}

	productName(id: string): string {
		return this.titles().get(id) ?? id;
	}

	istText(local: string): string {
		const utc = local ? istInputToUtc(local) : null;
		return utc ? istLabel(utc) : '';
	}

	// ── Languages ─────────────────────────────────────────────────────────────

	switchLanguage(locale: string) {
		this.fields.switchTo(locale);
		this.refreshMissing();
	}

	openLanguageGap({ key, locale }: { key: string; locale: string }) {
		this.switchLanguage(locale);
		focusField(this.page, key);
	}

	private refreshMissing() {
		this.gaps.set(gapsByLocale((locale) => this.fields.gaps(locale)));
	}

	// ── Pickers ───────────────────────────────────────────────────────────────

	searchProduct(event: Select2SearchEvent) {
		this.search$.next(event.search);
	}

	selectPopupImage(data: IAttachment) {
		if (Array.isArray(data)) return;
		this.popupImage = data ?? null;
		this.form.controls.popup_asset_id.setValue(data ? String(data.id) : null);
	}

	pickLaunchCategories(ids: string[]) {
		if (Array.isArray(ids)) this.launchCategoryIds.set(ids.map(String));
	}

	pickLaunchProducts(event: Select2UpdateEvent) {
		const ids = Array.isArray(event.value) ? event.value.map(String) : [];
		this.launchProductIds.set(ids);
	}

	toggleHeld(productId: string, held: boolean) {
		const next = new Set(this.heldProductIds());
		if (held) next.add(productId);
		else next.delete(productId);
		this.heldProductIds.set([...next]);
	}

	isHeld(productId: string): boolean {
		return this.heldProductIds().includes(productId);
	}

	/** Adding categories adds a row each at 10% off; removing one from the picker drops its row. */
	pickSaleCategories(ids: string[]) {
		if (!Array.isArray(ids)) return;
		const wanted = ids.map(String);
		const kept = this.saleCategories().filter((line) => wanted.includes(line.categoryId));
		const added = wanted
			.filter((id) => !kept.some((line) => line.categoryId === id))
			.map((categoryId) => ({ categoryId, rule: NEW_RULE(), exceptions: [] }));
		this.saleCategories.set([...kept, ...added]);
	}

	saleCategoryIds(): string[] {
		return this.saleCategories().map((line) => line.categoryId);
	}

	pickSaleProducts(event: Select2UpdateEvent) {
		const wanted = Array.isArray(event.value) ? event.value.map(String) : [];
		const kept = this.saleProducts().filter((line) => wanted.includes(line.productId));
		const added = wanted
			.filter((id) => !kept.some((line) => line.productId === id))
			.map((productId) => ({ productId, rule: NEW_RULE() }));
		this.saleProducts.set([...kept, ...added]);
	}

	saleProductIds(): string[] {
		return this.saleProducts().map((line) => line.productId);
	}

	// ── Rules ─────────────────────────────────────────────────────────────────

	ruleKind(value: string): SaleRule['kind'] {
		return value === 'amount' || value === 'fixed' ? value : 'percent';
	}

	setCategoryRule(categoryId: string, patch: Partial<SaleRule>) {
		this.saleCategories.update((lines) =>
			lines.map((line) =>
				line.categoryId === categoryId ? { ...line, rule: { ...line.rule, ...patch } } : line,
			),
		);
	}

	setProductRule(productId: string, patch: Partial<SaleRule>) {
		this.saleProducts.update((lines) =>
			lines.map((line) => (line.productId === productId ? { ...line, rule: { ...line.rule, ...patch } } : line)),
		);
	}

	removeCategoryLine(categoryId: string) {
		this.saleCategories.update((lines) => lines.filter((line) => line.categoryId !== categoryId));
	}

	removeProductLine(productId: string) {
		this.saleProducts.update((lines) => lines.filter((line) => line.productId !== productId));
	}

	exceptionCount(line: SaleCategoryLine): number {
		return line.exceptions.length;
	}

	// ── Exceptions modal ──────────────────────────────────────────────────────

	openExceptions(line: SaleCategoryLine) {
		this.events.categoryProducts(line.categoryId).subscribe((products) => {
			this.exceptionsFor.set({ line: structuredClone(line), products });
			this.modal
				.open(this.exceptionsModal(), { centered: true, size: 'lg', windowClass: 'theme-modal' })
				.result.catch(() => undefined);
		});
	}

	exception(productId: string): SaleException | null {
		return this.exceptionsFor()?.line.exceptions.find((row) => row.productId === productId) ?? null;
	}

	private setException(productId: string, next: SaleException | null) {
		this.exceptionsFor.update((state) => {
			if (!state) return state;
			const exceptions = state.line.exceptions.filter((row) => row.productId !== productId);
			return { ...state, line: { ...state.line, exceptions: next ? [...exceptions, next] : exceptions } };
		});
	}

	/** The In sale switch: off holds the product back. */
	toggleInSale(productId: string, inSale: boolean) {
		this.setException(productId, inSale ? null : { productId, mode: 'held', rule: null });
	}

	/** "Category rule" or "Own rule". */
	setExceptionMode(productId: string, mode: string) {
		const current = this.exception(productId);
		if (mode === 'own') {
			this.setException(productId, { productId, mode: 'own', rule: current?.rule ?? NEW_RULE() });
		} else if (current?.mode === 'own') {
			this.setException(productId, null);
		}
	}

	/** The rule select in the modal: "Category rule", or one of the three kinds as the product's own. */
	pickExceptionRule(productId: string, value: string) {
		if (value === 'category') {
			this.setExceptionMode(productId, 'category');
			return;
		}
		this.setExceptionMode(productId, 'own');
		this.setExceptionRule(productId, { kind: this.ruleKind(value) });
	}

	setExceptionRule(productId: string, patch: Partial<SaleRule>) {
		const current = this.exception(productId);
		if (current?.mode !== 'own' || !current.rule) return;
		this.setException(productId, { ...current, rule: { ...current.rule, ...patch } });
	}

	setSkuPrice(productId: string, sku: string, value: string) {
		const current = this.exception(productId);
		if (current?.mode !== 'own' || !current.rule) return;
		const skuPrices = { ...current.rule.skuPrices };
		const amount = Math.floor(Number(value));
		if (value === '' || !Number.isFinite(amount)) delete skuPrices[sku];
		else skuPrices[sku] = amount;
		this.setException(productId, { ...current, rule: { ...current.rule, skuPrices } });
	}

	saveExceptions() {
		const state = this.exceptionsFor();
		if (!state) return;
		this.saleCategories.update((lines) =>
			lines.map((line) => (line.categoryId === state.line.categoryId ? state.line : line)),
		);
	}

	// ── Save and Publish ──────────────────────────────────────────────────────

	private body(): ShopEventWrite {
		const raw = this.form.getRawValue();
		return {
			name: raw.name.trim(),
			title: this.fields.text('title'),
			message: this.fields.text('message'),
			startsAt: raw.starts_at ? istInputToUtc(raw.starts_at) : null,
			endsAt: this.type() === 'sale' && raw.ends_at ? istInputToUtc(raw.ends_at) : null,
			linkHref: raw.link_href.trim() || null,
			showCountdown: raw.show_countdown,
			showPopup: raw.show_popup,
			popupAssetId: raw.popup_asset_id,
			nowLiveDays: Number(raw.now_live_days) || 0,
			launch: {
				categoryIds: this.launchCategoryIds(),
				productIds: this.launchProductIds(),
				heldProductIds: this.heldProductIds(),
			},
			sale: { categories: this.saleCategories(), products: this.saleProducts() },
		};
	}

	submit() {
		if (this.readOnly()) return;
		if (!this.form.controls.name.value.trim()) {
			this.active = 'general';
			this.form.controls.name.setErrors({ required: true });
			this.form.controls.name.markAsTouched();
			return;
		}
		const id = this.event()?.id;
		const call = id ? this.events.save(id, this.body()) : this.events.create(this.type(), this.body());
		call.subscribe({
			next: (event) => {
				void this.queryClient.invalidateQueries({ queryKey: ['shop-events'] });
				this.notifier.showSuccess(this.transloco.translate('saved'));
				if (!id) void this.router.navigateByUrl(`/event/edit/${event.id}`);
				else this.load(event);
			},
			error: (error: unknown) => this.refused(error),
		});
	}

	/** The API's refusal carries one issue per problem; they are listed on the Review tab. */
	private refused(error: unknown) {
		const issues = (error as { error?: { issues?: { code?: string; path?: unknown[] }[] } })?.error?.issues ?? [];
		if (issues.length) {
			this.problems.set(
				issues.map((issue) => ({
					code: (issue.code ?? 'bad_rule') as ShopEventProblem['code'],
					target: String(issue.path?.[1] ?? ''),
					locale: null,
					gaps: [],
					detail: '',
				})),
			);
			this.active = 'review';
		}
		this.notifier.showError(this.transloco.translate('event_rejected'));
	}

	/** One line per problem, in the admin's words. */
	problemText(problem: ShopEventProblem): string {
		const t = (key: string, params?: Record<string, string>) => this.transloco.translate(key, params);
		const [field, locale] = problem.target.split(':');
		switch (problem.code) {
			case 'missing_text':
				return t('event_problem_missing_text', {
					field: t(field === 'title' ? 'event_shop_title' : 'event_message'),
					language: t(`language_${locale ?? 'en'}`),
				});
			case 'not_ready':
				return `${problem.detail}: ${goLiveLabels(problem.gaps, (key) => t(key)).join(', ')}`;
			case 'overlap':
				return t('event_problem_overlap', { item: problem.detail });
			case 'bad_rule':
			case 'unknown_item':
				return t(`event_problem_${problem.code}`, {
					item: this.categoryNames().get(problem.target) ?? this.productName(problem.target),
				});
			default:
				return t(`event_problem_${problem.code}`);
		}
	}

	/** Save first, then Publish, behind a confirmation that states the reach. */
	askPublish() {
		const id = this.event()?.id;
		if (!id) return;
		this.events.save(id, this.body()).subscribe({
			next: (event) => {
				this.load(event);
				this.events.review(id).subscribe((review) => {
					this.review.set(review);
					this.problems.set(review.problems);
					if (review.problems.length) {
						this.active = 'review';
						this.notifier.showError(this.transloco.translate('event_publish_blocked'));
						return;
					}
					void this.confirm().openModal('publish', { id }, review.recipients);
				});
			},
			error: (error: unknown) => this.refused(error),
		});
	}

	ask(action: 'unpublish' | 'cancel' | 'end_now') {
		const id = this.event()?.id;
		if (id) void this.confirm().openModal(action, { id });
	}

	confirmed(action: ITableClickedAction) {
		const id = this.event()?.id;
		if (!id) return;
		const done = (event: ShopEvent, message: string) => {
			this.notifier.showSuccess(this.transloco.translate(message));
			void this.queryClient.invalidateQueries({ queryKey: ['shop-events'] });
			this.load(event);
		};
		const fail = () => this.notifier.showError(this.transloco.translate('event_rejected'));
		if (action.actionToPerform === 'publish') {
			this.events.publish(id).subscribe({
				next: (result) => {
					if (!result.published) {
						this.problems.set(result.problems);
						this.active = 'review';
						this.notifier.showError(this.transloco.translate('event_publish_blocked'));
						return;
					}
					if (result.event) done(result.event, 'event_published');
				},
				error: fail,
			});
		} else if (action.actionToPerform === 'unpublish') {
			this.events.unpublish(id).subscribe({ next: (event) => done(event, 'event_unpublished'), error: fail });
		} else if (action.actionToPerform === 'cancel') {
			this.events.cancel(id).subscribe({ next: (event) => done(event, 'event_cancelled'), error: fail });
		} else if (action.actionToPerform === 'end_now') {
			this.events.endNow(id).subscribe({ next: (event) => done(event, 'event_ended'), error: fail });
		}
	}

	sendTest() {
		const id = this.event()?.id;
		if (!id) return;
		this.events.sendTest(id).subscribe({
			next: () => this.notifier.showSuccess(this.transloco.translate('event_test_sent')),
			error: () => this.notifier.showError(this.transloco.translate('event_test_failed')),
		});
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}
