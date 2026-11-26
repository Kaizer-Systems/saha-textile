import { NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, ElementRef, PLATFORM_ID, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, RouterModule } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { Editor, NgxEditorModule } from 'ngx-editor';
import { firstValueFrom } from 'rxjs';

import { runtimeConfig } from '@core/config/runtime-config';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectTagsQuery } from '@data-access/queries/tag.queries';
import { BundleService } from '@data-access/services/bundle.service';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductService } from '@data-access/services/product.service';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload, type PickedAttachment, ImageUploadValue, onePicture } from '@shared/ui/image-upload/image-upload';

import { BundleRuleRows } from './bundle-rule-rows';
import { ruleSentence } from './rule-words';
import { type FaqValue, ProductFaq } from '../form-product/product-faq/product-faq';

import type {
	AdminProductRow,
	BundleBuilderItem,
	BundleBuilderView,
	BundleCheckView,
	BundleDetailsWrite,
	BundleItem,
	BundleLevel,
	BundleLevelSource,
	BundlePricing,
	BundlePriceMethodRow,
	CatalogPageBundle,
	ProductBundleWrite,
} from '@saha-textile/contracts';

type Tab = 'build' | 'rules' | 'details' | 'photos' | 'seo' | 'faq' | 'status';
const LANGS = ['en', 'bn'] as const;
type Lang = (typeof LANGS)[number];

/**
 * The bundle builder (bundle builder brief, approved 2026-11-22; V1 option 1): every part of a bundle on one page.
 * Build holds "How the set is priced", the levels with their items' MRP, selling, running sale and Price in this set,
 * the optional extras and the checks; the shop's own set block draws live beside it (the preview frame). Details,
 * SEO and Status hold what a bundle keeps of a product: no HSN, tax, stock or weight (V2).
 */
@Component({
	selector: 'app-bundle-builder',
	templateUrl: './bundle-builder.html',
	imports: [
		AdvancedDropdown,
		BundleRuleRows,
		FormFields,
		FormsModule,
		ImageUpload,
		NgTemplateOutlet,
		NgxEditorModule,
		ProductFaq,
		RouterModule,
		TranslocoModule,
	],
})
export class BundleBuilder {
	private readonly route = inject(ActivatedRoute);
	private readonly bundles = inject(BundleService);
	private readonly products = inject(ProductService);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly sanitizer = inject(DomSanitizer);
	private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
	private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('preview');

	readonly productId = this.route.snapshot.paramMap.get('id') ?? '';
	readonly tab = signal<Tab>('build');
	readonly lang = signal<Lang>('en');
	readonly langs = LANGS;
	readonly view = signal<BundleBuilderView | null>(null);
	readonly draft = signal<ProductBundleWrite | null>(null);
	readonly details = signal<BundleDetailsWrite | null>(null);
	readonly items = signal<ReadonlyMap<string, BundleBuilderItem>>(new Map());
	readonly checks = signal<BundleCheckView[]>([]);
	readonly saving = signal(false);
	readonly dirty = signal(false);
	readonly device = signal<'laptop' | 'phone'>('laptop');
	readonly previewUrl = signal<SafeResourceUrl | null>(null);
	/** The description's editor, as in the product form (browser only). */
	readonly editor: Editor | null = this.isBrowser ? new Editor() : null;
	/** The bundle's photos: its styled photo first, then each piece's main photo in level order (A08). */
	readonly photos = signal<BundleBuilderView['photos']>([]);
	/** The styled photo's tile for the picker, once chosen in this visit. */
	readonly styledTile = signal<PickedAttachment | null>(null);
	/** Categories and tags, from the same lists as the product form (A05 Details). */
	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'product', status: 1 }));
	readonly categories = computed(() => this.categoriesQuery.data()?.data ?? []);
	readonly tagsQuery = injectTagsQuery(() => ({ type: 'product', status: 1 }));
	readonly tags = computed(() => this.tagsQuery.data()?.data ?? []);
	/**
	 * The dropdowns' starting selection, set once on load: they announce their selection again whenever this input
	 * changes, so it must not follow the details (the product form does the same).
	 */
	readonly startCategories = signal<string[]>([]);
	readonly startTags = signal<string[]>([]);
	private page: CatalogPageBundle | null = null;
	private frameReady = false;
	private draftTimer: ReturnType<typeof setTimeout> | null = null;

	/** Product search for "Add product": live products, hidden ones included (P10), never bundles. */
	readonly search = signal('');
	readonly results = signal<AdminProductRow[]>([]);
	readonly addingTo = signal<string | null>(null);

	readonly methods = computed<BundlePriceMethodRow[]>(() => this.view()?.methods ?? []);
	readonly method = computed(() => this.methods().find((row) => row.id === this.draft()?.pricing.methodId) ?? null);
	readonly anySale = computed(() => [...this.items().values()].some((item) => item.saleINR !== null));
	readonly errors = computed(() => this.checks().filter((check) => check.severity === 'error'));
	/** The set's own rules in plain words (C04), read when drawn so they follow the language once it has loaded. */
	ruleWords(): string[] {
		const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
		return (this.draft()?.pricing.rules ?? []).map((rule) =>
			ruleSentence(rule, t, this.method()?.inputs ?? [], this.lang()),
		);
	}

	constructor() {
		if (!this.isBrowser) return;
		void this.load();
		const listen = (event: MessageEvent) => {
			const data = event.data as { type?: string } | null;
			if (event.origin !== new URL(runtimeConfig.siteUrl).origin || data?.type !== 'st-bundle-preview-ready')
				return;
			this.frameReady = true;
			this.post();
		};
		window.addEventListener('message', listen);
		inject(DestroyRef).onDestroy(() => {
			window.removeEventListener('message', listen);
			this.editor?.destroy();
		});
	}

	private async load(): Promise<void> {
		const view = await firstValueFrom(this.bundles.builder(this.productId));
		this.apply(view);
		const product = view.product;
		this.draft.set(
			view.bundle
				? {
						levels: view.bundle.levels,
						extras: view.bundle.extras,
						pricing: view.bundle.pricing,
						saleWindow: view.bundle.saleWindow,
						styledPhoto: view.bundle.styledPhoto,
						dearerReason: view.bundle.dearerReason,
					}
				: {
						levels: [],
						extras: [],
						pricing: {
							methodId: view.methods.find((m) => m.active)?.id ?? '',
							params: {},
							rules: [],
							combine: 'all',
							capAtSeparately: false,
							roundTo: 'one',
						},
						saleWindow: null,
						styledPhoto: null,
						dearerReason: null,
					},
		);
		this.details.set({
			title: product.title,
			shortDescription: product.shortDescription,
			description: product.description,
			categoryIds: product.categoryIds,
			tags: product.tags,
			seo: product.seo,
			faqEnabled: product.faqEnabled,
			faq: product.faq,
			featured: product.featured,
			showOnShop: product.showOnShop,
			lowStockThreshold: product.lowStockThreshold,
		});
		this.startCategories.set(product.categoryIds);
		this.startTags.set(product.tags);
		await this.openPreview();
	}

	private apply(next: Pick<BundleBuilderView, 'items' | 'checks' | 'page'> & Partial<BundleBuilderView>): void {
		if (next.product) this.view.set(next as BundleBuilderView);
		if (next.photos) this.photos.set(next.photos);
		this.items.set(new Map(next.items.map((item) => [item.key, item])));
		this.checks.set(next.checks);
		this.page = next.page;
		this.post();
	}

	/** The shop's own set block, framed (the Page Builder's private preview address). */
	private async openPreview(): Promise<void> {
		const { code } = await firstValueFrom(this.bundles.previewCode(this.productId));
		const shop = runtimeConfig.siteUrl.replace(/\/$/, '');
		const locale = encodeURIComponent(this.transloco.getActiveLang() || 'en');
		this.previewUrl.set(
			this.sanitizer.bypassSecurityTrustResourceUrl(
				`${shop}/${locale}/__preview/bundle?code=${encodeURIComponent(code)}`,
			),
		);
	}

	private post(): void {
		const target = this.frame()?.nativeElement.contentWindow;
		if (!target || !this.frameReady) return;
		target.postMessage(
			{ type: 'st-bundle-preview', name: this.details()?.title['en'] ?? '', bundle: this.page },
			new URL(runtimeConfig.siteUrl).origin,
		);
	}

	/** Every change works the draft out again (debounced): new prices, checks and preview. */
	change(mutate: (draft: ProductBundleWrite) => ProductBundleWrite): void {
		const current = this.draft();
		if (!current) return;
		this.draft.set(mutate(structuredClone(current)));
		this.dirty.set(true);
		if (this.draftTimer) clearTimeout(this.draftTimer);
		this.draftTimer = setTimeout(() => void this.refresh(), 300);
	}

	private async refresh(): Promise<void> {
		const draft = this.draft();
		if (!draft) return;
		// A level just switched to "A category" waits for the category before the set is worked out again.
		if (draft.levels.some((level) => level.source.kind === 'category' && !level.source.categoryId)) return;
		try {
			this.apply(await firstValueFrom(this.bundles.draft(this.productId, draft)));
		} catch {
			// A half-made level (no items yet) is fine to keep editing; the checks say what is missing.
		}
	}

	item(key: string): BundleBuilderItem | undefined {
		return this.items().get(key);
	}

	/** An item's key in its bundle, as the API names it (contracts' bundleItemKey; contracts are types-only here). */
	keyOf(item: BundleItem): string {
		return item.variantId ? `${item.productId}:${item.variantId}` : item.productId;
	}

	setMethod(methodId: string): void {
		const method = this.methods().find((row) => row.id === methodId);
		const params = Object.fromEntries(
			(method?.inputs ?? []).flatMap((input) => (input.default === null ? [] : [[input.code, input.default]])),
		);
		this.change((draft) => ({ ...draft, pricing: { ...draft.pricing, methodId, params } }));
	}

	setParam(code: string, value: string): void {
		const number = Number(value);
		this.change((draft) => ({
			...draft,
			pricing: {
				...draft.pricing,
				params: {
					...draft.pricing.params,
					...(value === '' || !Number.isFinite(number) ? {} : { [code]: number }),
				},
			},
		}));
	}

	addLevel(): void {
		this.change((draft) => {
			const n = draft.levels.length + 1;
			const level: BundleLevel = {
				code: `level-${Date.now().toString(36)}`,
				label: { en: `Level ${n}`, bn: `ধাপ ${n}` },
				take: 1,
				source: { kind: 'items' },
				items: [],
				priceMode: 'difference',
			};
			return { ...draft, levels: [...draft.levels, level] };
		});
	}

	removeLevel(at: number): void {
		this.change((draft) => ({ ...draft, levels: draft.levels.filter((_, index) => index !== at) }));
	}

	setLevel(at: number, patch: Partial<BundleLevel>): void {
		this.change((draft) => ({
			...draft,
			levels: draft.levels.map((level, index) => (index === at ? { ...level, ...patch } : level)),
		}));
	}

	setLevelName(at: number, text: string): void {
		const level = this.draft()?.levels[at];
		if (level) this.setLevel(at, { label: { ...level.label, [this.lang()]: text } as BundleLevel['label'] });
	}

	setPrice(where: 'level' | 'extra', at: number, itemAt: number, value: string): void {
		const priceInSetINR = value.trim() === '' ? null : Math.max(0, Math.round(Number(value)));
		this.change((draft) =>
			where === 'extra'
				? {
						...draft,
						extras: draft.extras.map((row, index) => (index === itemAt ? { ...row, priceInSetINR } : row)),
					}
				: {
						...draft,
						levels: draft.levels.map((level, index) =>
							index === at
								? {
										...level,
										items: level.items.map((row, i) =>
											i === itemAt ? { ...row, priceInSetINR } : row,
										),
									}
								: level,
						),
					},
		);
	}

	/** One item's own settings: how many go in a set, and its size (S8). */
	setItem(where: 'level' | 'extra', at: number, itemAt: number, patch: Partial<BundleItem>): void {
		this.change((draft) =>
			where === 'extra'
				? {
						...draft,
						extras: draft.extras.map((row, index) => (index === itemAt ? { ...row, ...patch } : row)),
					}
				: {
						...draft,
						levels: draft.levels.map((level, index) =>
							index === at
								? {
										...level,
										items: level.items.map((row, i) => (i === itemAt ? { ...row, ...patch } : row)),
									}
								: level,
						),
					},
		);
	}

	/** "2 × petticoat", or "2.5 m" of fabric sold by the metre (kept in tenths of a metre). */
	quantityText(row: BundleItem): string {
		return this.item(this.keyOf(row))?.soldBy === 'metre' ? String(row.quantity / 10) : String(row.quantity);
	}

	setQuantity(where: 'level' | 'extra', at: number, itemAt: number, row: BundleItem, value: string): void {
		const metre = this.item(this.keyOf(row))?.soldBy === 'metre';
		const typed = Number(value);
		if (!Number.isFinite(typed) || typed <= 0) return;
		this.setItem(where, at, itemAt, { quantity: Math.max(1, Math.round(metre ? typed * 10 : typed)) });
	}

	/** A pinned size or colour, or "shopper chooses" (null) when the product has several (S8). */
	setVariant(where: 'level' | 'extra', at: number, itemAt: number, variantId: string): void {
		this.setItem(where, at, itemAt, { variantId: variantId || null });
	}

	/** Where a level's products come from: picked one by one, or a category's newest live products (S10). */
	setSource(at: number, kind: 'items' | 'category', categoryId?: string, limit?: number): void {
		const source: BundleLevelSource =
			kind === 'category'
				? { kind: 'category', categoryId: categoryId ?? '', limit: limit ?? 12 }
				: { kind: 'items' };
		this.setLevel(at, { source });
	}

	/** Every category, flattened with its path, for the level's category choice. */
	readonly categoryChoices = computed(() => {
		const out: { id: string; name: string }[] = [];
		const walk = (
			rows: readonly { id: string | number; name: string; subcategories?: unknown[] }[],
			path: string,
		) => {
			for (const row of rows) {
				const name = path ? `${path} › ${row.name}` : row.name;
				out.push({ id: String(row.id), name });
				walk((row.subcategories ?? []) as typeof rows, name);
			}
		};
		walk(this.categories() as unknown as { id: string; name: string; subcategories?: unknown[] }[], '');
		return out;
	});

	removeItem(where: 'level' | 'extra', at: number, itemAt: number): void {
		this.change((draft) =>
			where === 'extra'
				? { ...draft, extras: draft.extras.filter((_, index) => index !== itemAt) }
				: {
						...draft,
						levels: draft.levels.map((level, index) =>
							index === at
								? {
										...level,
										items: level.items.filter((_, i) => i !== itemAt),
										take: Math.min(level.take, Math.max(1, level.items.length - 1)),
									}
								: level,
						),
					},
		);
	}

	async find(text: string): Promise<void> {
		this.search.set(text);
		if (text.trim().length < 2) return this.results.set([]);
		const list = await firstValueFrom(this.products.getCatalogProducts({ search: text.trim(), pageSize: 10 }));
		this.results.set(
			list.items.filter(
				(row) => (row as AdminProductRow).type !== 'bundle' && row.id !== this.productId,
			) as AdminProductRow[],
		);
	}

	/** Adds a product to a level (or "extras"); hidden products can be picked (P10). */
	add(row: AdminProductRow): void {
		const target = this.addingTo();
		const item: BundleItem = { productId: row.id, variantId: null, quantity: 1, priceInSetINR: null };
		this.change((draft) =>
			target === 'extras'
				? {
						...draft,
						extras: draft.extras.some((x) => x.productId === row.id)
							? draft.extras
							: [...draft.extras, item],
					}
				: {
						...draft,
						levels: draft.levels.map((level) =>
							level.code === target && !level.items.some((x) => x.productId === row.id)
								? { ...level, items: [...level.items, item] }
								: level,
						),
					},
		);
		this.search.set('');
		this.results.set([]);
		this.addingTo.set(null);
	}

	setDetail<K extends keyof BundleDetailsWrite>(key: K, value: BundleDetailsWrite[K]): void {
		const current = this.details();
		if (current) this.details.set({ ...current, [key]: value });
		this.dirty.set(true);
	}

	/** The FAQ's tab, in the product form's own part (switch and questions); one object until the details change. */
	readonly faqValue = computed<FaqValue>(() => {
		const details = this.details();
		return { enabled: details?.faqEnabled ?? false, rows: details?.faq ?? [] };
	});

	setFaq(value: FaqValue): void {
		const current = this.details();
		if (!current) return;
		this.details.set({ ...current, faqEnabled: value.enabled, faq: value.rows });
		this.dirty.set(true);
	}

	/**
	 * The dropdowns announce their selection item by item (and again on start), always in the same list; it is read a
	 * moment later, once complete, and only a real change marks the bundle changed.
	 */
	setCategories(ids: unknown): void {
		if (!Array.isArray(ids)) return;
		queueMicrotask(() => {
			const next = ids.map(String);
			if (next.join('|') !== (this.details()?.categoryIds ?? []).join('|')) this.setDetail('categoryIds', next);
		});
	}

	setTags(ids: unknown): void {
		if (!Array.isArray(ids)) return;
		queueMicrotask(() => {
			const next = ids.map(String);
			if (next.join('|') !== (this.details()?.tags ?? []).join('|')) this.setDetail('tags', next);
		});
	}

	/** The styled photo (A08 suggestion): a picture of the whole set, shown before the pieces' photos. */
	pickStyled(value: ImageUploadValue): void {
		if (Array.isArray(value)) return;
		const data = onePicture(value);
		this.styledTile.set(data);
		this.change((draft) => ({
			...draft,
			styledPhoto: data ? { assetId: String(data.id), versionId: data.versionId ?? null } : null,
		}));
	}

	/** Where a linked photo comes from: the piece's name, or "Styled photo". */
	photoFrom(key: string | null): string {
		if (!key) return this.transloco.translate('bundle_styled_photo');
		return this.item(key)?.title ?? key;
	}

	/** The sale window's dates as the date boxes show them (yyyy-mm-dd). */
	windowDay(which: 'from' | 'to'): string {
		return this.draft()?.saleWindow?.[which]?.slice(0, 10) ?? '';
	}

	setWindow(which: 'from' | 'to', day: string): void {
		this.change((draft) => {
			const window = { from: draft.saleWindow?.from ?? null, to: draft.saleWindow?.to ?? null };
			window[which] = day
				? new Date(`${day}T${which === 'from' ? '00:00:00' : '23:59:59'}+05:30`).toISOString()
				: null;
			return { ...draft, saleWindow: window.from || window.to ? window : null };
		});
	}

	setText(key: 'title' | 'shortDescription' | 'description', text: string): void {
		const current = this.details();
		// The editor writes the text back once on start; an unchanged text keeps the bundle unchanged.
		if ((current?.[key][this.lang()] ?? '') === text) return;
		if (current) this.setDetail(key, { ...current[key], [this.lang()]: text } as BundleDetailsWrite[typeof key]);
	}

	setSeo(key: 'title' | 'description', text: string): void {
		const current = this.details();
		if (current) this.setDetail('seo', { ...current.seo, [key]: { ...current.seo[key], [this.lang()]: text } });
	}

	async save(): Promise<void> {
		const draft = this.draft();
		const details = this.details();
		if (!draft || !details) return;
		this.saving.set(true);
		try {
			await firstValueFrom(this.bundles.details(this.productId, details));
			this.apply(await firstValueFrom(this.bundles.build(this.productId, draft)));
			this.dirty.set(false);
			this.notifier.showSuccess(this.transloco.translate('bundle_saved'));
		} catch {
			this.notifier.showError(this.transloco.translate('bundle_not_saved'));
		} finally {
			this.saving.set(false);
		}
	}

	async goLive(): Promise<void> {
		await this.save();
		const result = await firstValueFrom(this.products.goLive(this.productId));
		if (result.live) {
			this.notifier.showSuccess(this.transloco.translate('bundle_live'));
			void this.load();
		} else this.notifier.showError(this.transloco.translate('bundle_go_live_gaps', { count: result.gaps.length }));
	}

	/** How the set is priced after its method: the rules, how they combine, and rounding. */
	setPricing(patch: Partial<BundlePricing>): void {
		this.change((draft) => ({ ...draft, pricing: { ...draft.pricing, ...patch } }));
	}

	draftCap(on: boolean) {
		return (draft: ProductBundleWrite): ProductBundleWrite => ({
			...draft,
			pricing: { ...draft.pricing, capAtSeparately: on },
		});
	}

	draftReason(text: string) {
		return (draft: ProductBundleWrite): ProductBundleWrite => ({ ...draft, dearerReason: text.trim() || null });
	}

	checkText(check: BundleCheckView): string {
		const level = this.draft()?.levels.find((row) => row.code === check.level);
		return this.transloco.translate(`bundle_check_${check.code}`, {
			level: level ? (level.label[this.lang()] ?? level.label.en) : (check.level ?? ''),
			item: check.key ? (this.item(check.key)?.title ?? check.key) : '',
			input: check.input ?? '',
			total: check.totalINR ?? '',
			separately: check.separatelyINR ?? '',
		});
	}
}
