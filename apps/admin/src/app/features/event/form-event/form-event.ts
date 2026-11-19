import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, NgbNavModule } from '@ng-bootstrap/ng-bootstrap';
import type {
	PopupImageSide,
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
import { Editor, NgxEditorModule } from 'ngx-editor';
import { Subject, catchError, debounceTime, forkJoin, map, of, switchMap, takeUntil } from 'rxjs';

import { goLiveLabels } from '@core/catalog/go-live-report';
import { MediaGateway } from '@core/media/media.gateway';
import { runtimeConfig } from '@core/config/runtime-config';
import { istInputToUtc, utcToIstInput } from '@core/i18n/ist-time';
import { focusField, gapsByLocale, type LanguageGap, LocalizedFields } from '@core/i18n/localized-fields';
import { ActiveLanguages } from '@core/i18n/active-languages';
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
import { ImageUpload, type PickedAttachment } from '@shared/ui/image-upload/image-upload';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';
import { ConfirmationModal } from '@shared/ui/modal/confirmation-modal/confirmation-modal';

import { istLabel } from '../events';
import { LanguageNamePipe, PluralPipe } from '@shared/pipes/language.pipes';

const LANGUAGE_FIELDS = ['title', 'message'];

/** A new rule starts at 10% off: a value that can never be refused. */
const NEW_RULE = (): SaleRule => ({ kind: 'percent', value: 10, skuPrices: {} });

/**
 * The most popup pictures an event takes: contracts' `MAX_POPUP_PICTURES`, kept here because the
 * admin imports only types from contracts. The API refuses a longer list anyway.
 */
const MAX_POPUP_PICTURES = 5;

/** What "Link to" can point at: a category, a product, a shop page, or a typed shop address. */
type LinkKind = 'category' | 'product' | 'page' | 'path';

/** The shop's own pages an event can link to, by their address. */
const SHOP_PAGES: readonly { href: string; label: string }[] = [
	{ href: '/', label: 'event_page_home' },
	{ href: '/collections', label: 'event_page_collections' },
	{ href: '/offer', label: 'event_page_offer' },
	{ href: '/blogs', label: 'event_page_blogs' },
	{ href: '/about-us', label: 'event_page_about_us' },
	{ href: '/contact-us', label: 'event_page_contact_us' },
	{ href: '/faq', label: 'event_page_faq' },
];

/** Each category with its shop address (`/collections/` and its slugs from the top) and its trail. */
function categoryAddresses(rows: readonly ICategory[] = [], parents: { slug: string; name: string }[] = []) {
	return rows.flatMap((row): { href: string; label: string }[] => {
		const trail = [...parents, { slug: row.slug, name: row.name }];
		return [
			{
				href: `/collections/${trail.map((step) => step.slug).join('/')}`,
				label: trail.map((step) => step.name).join(' › '),
			},
			...categoryAddresses((row as { subcategories?: ICategory[] }).subcategories ?? [], trail),
		];
	});
}

/**
 * The category dropdown re-emits its selection every time it is given one, so a picker change
 * that names the categories already chosen is ignored; storing it again would loop.
 */
function sameIds(next: readonly unknown[], current: readonly string[]): boolean {
	return next.length === current.length && next.every((id) => current.includes(String(id)));
}

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
		LanguageNamePipe,
		PluralPipe,
		ReactiveFormsModule,
		NgbNavModule,
		FormFields,
		LanguageSwitch,
		AdvancedDropdown,
		ImageUpload,
		Select2,
		NgxEditorModule,
		Button,
		ConfirmationModal,
		HasPermissionDirective,
		TranslocoModule,
	],
})
export class FormEvent {
	/** The most popup pictures the picker lets the field hold. */
	readonly maxPopupPictures = MAX_POPUP_PICTURES;
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private events = inject(ShopEventService);
	private products = inject(ProductService);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private queryClient = inject(QueryClient);
	private modal = inject(NgbModal);
	private media = inject(MediaGateway);
	private page = inject<Document>(DOCUMENT);
	readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
	/** The message's rich editor, as on the blog form. Browser only. */
	readonly editor: Editor | null = this.isBrowser ? new Editor() : null;

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
	readonly locales = inject(ActiveLanguages).list();
	readonly gaps = signal<Record<string, LanguageGap[]>>({});
	/** The popup pictures in slide order, as the media picker draws them (owner, 2026-11-10). */
	readonly popupImages = signal<IAttachment[]>([]);
	/** The ids last fetched, so a reload after Save doesn't fetch them again. */
	private popupImageIds = '';

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

	// "Link to".
	/** The admin's language file; the pickers' labels are read again once it has loaded. */
	private readonly words = toSignal(this.transloco.selectTranslation(), { initialValue: {} });
	readonly linkKind = signal<LinkKind>('page');
	readonly linkKindOptions = computed<Select2Data>(() => {
		this.words();
		return (['category', 'product', 'page', 'path'] as const).map((kind) => ({
			value: kind,
			label: this.transloco.translate(`event_link_${kind}`),
		}));
	});
	readonly categoryLinks = computed<Select2Data>(() =>
		categoryAddresses(this.categoryOptions()).map((row) => ({ value: row.href, label: row.label })),
	);
	readonly pageLinks = computed<Select2Data>(() => {
		this.words();
		return SHOP_PAGES.map((page) => ({ value: page.href, label: this.transloco.translate(page.label) }));
	});
	/** Searched products by their shop address; a saved link stays listed so it shows. */
	readonly productLinks = signal<Select2Data>([]);
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
		popup_image_side: new FormControl<PopupImageSide>('right', { nonNullable: true }),
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
				const saved = this.form.controls.link_href.value;
				const links = list.items.map((row) => ({
					value: `/product/${row.slug}`,
					label: `${row.title} · ${row.sku}`,
				}));
				if (saved.startsWith('/product/') && !links.some((row) => row.value === saved)) {
					links.unshift({ value: saved, label: saved });
				}
				this.productLinks.set(links);
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
			popup_image_side: event.popupImageSide,
			now_live_days: event.nowLiveDays,
		});
		this.fields.load({ title: event.title, message: event.message });
		this.linkKind.set(this.kindOf(event.linkHref ?? ''));
		const href = event.linkHref;
		if (this.linkKind() === 'product' && href) {
			this.productLinks.update((rows) =>
				rows.some((row) => 'value' in row && row.value === href)
					? rows
					: [{ value: href, label: href }, ...rows],
			);
		}
		this.launchCategoryIds.set(event.launch.categoryIds);
		this.launchProductIds.set(event.launch.productIds);
		this.heldProductIds.set(event.launch.heldProductIds);
		this.saleCategories.set(event.sale.categories);
		this.saleProducts.set(event.sale.products);
		// Fetched together from the library so the pictures keep their slide order, as on the
		// store form; one deleted since is left out.
		const ids = event.popupAssetIds.join(',');
		if (ids !== this.popupImageIds) {
			this.popupImageIds = ids;
			if (!event.popupAssetIds.length) this.popupImages.set([]);
			else
				forkJoin(event.popupAssetIds.map((id) => this.media.get(id).pipe(catchError(() => of(null)))))
					.pipe(map((list) => list.filter((image): image is IAttachment => image !== null)))
					.subscribe((list) =>
						this.popupImages.set(
							list.map((image) => {
								const versionId = event.imageVersions?.[String(image.id)];
								return versionId ? ({ ...image, versionId } as IAttachment) : image;
							}),
						),
					);
		}
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
		this.gaps.set(gapsByLocale(this.locales, (locale) => this.fields.gaps(locale)));
	}

	// ── Pickers ───────────────────────────────────────────────────────────────

	searchProduct(event: Select2SearchEvent) {
		this.search$.next(event.search);
	}

	/** Which kind a saved address is, so the picker opens on it. */
	private kindOf(href: string): LinkKind {
		if (!href || SHOP_PAGES.some((page) => page.href === href)) return 'page';
		if (href.startsWith('/product/')) return 'product';
		if (href.startsWith('/collections/')) return 'category';
		return 'path';
	}

	pickLinkKind(event: Select2UpdateEvent) {
		const kind = String(event.value ?? '') as LinkKind;
		if (!['category', 'product', 'page', 'path'].includes(kind) || kind === this.linkKind()) return;
		this.linkKind.set(kind);
		// A typed address is kept to edit; switching to a list starts from nothing picked.
		if (kind !== 'path') this.form.controls.link_href.setValue('');
	}

	pickLink(event: Select2UpdateEvent) {
		const href = typeof event.value === 'string' ? event.value : '';
		this.form.controls.link_href.setValue(href);
	}

	/** The picker hands back the whole list, a single picture, or nothing. */
	selectPopupImages(selection: IAttachment[] | IAttachment | null | undefined) {
		const list = Array.isArray(selection) ? selection : selection ? [selection] : [];
		const kept = list.slice(0, MAX_POPUP_PICTURES);
		this.popupImages.set(kept);
		this.popupImageIds = kept.map((image) => String(image.id)).join(',');
		this.form.markAsDirty();
	}

	pickLaunchCategories(ids: string[]) {
		if (!Array.isArray(ids) || sameIds(ids, this.launchCategoryIds())) return;
		this.launchCategoryIds.set(ids.map(String));
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
		if (!Array.isArray(ids) || sameIds(ids, this.saleCategoryIds())) return;
		const wanted = ids.map(String);
		const kept = this.saleCategories().filter((line) => wanted.includes(line.categoryId));
		const added = wanted
			.filter((id) => !kept.some((line) => line.categoryId === id))
			.map((categoryId) => ({ categoryId, rule: NEW_RULE(), exceptions: [] }));
		this.saleCategories.set([...kept, ...added]);
	}

	/**
	 * Kept as computed values: the category dropdown re-runs its selection whenever it is handed
	 * a new array, so a method returning a fresh one each check looped change detection (NG0103).
	 */
	readonly saleCategoryIds = computed(() => this.saleCategories().map((line) => line.categoryId));

	pickSaleProducts(event: Select2UpdateEvent) {
		const wanted = Array.isArray(event.value) ? event.value.map(String) : [];
		const kept = this.saleProducts().filter((line) => wanted.includes(line.productId));
		const added = wanted
			.filter((id) => !kept.some((line) => line.productId === id))
			.map((productId) => ({ productId, rule: NEW_RULE() }));
		this.saleProducts.set([...kept, ...added]);
	}

	readonly saleProductIds = computed(() => this.saleProducts().map((line) => line.productId));

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
			lines.map((line) => {
				if (line.productId !== productId) return line;
				const rule = { ...line.rule, ...patch };
				// Per-colour prices belong to a fixed price only.
				return { ...line, rule: rule.kind === 'fixed' ? rule : { ...rule, skuPrices: {} } };
			}),
		);
	}

	/** A product priced per colour from the product list (brief 4b): its SKU prices, edited here too. */
	skuPrices(line: SaleProductLine): { sku: string; price: number }[] {
		return line.rule.kind === 'fixed'
			? Object.entries(line.rule.skuPrices).map(([sku, price]) => ({ sku, price }))
			: [];
	}

	setProductSkuPrice(productId: string, sku: string, price: number) {
		this.saleProducts.update((lines) =>
			lines.map((line) =>
				line.productId === productId
					? { ...line, rule: { ...line.rule, skuPrices: { ...line.rule.skuPrices, [sku]: price } } }
					: line,
			),
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
			popupAssetIds: this.popupImages().map((image) => String(image.id)),
			// The version each popup picture was chosen with (R4-1; media step 4d).
			imageVersions: Object.fromEntries(
				this.popupImages().flatMap((image) => {
					const versionId = (image as PickedAttachment).versionId;
					return versionId ? [[String(image.id), versionId]] : [];
				}),
			),
			popupImageSide: raw.popup_image_side,
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

	/**
	 * Preview popup (owner brief): the shop opens the saved popup at once, in the language shown
	 * on the form, at desktop width in a new tab or at phone width in a phone-sized window. The
	 * window opens on the click itself, so the browser doesn't block it, and gets its address when
	 * the 30-minute link arrives. Unsaved changes are saved first when the event can still change.
	 */
	preview(size: 'desktop' | 'phone') {
		const id = this.event()?.id;
		if (!id) return;
		const view = this.page.defaultView;
		const win =
			size === 'phone'
				? view?.open('', 'event_preview_phone', 'popup,width=390,height=844')
				: view?.open('', '_blank');
		if (!win) {
			this.notifier.showError(this.transloco.translate('event_preview_blocked'));
			return;
		}
		win.opener = null;
		const locale = this.fields.locale();
		const open = () =>
			this.events.previewLink(id).subscribe({
				next: ({ token }) => {
					const address = new URL(`/${locale}`, runtimeConfig.siteUrl);
					address.searchParams.set('event_preview', token);
					win.location.href = address.toString();
				},
				error: () => {
					win.close();
					this.notifier.showError(this.transloco.translate('event_rejected'));
				},
			});
		if (this.readOnly() || !this.form.dirty) {
			open();
			return;
		}
		this.events.save(id, this.body()).subscribe({
			next: (event) => {
				this.load(event);
				this.form.markAsPristine();
				open();
			},
			error: (error: unknown) => {
				win.close();
				this.refused(error);
			},
		});
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
		this.editor?.destroy();
		this.destroy$.next();
		this.destroy$.complete();
	}
}
