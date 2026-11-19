import { isPlatformBrowser, AsyncPipe, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
	Component,
	computed,
	DOCUMENT,
	effect,
	forwardRef,
	inject,
	input,
	PLATFORM_ID,
	Renderer2,
	signal,
	untracked,
	viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
	AbstractControl,
	FormArray,
	FormBuilder,
	FormControl,
	FormGroup,
	ReactiveFormsModule,
	ValidationErrors,
	Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import {
	NgbAccordionBody,
	NgbAccordionButton,
	NgbAccordionCollapse,
	NgbAccordionDirective,
	NgbAccordionHeader,
	NgbAccordionItem,
	NgbAccordionToggle,
	NgbCalendar,
	NgbCollapse,
	NgbDate,
	NgbDateParserFormatter,
	NgbInputDatepicker,
	NgbNav,
	NgbNavContent,
	NgbNavItem,
	NgbNavItemRole,
	NgbNavLink,
	NgbNavLinkBase,
	NgbNavOutlet,
	NgbModal,
} from '@ng-bootstrap/ng-bootstrap';
import { chargeableGrams, volumetricGrams } from '@saha-textile/core-domain/shipping';
import { Select2, Select2Data, Select2SearchEvent } from 'ng-select2-component';
import { Editor, NgxEditorModule } from 'ngx-editor';
import { firstValueFrom, Observable, of, Subject } from 'rxjs';
import { debounceTime, switchMap, takeUntil } from 'rxjs/operators';

import { goLiveLabels, goLiveToast } from '@core/catalog/go-live-report';
import { nextInProductQueue } from '@core/catalog/product-queue';
import { ActiveLanguages } from '@core/i18n/active-languages';
import {
	focusField,
	gapsByLocale,
	type LanguageGap,
	LocalizedFields,
	type LocalizedText,
	SOURCE_LOCALE,
} from '@core/i18n/localized-fields';
import { StockGateway } from '@core/purchasing/stock.gateway';
import { injectShippingExceptionsQuery, injectShippingOverviewQuery } from '@core/shipping/shipping.gateway';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import {
	CATALOG_BADGE_CODES,
	CatalogBadgeCode,
	CatalogProductDetail,
	CatalogProductWrite,
	CatalogVariantView,
} from '@data-access/interfaces/catalog-product.interface';
import { ICategory, ICategoryModel } from '@data-access/interfaces/category.interface';
import { Params } from '@data-access/interfaces/core.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectCatalogProductsQuery } from '@data-access/queries/product.queries';
import { injectTagsQuery } from '@data-access/queries/tag.queries';
import { injectTaxesQuery } from '@data-access/queries/tax.queries';
import { AddonTemplateRow, AddonTemplateService } from '@data-access/services/addon-template.service';
import { AttributeService } from '@data-access/services/attribute.service';
import { NotificationService } from '@data-access/services/notification.service';
import { ProductDraftService } from '@data-access/services/product-draft.service';
import { ProductService } from '@data-access/services/product.service';
import { askConfirm } from '@features/purchasing/shared/popups';
import { metresText } from '@features/purchasing/shared/purchasing-labels';
import { AdjustPopup } from '@features/stock/adjust-popup';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload, type PickedAttachment } from '@shared/ui/image-upload/image-upload';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';
import { YouTubeVideosField } from '@shared/ui/youtube-videos-field/youtube-videos-field';
import { priceValidator } from '@shared/validators/price-validator';

import { DRAFT_MARKS, DraftMarkDirective, type DraftMarks } from './draft-mark';
import { type DraftConflict, type LeaveChoice, ProductConflictPopup, ProductLeavePopup } from './draft-popups';
import { HsnPopup, hsnValid } from './hsn-popup';
import {
	type CategoryDefaults,
	categoryRefill,
	metreProblem,
	metresToTenths,
	type SoldBy,
	stockFigures,
	stockStatusKey,
	tenthsToMetres,
} from './inventory-fields';
import { OptionGroups } from './option-groups/option-groups';
import { ProductBundleForm } from './product-bundle/product-bundle';
import { FaqValue, ProductFaq } from './product-faq/product-faq';
import { ImageCombination, ProductImages } from './product-images/product-images';
import { categoryChain, inheritedCharge, type InheritedCharge, productExceptions } from './shipping-tab';
import {
	DRAFT_VERSION,
	changedPaths,
	describeValue,
	draftTab,
	fingerprint,
	flattenSnapshot,
	type ProductFormSnapshot,
	stable,
} from './product-draft-state';
import { variantCombinations } from './variant-combinations';
import { environment } from '../../../../../public/environments/environment';

import { MenuStore } from '@core/state/menu.store';
import { languageName } from '@saha-textile/core-domain/languages';

import type {
	AttributeDefinition,
	GoLiveGap,
	ProductDraft,
	ProductBundleWrite,
	ProductContentWrite,
	ProductCreate,
	ProductOptionGroup,
	PictureRef,
	ProductVideo,
	QuickLength,
	ShippingChargeKind,
	ShippingExceptionChoice,
} from '@saha-textile/contracts';

const LANGUAGE_FIELDS = [
	'name',
	'short_description',
	'description',
	'meta_title',
	'meta_description',
	'estimated_delivery_text',
];

const SAREE_ROOT_SLUG = 'sarees';

/** An HSN has 4, 6 or 8 digits (F02C), spaces round it ignored as the API does; empty is allowed. */
function hsnField(control: AbstractControl): ValidationErrors | null {
	const value = control.value === null || control.value === undefined ? '' : String(control.value).trim();
	return value === '' || hsnValid(value) ? null : { hsn: true };
}

/** The Sarees category and everything under it. */
function sareeCategoryIds(tree: readonly ICategory[], inside = false): Set<string> {
	const found = new Set<string>();
	for (const row of tree) {
		const saree = inside || row.slug === SAREE_ROOT_SLUG;
		if (saree) found.add(String(row.id));
		for (const id of sareeCategoryIds(row.subcategories ?? [], saree)) found.add(id);
	}
	return found;
}

/** Where each Go Live gap is fixed. Anything else is an option, value or price on Inventory. */
const GAP_TABS: Readonly<Record<string, string>> = {
	title: 'general',
	name: 'general',
	estimated_delivery_text: 'shipping',
	short_description: 'general',
	description: 'general',
	category: 'general',
	meta_title: 'seo',
	meta_description: 'seo',
	primary_image: 'images',
	image_alt: 'images',
	image_sizes: 'images',
	lead_time: 'shipping',
	faq_question: 'faq',
	faq_answer: 'faq',
};

const blankToNull = (value: unknown): number | null =>
	value === '' || value === null || value === undefined || Number.isNaN(Number(value)) ? null : Number(value);

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** MRP may be empty; when set, the selling price may not be above it. */
function sellingWithinMrp(group: AbstractControl): ValidationErrors | null {
	const mrp = blankToNull(group.get('mrp')?.value);
	const selling = blankToNull(group.get('price')?.value);
	return mrp !== null && selling !== null && selling > mrp ? { sellingAboveMrp: true } : null;
}

@Component({
	selector: 'app-form-product',
	templateUrl: './form-product.html',
	styleUrls: ['./form-product.scss'],
	imports: [
		ReactiveFormsModule,
		NgbNav,
		NgbNavItem,
		NgbNavItemRole,
		NgbNavLink,
		NgbNavLinkBase,
		NgbNavContent,
		FormFields,
		NgxEditorModule,
		Select2,
		NgbInputDatepicker,
		Button,
		NgbAccordionDirective,
		NgbAccordionItem,
		NgbAccordionHeader,
		NgbAccordionToggle,
		NgbAccordionButton,
		NgbCollapse,
		NgbAccordionCollapse,
		NgbAccordionBody,
		ImageUpload,
		ProductFaq,
		LanguageSwitch,
		OptionGroups,
		ProductBundleForm,
		ProductImages,
		YouTubeVideosField,
		AdvancedDropdown,
		NgbNavOutlet,
		TranslocoModule,
		AsyncPipe,
		DatePipe,
		CurrencySymbolPipe,
		HasPermissionDirective,
		RouterLink,
		DraftMarkDirective,
	],
	providers: [{ provide: DRAFT_MARKS, useExisting: forwardRef(() => FormProduct) }],
	host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class FormProduct implements DraftMarks {
	private productService = inject(ProductService);
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private http = inject(HttpClient);
	private formBuilder = inject(FormBuilder);
	private calendar = inject(NgbCalendar);
	formatter = inject(NgbDateParserFormatter);
	private renderer = inject(Renderer2);
	private transloco = inject(TranslocoService);
	private document = inject<Document>(DOCUMENT);
	private attributes = inject(AttributeService);
	private templates = inject(AddonTemplateService);
	private notifier = inject(NotificationService);
	private modals = inject(NgbModal);
	private stockGateway = inject(StockGateway);
	private drafts = inject(ProductDraftService);
	private menu = inject(MenuStore);

	// ── Save as draft (product bulk actions brief § 7) ──────────────────────────────────────
	/** The draft open on the form, if any. */
	readonly draft = signal<{ id: string; kind: 'new' | 'edit'; savedAt: string; createdAt: string } | null>(null);
	/** A draft of this product that is not open: yours (Continue or Discard) or a colleague's (a note). */
	readonly waitingDraft = signal<{ id: string; mine: boolean; updatedAt: string; changed: number } | null>(null);
	/** Fields both you and someone else changed after your draft began: asked on Update Product. */
	readonly conflicts = signal<DraftConflict[]>([]);
	/** The changed fields of a draft of changes, with their values in the product. */
	readonly changes = signal<ReadonlyMap<string, unknown>>(new Map());
	readonly changedTabs = computed(() =>
		this.draft()?.kind === 'edit' ? new Set([...this.changes().keys()].map(draftTab)) : new Set<string>(),
	);
	/** The product as it was when the form opened: what a draft of changes is compared with. */
	private base: ProductFormSnapshot | null = null;
	/** The form as last saved (or opened), for "anything unsaved?". */
	private savedPrint: string | null = null;
	/** Set on the way out after a save, so the leave question is not asked. */
	private leaving = false;

	readonly type = input<string>(undefined);

	/**
	 * F01: the typed Stock quantity box is replaced by the stock figures and their buttons. Its
	 * markup and form control stay until the owner types its removal (end-of-project cleanup list).
	 */
	readonly typedStockBox = false;
	/** Piece or metre (P11); fixed once the product has stock, stock history or orders. */
	readonly soldBy = signal<SoldBy>('piece');
	readonly soldByLocked = signal(false);
	/** '' follows the main category; 'yes' or 'no' is this product's own answer (P13). */
	readonly returnableChoice = signal<'' | 'yes' | 'no'>('');
	/** The metre fields (A01), as typed: metres, inches and grams. */
	readonly metreCut = signal('1.0');
	readonly metreWidth = signal('');
	readonly metreWeight = signal('');
	readonly quickLengths = signal<Array<{ length: string; label: Record<string, string> }>>([]);
	readonly metreError = signal<string | null>(null);
	/** "Changed from 5007" under the HSN after a category change (F02). */
	readonly hsnChangedFrom = signal<string | null>(null);
	/** Each variant's stock as the API last sent it (F01). */
	readonly variantStock = signal<ReadonlyMap<string, CatalogVariantView>>(new Map());
	/** Every category's HSN and returnability, from the category tree the form already reads. */
	readonly categoryDefaults = computed<ReadonlyMap<string, CategoryDefaults>>(() => {
		const flat = (rows: readonly ICategory[]): ICategory[] =>
			rows.flatMap((row) => [row, ...flat(row.subcategories ?? [])]);
		return new Map(
			flat(this.categoriesQuery.data()?.data ?? []).map((row) => [
				String(row.id),
				{
					id: String(row.id),
					name: row.name,
					hsnCode: row.row?.hsnCode ?? null,
					returnable: row.row?.returnable ?? true,
					parentId: row.row?.parentId ?? row.parent_id ?? null,
					shipping: row.row?.shipping ?? null,
				},
			]),
		);
	});
	/** The main (first) category's defaults: HSN and "Can be returned" follow it (F02, PD3). */
	readonly mainCategory = computed<CategoryDefaults | null>(() => {
		const id = this.chosenCategories()[0];
		return (id ? this.categoryDefaults().get(String(id)) : null) ?? this.catalogProduct?.mainCategory ?? null;
	});
	/** The product's own shipping charges (shipping brief prd01); null follows its main category. */
	readonly ownCharges = signal<Record<ShippingChargeKind, number | null>>({
		domestic: null,
		internationalFirst: null,
		internationalFurther: null,
	});
	readonly chargeKinds: ShippingChargeKind[] = ['domestic', 'internationalFirst', 'internationalFurther'];

	/** Shop-wide default charges and the exceptions, for what this product inherits (shipping brief prd01). */
	private readonly shippingOverview = injectShippingOverviewQuery();
	private readonly shippingExceptions = injectShippingExceptionsQuery();
	/** The main category, then its parents nearest first. */
	private readonly shippingChain = computed(() =>
		categoryChain(
			this.chosenCategories()[0] ?? this.catalogProduct?.mainCategory?.id ?? null,
			this.categoryDefaults(),
		),
	);

	/** What a charge follows while its switch is on: the nearest category's value, else the shop default. */
	inheritedCharge(kind: ShippingChargeKind): InheritedCharge {
		const overview = this.shippingOverview.data();
		const shopDefault = overview ? (overview.settings ?? overview.defaults).defaultCharges : null;
		return inheritedCharge(kind, this.shippingChain(), this.categoryDefaults(), shopDefault);
	}

	/** The zones an exception decides for this product, for the "Shipping rules" row. */
	readonly zoneExceptions = computed(() => {
		const overview = this.shippingOverview.data();
		return productExceptions(
			this.id ?? null,
			this.shippingChain(),
			overview ? (overview.settings ?? overview.defaults) : null,
			this.shippingExceptions.data() ?? [],
		);
	});

	exceptionLabel(choice: ShippingExceptionChoice): string {
		if (choice.kind !== 'ruleSet') return this.transloco.translate(`ship_choice_${choice.kind}`);
		return this.shippingOverview.data()?.ruleSets.find((r) => r.id === choice.ruleSetId)?.name ?? choice.ruleSetId;
	}

	rupees(amountINR: number): string {
		return `₹${amountINR.toLocaleString('en-IN')}`;
	}

	/** The "use the category's value" switch: on clears the product's own value; off starts from the category's. */
	followCategoryCharge(kind: ShippingChargeKind, follow: boolean) {
		this.ownCharges.update((own) => ({
			...own,
			[kind]: follow ? null : (this.inheritedCharge(kind).amountINR ?? 0),
		}));
		this.form.markAsDirty();
	}

	setOwnCharge(kind: ShippingChargeKind, value: unknown) {
		const n = Number(value);
		this.ownCharges.update((own) => ({
			...own,
			[kind]: value === '' || value === null || !Number.isFinite(n) || n < 0 ? 0 : n,
		}));
		this.form.markAsDirty();
	}

	/** Volumetric and chargeable weight for the box and weight typed on this tab (grams). */
	shippingWeights(): { volumetric: number | null; chargeable: number | null } {
		const raw = this.form.getRawValue() as Record<string, unknown>;
		const box = {
			weightGrams: blankToNull(raw['weight']),
			lengthCm: blankToNull(raw['length_cm']),
			widthCm: blankToNull(raw['width_cm']),
			heightCm: blankToNull(raw['height_cm']),
		};
		return { volumetric: volumetricGrams(box), chargeable: chargeableGrams(box) };
	}

	readonly totals = computed(() => stockFigures([...this.variantStock().values()]));
	/** F01: In stock, Low stock or Out of stock, from free to sell; made to order keeps selling. */
	stockStatus(): string {
		return stockStatusKey(this.totals().free, this.lowLevelUnits(), Boolean(this.form.get('made_to_order')?.value));
	}

	readonly nav = viewChild<NgbNav>('nav');

	private readonly productParams = signal<Params>({
		search: '',
		paginate: 15,
		ids: '',
		with_union_products: 0,
		is_approved: 1,
	});
	private readonly productsQuery = injectCatalogProductsQuery(() => ({
		search: String(this.productParams()['search']) || undefined,
		pageSize: 100,
	}));
	products$: Observable<Select2Data> = toObservable(
		computed(() =>
			(this.productsQuery.data()?.items ?? [])
				.filter((row) => row.id !== this.id)
				.map((row) => ({
					label: row.title,
					value: row.id,
					data: {
						type: row.variantCount > 1 ? 'classified' : 'simple',
						name: row.title,
						slug: row.slug,
						stock_status: row.stock > 0 ? 'in_stock' : 'out_of_stock',
						image: row.thumbnailUrl ?? 'assets/images/product.png',
					},
				})),
		),
	);
	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'product', status: 1 }));
	category$: Observable<ICategoryModel | undefined> = toObservable(this.categoriesQuery.data);
	readonly tagsQuery = injectTagsQuery(() => ({ type: 'product', status: 1 }));
	private readonly taxesQuery = injectTaxesQuery(() => ({ status: 1 }));
	readonly taxes = computed(
		() => this.taxesQuery.data()?.data.map((tax) => ({ label: tax.name, value: tax.id })) ?? [],
	);
	public active = 'general';
	public tabError: string | null;
	public form: FormGroup;
	public id: string;
	/** The product as the catalogue API holds it; set on edit. */
	public catalogProduct: CatalogProductDetail | null = null;
	public replacementTargets: Select2Data = [];
	public badgeOptions: Select2Data = [];
	public statusOptions: Select2Data = [];
	public availabilityOptions: Select2Data = [];
	public selectedCategories: string[] = [];
	private readonly chosenCategories = signal<string[]>([]);
	/** Saree length and blouse piece apply to anything under the Sarees category. */
	readonly showsLengths = computed(() => {
		const sarees = sareeCategoryIds(this.categoriesQuery.data()?.data ?? []);
		return this.chosenCategories().some((id) => sarees.has(String(id)));
	});
	public selectedTags: Number[] = [];
	public fromDate: NgbDate | null;
	public toDate: NgbDate | null;
	public hoveredDate: NgbDate | null = null;
	public collectionProduct: Select2Data;
	public product: IProduct;
	private destroy$ = new Subject<void>();
	public isBrowser: boolean;

	public productType: Select2Data = [
		{
			value: 'simple',
			label: 'Simple',
		},
		{
			value: 'classified',
			label: 'Variable',
		},
		{
			value: 'bundle',
			label: 'Bundle',
		},
	];

	public stocks: Select2Data = [
		{
			value: 'in_stock',
			label: 'In Stock',
		},
		{
			value: 'out_of_stock',
			label: 'Out of Stock',
		},
	];

	public filter = {
		search: '',
		paginate: 15,
		ids: '',
		with_union_products: 0,
		is_approved: 1,
	};

	private search = new Subject<string>();
	public editor: Editor;
	public html = '';

	readonly locales = inject(ActiveLanguages).list();
	/** Language-bound fields behind the Language switch. */
	readonly fields: LocalizedFields;
	readonly gaps = signal<Record<string, LanguageGap[]>>({});
	readonly definitions = signal<AttributeDefinition[]>([]);
	readonly imageSizes = signal<ReadonlyMap<string, readonly [number, number]>>(new Map());
	/** Axes that already have saved variant rows, so a role change asks first. */
	readonly savedAxes = signal<string[]>([]);
	readonly addonTemplates = signal<AddonTemplateRow[]>([]);
	readonly addonTemplateCode = signal<string | null>(null);
	readonly optionGroups = signal<ProductOptionGroup[]>([]);
	/** The FAQ tab: the switch and this product's own questions, every language. */
	readonly faq = signal<FaqValue>({ enabled: false, rows: [] });
	readonly images = signal<
		Pick<ProductContentWrite, 'imageMode' | 'gallery' | 'compound' | 'altOverrides' | 'versions' | 'shareImage'>
	>({
		imageMode: 'simple',
		gallery: [],
		compound: [],
		altOverrides: {},
		versions: {},
		shareImage: null,
	});
	/** Each variant's own picture, by variant id (owner, 17 Nov: "Variation image"). */
	readonly variantImages = signal<ReadonlyMap<string, PictureRef | null>>(new Map());
	readonly tiles = signal<ReadonlyMap<string, string>>(new Map());
	/** The product's photos in Images-tab order, offered as swatch pictures in the Options tab. */
	readonly swatchPhotos = computed(() => {
		const { imageMode, gallery, compound } = this.images();
		return imageMode === 'simple' ? gallery : [...new Set(compound.flatMap((row) => row.gallery))];
	});
	readonly bundle = signal<ProductBundleWrite>({
		bundleType: 'fixed_kit',
		pricePolicy: 'sum_components',
		fixedPriceINR: null,
		groups: [],
	});
	readonly goLiveGaps = signal<GoLiveGap[]>([]);
	readonly bundleProducts = signal<Select2Data>([]);

	/** Every combination of the variation axes, for the compound image galleries. */
	readonly combinations = computed<ImageCombination[]>(() => {
		const locale = this.fields.locale();
		return variantCombinations(this.optionGroups()).map(({ selections, hash }) => ({
			hash,
			label: selections
				.map(({ attributeCode, termCode }) => {
					const group = this.optionGroups().find((row) => row.attributeCode === attributeCode);
					const term = group?.terms.find((row) => row.code === termCode);
					return term?.label[locale] ?? term?.label['en'] ?? termCode;
				})
				.join(' / '),
		}));
	});

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);

		this.form = this.formBuilder.group({
			/** Checked YouTube videos and Shorts for the product page, in order (up to five). */
			videos: new FormControl<ProductVideo[]>([], { nonNullable: true }),
			name: new FormControl(''),
			short_description: new FormControl(''),
			description: new FormControl(''),
			slug: new FormControl('', [Validators.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)]),
			type: new FormControl('simple', [Validators.required]),
			saree_length_m: new FormControl(),
			blouse_piece_m: new FormControl(),
			weight: new FormControl(),
			stock_status: new FormControl('in_stock', []),
			sku: new FormControl('', [Validators.required]),
			// Kept with the typed Stock quantity box (F01): stock now moves only through documents.
			quantity: new FormControl(0),
			price: new FormControl('', [Validators.required, priceValidator]),
			discount: new FormControl(),
			sale_starts_at: new FormControl(),
			sale_expired_at: new FormControl(),
			tags: new FormControl(),
			categories: new FormControl([]),
			related_products: new FormControl(),
			upsell_products: new FormControl([]),
			cross_sell_products: new FormControl([]),
			product_thumbnail_id: new FormControl(),
			product_galleries_id: new FormControl(),
			variations: this.formBuilder.array([], []),
			meta_title: new FormControl(),
			meta_description: new FormControl(),
			product_meta_image_id: new FormControl(),
			safe_checkout: new FormControl(1),
			secure_checkout: new FormControl(1),
			social_share: new FormControl(1),
			encourage_order: new FormControl(1),
			encourage_view: new FormControl(1),
			is_free_shipping: new FormControl(0),
			tax_id: new FormControl(''),
			estimated_delivery_text: new FormControl(),
			made_to_order: new FormControl(false),
			low_stock_threshold: new FormControl(null),
			pinned_badges: new FormControl<CatalogBadgeCode[]>([]),
			hidden_badges: new FormControl<CatalogBadgeCode[]>([]),
			replacement_path: new FormControl<string | null>(null),
			length_cm: new FormControl(),
			width_cm: new FormControl(),
			height_cm: new FormControl(),
			hsn_code: new FormControl<string | null>(null, [hsnField]),
			addon_price_inr: new FormControl(null),
			return_policy_text: new FormControl(),
			is_featured: new FormControl(0),
			status: new FormControl<string>('disabled'),
		});
		this.fields = new LocalizedFields(this.form, LANGUAGE_FIELDS, ['estimated_delivery_text']);
		this.form.valueChanges.pipe(debounceTime(250), takeUntilDestroyed()).subscribe(() => this.refreshMissing());
		effect(() => {
			this.optionGroups();
			this.faq();
			this.goLiveGaps();
			this.quickLengths();
			this.soldBy();
			untracked(() => this.refreshMissing());
		});
		// A draft of changes follows the lists and choices kept beside the form too.
		effect(() => {
			this.optionGroups();
			this.faq();
			this.images();
			this.bundle();
			this.quickLengths();
			this.soldBy();
			this.returnableChoice();
			this.ownCharges();
			this.metreCut();
			this.metreWidth();
			this.metreWeight();
			this.variantImages();
			this.addonTemplateCode();
			untracked(() => this.recomputeChanges());
		});

		this.transloco.selectTranslation().subscribe(() => this.buildOptions());
	}

	private buildOptions() {
		const t = (key: string) => this.transloco.translate(key);
		this.badgeOptions = CATALOG_BADGE_CODES.map((code) => ({ value: code, label: t(`badge_${code}`) }));
		this.availabilityOptions = [
			{ value: 'available', label: t('available') },
			{ value: 'unavailable', label: t('not_available') },
		];
		// The list never changes shape: a select that loses the current value mid-load clears it,
		// which saved every live product as disabled. Only Go Live can make a product live.
		const current = this.catalogProduct?.status;
		this.statusOptions = ['live', 'draft', 'disabled', 'discontinued'].map((status) => ({
			value: status,
			label: t(`product_status_${status}`),
			disabled: status === 'draft' || (status === 'live' && current !== 'live'),
		}));
	}

	/** Whole-rupee price for a percent off the MRP, rounded half up, shown before save. */
	percentPreview(variation: AbstractControl): { price: number; percent: number } | null {
		const mrp = blankToNull(variation.get('mrp')?.value);
		const selling = blankToNull(variation.get('price')?.value);
		if (mrp === null || selling === null || mrp <= 0 || selling >= mrp) return null;
		return { price: selling, percent: Math.floor(((mrp - selling) / mrp) * 100) };
	}

	applyPercent(variation: AbstractControl) {
		const mrp = blankToNull(variation.get('mrp')?.value);
		const percent = blankToNull(variation.get('discount')?.value);
		if (mrp === null || percent === null) return;
		variation.get('price')?.setValue(this.saleRupee(mrp, percent));
	}

	/** "450 · from product" placeholder for an empty variant measure that inherits. */
	fromProduct(control: string): string {
		const value = this.form.get(control)?.value;
		return value === null || value === undefined || value === ''
			? ''
			: this.transloco.translate('from_product', { value });
	}

	get isDiscontinuing(): boolean {
		return this.form.get('status')?.value === 'discontinued';
	}

	get madeToOrderAllowed(): boolean {
		return this.catalogProduct?.status === 'live' && this.form.get('status')?.value === 'live';
	}

	saleRupee(price: unknown, percent: unknown): number {
		const mrp = Number(price);
		const off = Number(percent);
		if (!Number.isFinite(mrp) || !Number.isFinite(off)) return 0;
		return Math.round((mrp * (100 - off)) / 100);
	}

	/** Fills the form from the catalogue API. Fields the API does not hold keep their defaults. */
	private applyCatalogProduct(detail: CatalogProductDetail) {
		this.catalogProduct = detail;
		this.id = detail.id;
		this.buildOptions();
		this.form.patchValue(
			{
				slug: detail.slug,
				sku: detail.sku,
				type: detail.type === 'variable' ? 'classified' : detail.type,
				weight: detail.shipping.weightGrams,
				length_cm: detail.shipping.lengthCm,
				width_cm: detail.shipping.widthCm,
				height_cm: detail.shipping.heightCm,
				hsn_code: detail.hsnCode,
				made_to_order: detail.madeToOrder,
				low_stock_threshold: detail.lowStockThreshold,
				pinned_badges: detail.pinnedBadges,
				hidden_badges: detail.hiddenBadges,
				replacement_path: detail.replacementPath,
				addon_price_inr: detail.addonPriceINR,
				is_featured: detail.featured,
				status: detail.status,
				related_products: detail.relatedProductIds,
				upsell_products: detail.upsellProductIds,
				cross_sell_products: detail.crossSellProductIds,
				videos: detail.videos,
			},
			{ emitEvent: false },
		);
		const { content } = detail;
		this.fields.load({
			name: content.title,
			short_description: content.shortDescription,
			description: content.description,
			meta_title: content.metaTitle,
			meta_description: content.metaDescription,
			estimated_delivery_text: content.estimatedDeliveryText,
		});
		this.form.get('type')?.disable({ emitEvent: false });
		this.soldBy.set(detail.soldBy ?? 'piece');
		this.soldByLocked.set(detail.soldByLocked ?? false);
		this.returnableChoice.set(
			detail.returnable === null || detail.returnable === undefined ? '' : detail.returnable ? 'yes' : 'no',
		);
		this.form.patchValue({ is_free_shipping: detail.freeShipping ?? false }, { emitEvent: false });
		this.ownCharges.set({
			domestic: detail.shippingCharges?.domesticINR ?? null,
			internationalFirst: detail.shippingCharges?.internationalFirstINR ?? null,
			internationalFurther: detail.shippingCharges?.internationalFurtherINR ?? null,
		});
		this.metreCut.set(tenthsToMetres(detail.metre?.shortestCutTenths ?? 10));
		this.metreWidth.set(
			detail.metre?.widthInches === null || detail.metre?.widthInches === undefined
				? ''
				: String(detail.metre.widthInches),
		);
		this.metreWeight.set(
			detail.metre?.weightPerMetreGrams === null || detail.metre?.weightPerMetreGrams === undefined
				? ''
				: String(detail.metre.weightPerMetreGrams),
		);
		this.quickLengths.set(
			(detail.metre?.quickLengths ?? []).map((row) => ({
				length: tenthsToMetres(row.tenths),
				label: { ...row.label },
			})),
		);
		this.hsnChangedFrom.set(null);
		this.variantStock.set(new Map(detail.variants.map((row) => [row.id, row])));
		// A metre product's low-stock level is stored in tenths and typed in metres.
		if (detail.soldBy === 'metre' && detail.lowStockThreshold !== null) {
			this.form.patchValue(
				{ low_stock_threshold: tenthsToMetres(detail.lowStockThreshold) },
				{ emitEvent: false },
			);
		}
		this.form.patchValue({ categories: content.categoryIds }, { emitEvent: false });
		this.selectedCategories = content.categoryIds;
		this.chosenCategories.set(content.categoryIds);
		this.form.patchValue(
			{ saree_length_m: content.sareeLengthM, blouse_piece_m: content.blousePieceM },
			{ emitEvent: false },
		);
		this.optionGroups.set(content.optionGroups);
		this.faq.set({ enabled: content.faqEnabled ?? false, rows: content.faq ?? [] });
		this.addonTemplateCode.set(content.addonTemplateCode);
		this.images.set({
			imageMode: content.imageMode,
			gallery: content.gallery,
			compound: content.compound,
			altOverrides: content.altOverrides,
			versions: content.versions ?? {},
			shareImage: content.shareImage ?? null,
		});
		this.variantImages.set(new Map(detail.variants.map((row) => [row.id, row.image ?? null])));
		this.tiles.set(new Map(detail.images.map((image) => [image.assetId, image.url])));
		this.imageSizes.set(new Map(detail.images.map((image) => [image.assetId, [image.width, image.height]])));
		this.savedAxes.set(
			content.optionGroups.filter((row) => row.semanticRole === 'variation_axis').map((row) => row.attributeCode),
		);
		if (detail.type === 'bundle') {
			this.productService
				.getBundle(detail.id)
				.pipe(takeUntil(this.destroy$))
				.subscribe((saved) => {
					if (saved) this.bundle.set(saved);
				});
		}
		// Price and stock live on the variant rows; the product-level inputs do not apply.
		for (const name of ['price', 'quantity']) this.form.removeControl(name, { emitEvent: false });
		if (detail.published) this.form.get('sku')?.disable({ emitEvent: false });
		this.clearVariations();
		for (const row of detail.variants) {
			const group = this.formBuilder.group(
				{
					id: new FormControl(row.id),
					variation_name: new FormControl(row.label),
					name: new FormControl({ value: row.label, disabled: true }),
					sku: new FormControl({ value: row.sku, disabled: detail.published }, [Validators.required]),
					mrp: new FormControl(row.mrpINR, [Validators.min(0)]),
					price: new FormControl(row.sellingINR, [Validators.required, priceValidator]),
					discount: new FormControl(),
					quantity: new FormControl(row.quantity, [Validators.required, Validators.min(0)]),
					weight_grams: new FormControl(row.weightGrams),
					length_cm: new FormControl(row.lengthCm),
					width_cm: new FormControl(row.widthCm),
					height_cm: new FormControl(row.heightCm),
					barcode: new FormControl(row.barcode),
					hsn: new FormControl(row.hsnCode, [hsnField]),
					availability: new FormControl(row.available ? 'available' : 'unavailable', [Validators.required]),
					variation_image_id: new FormControl(),
					variation_image: new FormControl(),
				},
				{ validators: sellingWithinMrp },
			);
			this.variationControl.push(group);
		}
	}

	get variationControl(): FormArray {
		return this.form.get('variations') as FormArray;
	}

	ngOnInit() {
		this.search
			.pipe(debounceTime(300)) // Adjust the debounce time as needed (in milliseconds)
			.subscribe((inputValue) => {
				this.filter['search'] = inputValue;
				this.productParams.set({ ...this.filter });
			});

		// The variant grid's "New colour not listed" and stock links open a tab directly (?tab=inventory).
		const tab = this.route.snapshot?.queryParamMap?.get('tab');
		if (tab && ['general', 'inventory', 'setup', 'images', 'seo', 'faq', 'shipping', 'status'].includes(tab)) {
			this.active = tab;
		}
		this.route.params
			.pipe(
				switchMap((params) => (params['id'] ? this.productService.getCatalogProduct(params['id']) : of(null))),
				takeUntil(this.destroy$),
			)
			.subscribe((detail) => {
				if (!detail) return;
				this.applyCatalogProduct(detail);
				this.afterProductLoaded();
			});
		const draftId = this.route.snapshot?.queryParamMap?.get('draft') ?? null;
		if (this.type() === 'create') {
			if (draftId) void this.openNewDraft(draftId);
			else setTimeout(() => this.markClean());
		}
		this.form.valueChanges
			.pipe(debounceTime(250), takeUntil(this.destroy$))
			.subscribe(() => this.recomputeChanges());
		this.attributes
			.getDefinitions()
			.pipe(takeUntil(this.destroy$))
			.subscribe((rows) => this.definitions.set(rows));
		this.templates
			.list()
			.pipe(takeUntil(this.destroy$))
			.subscribe((rows) => this.addonTemplates.set(rows));
		this.productService
			.getReplacementTargets()
			.pipe(takeUntil(this.destroy$))
			.subscribe((targets) => {
				this.replacementTargets = targets
					.filter((target) => target.path !== `/product/${this.catalogProduct?.slug}`)
					.map((target) => ({
						value: target.path,
						label: `${target.label} · ${target.path}`,
					}));
			});

		this.products$.subscribe((product) => {
			this.collectionProduct = product.filter(
				(res) => res?.data?.type == 'simple' && res?.data?.stock_status == 'in_stock',
			);
			this.bundleProducts.set(product.filter((res) => res?.data?.type === 'simple'));
		});

		// Made to order is live-only, and its switch locks once the status leaves live.
		this.form.controls['status'].valueChanges.pipe(takeUntil(this.destroy$)).subscribe((status) => {
			if (status !== 'live') this.form.get('made_to_order')?.setValue(false);
		});

		this.form.controls['type'].valueChanges.subscribe((value) => {
			if (this.catalogProduct) return;
			if (value == 'simple') {
				this.form.setControl('quantity', new FormControl(0));
				this.form.setControl('price', new FormControl('', [Validators.required]));
				this.form.setControl('discount', new FormControl());
			} else {
				this.form.removeControl('quantity');
				this.form.removeControl('price');
				this.form.removeControl('discount');
			}
		});

		if (this.isBrowser) {
			this.editor = new Editor();
		}
	}

	productFilter(filter: Params) {
		this.filter['search'] = filter['search'];
		this.filter['ids'] = this.filter['search'].length ? '' : this.product?.related_products?.join();
		this.filter['paginate'] =
			this.product?.related_products?.length >= 15 ? this.product?.related_products?.length : 15;
		this.productParams.set({ ...this.filter });
		if (this.isBrowser) {
			this.renderer.addClass(this.document.body, 'loader-none');
		}
	}

	productDropdown(event: Select2) {
		if (event['innerSearchText']) {
			this.search.next('');
		}
	}

	searchProduct(event: Select2SearchEvent) {
		this.search.next(event.search);
	}

	onDateSelection(date: NgbDate) {
		if (!this.fromDate && !this.toDate) {
			this.fromDate = date;
		} else if (this.fromDate && !this.toDate && date && date.after(this.fromDate)) {
			this.toDate = date;
		} else {
			this.toDate = null;
			this.fromDate = date;
		}

		if (this.fromDate)
			this.form.controls['sale_starts_at'].setValue(
				`${this.fromDate.year}-${this.fromDate.month}-${this.fromDate.day}`,
			);
		if (this.toDate)
			this.form.controls['sale_expired_at'].setValue(
				`${this.toDate?.year}-${this.toDate?.month}-${this.toDate?.day}`,
			);
	}

	isHovered(date: NgbDate) {
		return (
			this.fromDate &&
			!this.toDate &&
			this.hoveredDate &&
			date.after(this.fromDate) &&
			date.before(this.hoveredDate)
		);
	}

	isInside(date: NgbDate) {
		return this.toDate && date.after(this.fromDate) && date.before(this.toDate);
	}

	isRange(date: NgbDate) {
		return (
			date.equals(this.fromDate) ||
			(this.toDate && date.equals(this.toDate)) ||
			this.isInside(date) ||
			this.isHovered(date)
		);
	}

	validateInput(currentValue: NgbDate | null, input: string): NgbDate | null {
		const parsed = this.formatter.parse(input);
		return parsed && this.calendar.isValid(NgbDate.from(parsed)) ? NgbDate.from(parsed) : currentValue;
	}

	clearVariations() {
		const variantsControl = this.form.get('variations') as FormArray; // assuming your FormArray group is named 'variations'
		variantsControl.clear(); // remove all the controls from the FormArray
	}

	selectCategoryItem(data: string[]) {
		if (!Array.isArray(data)) return;
		const previousMain = this.chosenCategories()[0] ?? null;
		// Read before the list changes: the popup names what "Can be returned" was (P13).
		const returnableBefore = this.returnableNow();
		this.form.controls['categories'].setValue(data);
		this.chosenCategories.set(data);
		const currentHsn = textOrNull(this.form.get('hsn_code')?.value);
		const refill = categoryRefill({
			previousMain: previousMain === null ? null : String(previousMain),
			nextMain: data[0] === undefined ? null : String(data[0]),
			currentHsn,
			categories: this.categoryDefaults(),
		});
		// P13: "Can be returned" refills from the new category, named in the same popup.
		if (refill.followCategory) this.returnableChoice.set('');
		if (refill.hsn !== currentHsn) {
			this.form.get('hsn_code')?.setValue(refill.hsn);
			this.hsnChangedFrom.set(currentHsn);
		}
		if (refill.popup) void this.askHsn({ ...refill.popup, returnableBefore, returnableNow: this.returnableNow() });
	}

	/** F02: the HSN popup; its answer goes into the HSN field, saved only with Save. */
	private async askHsn(change: Parameters<HsnPopup['start']>[0]): Promise<void> {
		const popup = this.modals.open(HsnPopup, {
			centered: true,
			backdrop: 'static',
			keyboard: false,
			windowClass: 'theme-modal text-center',
			ariaLabelledBy: 'hsn_popup_title',
		});
		(popup.componentInstance as HsnPopup).start(change);
		const code = (await popup.result.catch(() => null)) as string | null;
		if (!code || !hsnValid(code)) return;
		this.form.get('hsn_code')?.setValue(code);
		this.hsnChangedFrom.set(code === change.oldHsn ? null : change.oldHsn);
	}

	/** Flipping the switch makes it this product's own answer; "Follow … again" clears it (null = follow). */
	setReturnable(on: boolean): void {
		this.returnableChoice.set(on ? 'yes' : 'no');
	}

	/** Whether buyers can return it now: the product's own answer, else the main category's. */
	returnableNow(): boolean {
		const choice = this.returnableChoice();
		if (choice) return choice === 'yes';
		return this.mainCategory()?.returnable ?? true;
	}

	/** F01: Sold by, refused once the unit is fixed; a new metre product starts at 1.0 m (M2). */
	setSoldBy(value: string): void {
		if (this.soldByLocked() || (value !== 'piece' && value !== 'metre')) return;
		this.soldBy.set(value);
		if (value === 'metre' && !this.metreCut().trim()) this.metreCut.set('1.0');
		this.metreError.set(null);
	}

	addQuickLength(): void {
		if (this.quickLengths().length >= 4) return;
		this.quickLengths.update((rows) => [...rows, { length: '', label: {} }]);
	}

	removeQuickLength(index: number): void {
		this.quickLengths.update((rows) => rows.filter((_, at) => at !== index));
	}

	setQuickLength(index: number, field: 'length' | 'label', value: string): void {
		const locale = this.fields.locale();
		this.quickLengths.update((rows) =>
			rows.map((row, at) =>
				at !== index
					? row
					: field === 'length'
						? { ...row, length: value }
						: { ...row, label: { ...row.label, [locale]: value } },
			),
		);
	}

	/** A stock figure as shown: pieces as a number, metres with their unit. */
	qty(units: number): string {
		return this.soldBy() === 'metre'
			? metresText(units, (key, params) => this.transloco.translate(key, params))
			: String(units);
	}

	variantFigures(id: string) {
		const row = this.variantStock().get(id);
		return row ? stockFigures([row]) : null;
	}

	/** The low-stock level in stock units (tenths for metres), for the status line. */
	lowLevelUnits(): number | null {
		const typed = this.form?.get('low_stock_threshold')?.value;
		if (typed === null || typed === undefined || typed === '') return null;
		return this.soldBy() === 'metre' ? metresToTenths(String(typed)) : Number(typed);
	}

	/** F01 Adjust: the stock adjust popup for one variant; figures refresh after. */
	async adjustStock(variantId: string): Promise<void> {
		const detail = await firstValueFrom(this.stockGateway.detail(variantId, 1, 1)).catch(() => null);
		if (!detail) return;
		const popup = this.modals.open(AdjustPopup, {
			size: 'lg',
			windowClass: 'theme-modal modal-lg',
			ariaLabelledBy: 'adjust_popup_title',
		});
		await (popup.componentInstance as AdjustPopup).start(detail.row);
		if (!(await popup.result.catch(() => null)) || !this.catalogProduct) return;
		const fresh = await firstValueFrom(this.productService.getCatalogProduct(this.catalogProduct.id)).catch(
			() => null,
		);
		if (fresh) {
			this.variantStock.set(new Map(fresh.variants.map((row) => [row.id, row])));
			this.soldByLocked.set(fresh.soldByLocked);
		}
	}

	selectTagItem(data: Number[]) {
		if (Array.isArray(data)) {
			this.form.controls['tags'].setValue(data);
		}
	}

	/** "Meta image": the link-preview picture and the version chosen, kept for the save (owner, 17 Nov). */
	selectMetaImage(data: PickedAttachment | null) {
		if (Array.isArray(data)) return;
		this.form.controls['product_meta_image_id'].setValue(data ? data.id : null);
		this.rememberTile(data);
		this.images.update((images) => ({
			...images,
			shareImage: data ? { assetId: String(data.id), versionId: data.versionId ?? null } : null,
		}));
	}

	/** "Variation image": the variant's own picture and version, shown first when it is chosen (owner, 17 Nov). */
	selectVariationImage(data: PickedAttachment | null, index: number) {
		const variationControl = this.form.get('variations') as FormArray;
		const control = variationControl.at(+index);
		control.patchValue({ variation_image_id: data ? data.id : '' });
		const variantId = control.value?.id as string | undefined;
		if (!variantId) return;
		this.rememberTile(data);
		const next = new Map(this.variantImages());
		next.set(variantId, data ? { assetId: String(data.id), versionId: data.versionId ?? null } : null);
		this.variantImages.set(next);
	}

	/** A picked picture's thumbnail, so its field shows it at once and after a save. */
	private rememberTile(data: PickedAttachment | null) {
		if (!data?.original_url) return;
		this.tiles.set(new Map(this.tiles()).set(String(data.id), data.original_url));
	}

	/** A stored picture as its field shows it: the photo's thumbnail and the version chosen. */
	pictureTile(ref: PictureRef | null | undefined): PickedAttachment | null {
		if (!ref) return null;
		const url = this.tiles().get(ref.assetId);
		if (!url) return null;
		return { id: ref.assetId, original_url: url, versionId: ref.versionId } as PickedAttachment;
	}

	switchLanguage(locale: string) {
		this.fields.switchTo(locale);
		this.refreshMissing();
	}

	private refreshMissing() {
		this.gaps.set(gapsByLocale(this.locales, (locale) => this.languageGaps(locale)));
	}

	/** What Go Live would refuse for a language: fields as typed, option names and values. */
	private languageGaps(locale: string): LanguageGap[] {
		const options = this.optionGroups().flatMap((group) => {
			const name = group.label[SOURCE_LOCALE] ?? group.attributeCode;
			const label = group.label[locale]?.trim()
				? []
				: [{ key: `option:${group.attributeCode}`, label: 'gap_option', name }];
			const values = group.terms
				.filter((term) => !term.label[locale]?.trim())
				.map((term) => ({
					key: `value:${group.attributeCode}:${term.code}`,
					label: 'gap_value',
					name: term.label[SOURCE_LOCALE] ?? term.code,
				}));
			return [...label, ...values];
		});
		// With the FAQ on, each question needs its question and answer in every language.
		const faq = this.faq().enabled
			? this.faq().rows.flatMap((row, index) => {
					const name = String(index + 1);
					return [
						...(row.question[locale]?.trim()
							? []
							: [{ key: `faq_question:${name}`, label: 'gap_faq_question', name }]),
						...(row.answer[locale]?.trim()
							? []
							: [{ key: `faq_answer:${name}`, label: 'gap_faq_answer', name }]),
					];
				})
			: [];
		// The image's own alt text lives in the library, so only a Go Live attempt can report it.
		const images = this.goLiveGaps()
			.filter((gap) => gap.field === 'image_alt' && gap.locale === locale)
			.map(() => ({ key: 'image_alt', label: 'gap_image_alt' }));
		// Quick-length buttons of fabric by the metre show their label in every language (M5).
		const lengths =
			this.soldBy() === 'metre'
				? this.quickLengths()
						.map((row, index) => ({ row, index }))
						.filter(({ row }) => !row.label[locale]?.trim())
						.map(({ row, index }) => ({
							key: `quick_length_${index}`,
							label: 'gap_quick_length',
							name: `${row.length} m`,
						}))
				: [];
		return [...this.fields.gaps(locale), ...options, ...faq, ...images, ...lengths];
	}

	openLanguageGap({ key, locale }: { key: string; locale: string }) {
		this.openGap({ field: key, locale });
		focusField(this.document, key);
	}

	private content(raw: Record<string, unknown>): ProductContentWrite {
		const text = (field: string): LocalizedText => this.fields.text(field);
		return {
			title: text('name'),
			shortDescription: text('short_description'),
			description: text('description'),
			metaTitle: text('meta_title'),
			metaDescription: text('meta_description'),
			estimatedDeliveryText: text('estimated_delivery_text'),
			sareeLengthM: this.showsLengths() ? blankToNull(raw['saree_length_m']) : null,
			blousePieceM: this.showsLengths() ? blankToNull(raw['blouse_piece_m']) : null,
			categoryIds: Array.isArray(raw['categories']) ? raw['categories'].map(String) : [],
			optionGroups: this.optionGroups(),
			addonTemplateCode: this.addonTemplateCode(),
			...this.images(),
			faqEnabled: this.faq().enabled,
			faq: this.faq().rows,
		};
	}

	/** Go Live: the same call and the same toast as the product list. */
	goLive() {
		const product = this.catalogProduct;
		if (!product) return;
		this.productService.goLive(product.id).subscribe((result) => {
			this.goLiveGaps.set(result.gaps);
			goLiveToast(result, this.notifier, (key) => this.transloco.translate(key));
			if (result.live) void this.router.navigateByUrl('/product');
		});
	}

	/** A line of the Go Live alert opens the tab, and the language, where the gap can be fixed. */
	openGap({ field, locale }: GoLiveGap) {
		if (locale) this.switchLanguage(locale);
		this.nav()?.select(GAP_TABS[field.split(':')[0] as string] ?? 'inventory');
	}

	gapLabels(): string[] {
		return goLiveLabels(this.goLiveGaps(), (key) => this.transloco.translate(key));
	}

	/** The next product in the list this one was opened from, for Save and next. */
	nextProductId(): string | null {
		return nextInProductQueue(this.isBrowser ? sessionStorage : null, this.catalogProduct?.id);
	}

	/** Saves, then opens the next product from the list (or the list after the last one). */
	saveAndNext() {
		this.afterSave = this.nextProductId();
		this.submit();
	}

	/** Where a successful save goes: the next product for Save and next, else the list. */
	private afterSave: string | null = null;

	private leaveAfterSave() {
		const next = this.afterSave;
		this.afterSave = null;
		this.leaving = true;
		// A saved product ends its draft; the product now holds everything the draft held.
		const draft = this.draft();
		if (draft) {
			this.drafts.discard(draft.id).subscribe({ next: () => this.refreshDraftBadge(), error: () => undefined });
			this.draft.set(null);
		}
		void Promise.resolve(this.router.navigateByUrl(next ? `/product/edit/${next}` : '/product')).then((moved) => {
			if (moved === false) this.leaving = false;
		});
	}

	submit() {
		if (this.conflicts().length) {
			void this.resolveConflicts();
			return;
		}
		this.form.markAllAsTouched();
		const raw = this.form.getRawValue() as Record<string, unknown>;
		if (!this.fields.text('name')['en']?.trim()) {
			this.switchLanguage('en');
			this.form.get('name')?.setErrors({ required: true });
			this.nav()?.select('general');
			this.tabError = 'general';
			return;
		}
		const leadTime = textOrNull(this.fields.text('estimated_delivery_text')['en']);
		const leadTimeControl = this.form.get('estimated_delivery_text');
		if (raw['made_to_order'] && !leadTime) leadTimeControl?.setErrors({ leadTimeRequired: true });
		const metre =
			this.soldBy() === 'metre'
				? metreProblem({
						shortestCut: this.metreCut(),
						weightPerMetre: this.metreWeight(),
						width: this.metreWidth(),
						quickLengths: this.quickLengths(),
					})
				: null;
		this.metreError.set(metre);
		if (metre) {
			this.nav()?.select('inventory');
			this.tabError = 'inventory';
			return;
		}
		if (!this.form.valid) {
			this.showInvalidTab();
			return;
		}
		const product = this.catalogProduct;
		if (!product) {
			this.create(raw);
			return;
		}
		if (this.isDiscontinuing) {
			this.productService.discontinueCatalogProduct(product.id, textOrNull(raw['replacement_path'])).subscribe({
				next: () => this.leaveAfterSave(),
			});
			return;
		}
		this.save(product, raw);
	}

	/** Makes the product, then saves everything typed so far onto it. */
	private create(raw: Record<string, unknown>) {
		const typed = Object.fromEntries(LANGUAGE_FIELDS.map((field) => [field, this.fields.text(field)]));
		const groups = this.optionGroups();
		const images = this.images();
		const kept = {
			soldBy: this.soldBy(),
			returnable: this.returnableChoice(),
			cut: this.metreCut(),
			width: this.metreWidth(),
			weight: this.metreWeight(),
			lengths: this.quickLengths(),
		};
		const body: ProductCreate = {
			type: raw['type'] === 'classified' ? 'variable' : (raw['type'] as ProductCreate['type']),
			sku: String(raw['sku']).trim(),
			title: { en: (typed['name'] as LocalizedText)['en'] as string },
			basePriceINR: blankToNull(raw['price']) ?? 0,
		};
		this.productService
			.createCatalogProduct(body)
			.pipe(switchMap(({ id }) => this.productService.getCatalogProduct(id)))
			.subscribe((detail) => {
				this.applyCatalogProduct(detail);
				this.fields.load({ ...typed });
				this.optionGroups.set(groups);
				this.images.set(images);
				this.soldBy.set(kept.soldBy);
				this.returnableChoice.set(kept.returnable);
				this.metreCut.set(kept.cut);
				this.metreWidth.set(kept.width);
				this.metreWeight.set(kept.weight);
				this.quickLengths.set(kept.lengths);
				this.variationControl.at(0)?.patchValue({ quantity: blankToNull(raw['quantity']) ?? 0 });
				this.save(detail, this.form.getRawValue() as Record<string, unknown>);
			});
	}

	private save(product: CatalogProductDetail, raw: Record<string, unknown>) {
		const ids = (value: unknown) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);
		const slug = textOrNull(raw['slug']);
		const body: CatalogProductWrite = {
			sku: String(raw['sku'] ?? product.sku).trim(),
			...(slug && slug !== product.slug ? { slug } : {}),
			status: product.status === 'live' && raw['status'] === 'live' ? 'live' : 'disabled',
			featured: Boolean(raw['is_featured']),
			madeToOrder: Boolean(raw['made_to_order']),
			estimatedDeliveryText: textOrNull(this.fields.text('estimated_delivery_text')['en']),
			lowStockThreshold:
				this.soldBy() === 'metre'
					? metresToTenths(String(raw['low_stock_threshold'] ?? ''))
					: blankToNull(raw['low_stock_threshold']),
			pinnedBadges: ids(raw['pinned_badges']) as CatalogBadgeCode[],
			hiddenBadges: ids(raw['hidden_badges']) as CatalogBadgeCode[],
			addonPriceINR: blankToNull(raw['addon_price_inr']),
			shipping: {
				weightGrams: blankToNull(raw['weight']),
				lengthCm: blankToNull(raw['length_cm']),
				widthCm: blankToNull(raw['width_cm']),
				heightCm: blankToNull(raw['height_cm']),
			},
			shippingCharges: {
				domesticINR: this.ownCharges().domestic,
				internationalFirstINR: this.ownCharges().internationalFirst,
				internationalFurtherINR: this.ownCharges().internationalFurther,
			},
			freeShipping: Boolean(raw['is_free_shipping']),
			hsnCode: textOrNull(raw['hsn_code']),
			...(product.soldByLocked ? {} : { soldBy: this.soldBy() }),
			returnable: this.returnableChoice() === '' ? null : this.returnableChoice() === 'yes',
			...(this.soldBy() === 'metre'
				? {
						metre: {
							shortestCutTenths: metresToTenths(this.metreCut()) ?? 10,
							quickLengths: this.quickLengths().map((row) => ({
								tenths: metresToTenths(row.length) ?? 10,
								label: Object.fromEntries(
									Object.entries(row.label).filter(([, text]) => text.trim()),
								) as QuickLength['label'],
							})),
							widthInches: this.metreWidth().trim() ? Number(this.metreWidth()) : null,
							weightPerMetreGrams: Math.round(Number(this.metreWeight())),
						},
					}
				: {}),
			variants: this.variationControl.controls.map((group) => {
				const row = (group as FormGroup).getRawValue() as Record<string, unknown>;
				return {
					id: String(row['id']),
					sku: String(row['sku']).trim(),
					mrpINR: blankToNull(row['mrp']),
					sellingINR: Math.round(Number(row['price'])),
					quantity: Math.round(Number(row['quantity'])),
					available: row['availability'] !== 'unavailable',
					weightGrams: blankToNull(row['weight_grams']),
					lengthCm: blankToNull(row['length_cm']),
					widthCm: blankToNull(row['width_cm']),
					heightCm: blankToNull(row['height_cm']),
					barcode: textOrNull(row['barcode']),
					hsnCode: textOrNull(row['hsn']),
					image: this.variantImages().get(String(row['id'])) ?? null,
				};
			}),
			content: this.content(raw),
			relatedProductIds: ids(raw['related_products']),
			upsellProductIds: ids(raw['upsell_products']),
			crossSellProductIds: ids(raw['cross_sell_products']),
			videos: (raw['videos'] as ProductVideo[] | undefined) ?? [],
		};
		const saved: Observable<unknown> = this.productService.saveCatalogProduct(product.id, body);
		const bundled = product.type === 'bundle' && this.bundle().groups.length > 0;
		const finished = bundled
			? saved.pipe(switchMap(() => this.productService.saveBundle(product.id, this.bundle())))
			: saved;
		finished.subscribe({
			next: () => {
				this.tabError = null;
				this.leaveAfterSave();
			},
		});
	}

	private showInvalidTab() {
		if (!this.isBrowser) return;
		const invalidField =
			Object.keys(this.form.controls).find((key) => this.form.controls[key].invalid) ?? 'variations';
		const tab = this.document
			.querySelector(`#${invalidField}, [formarrayname="${invalidField}"]`)
			?.closest('div.tab')
			?.getAttribute('tab');
		if (tab) {
			this.nav()?.select(tab);
			this.tabError = tab;
		}
	}

	// ── Save as draft (product bulk actions brief § 7) ──────────────────────────────────────

	/** Everything on the form, unchecked: what Save as draft keeps. */
	snapshot(): ProductFormSnapshot {
		return {
			v: DRAFT_VERSION,
			raw: this.form.getRawValue() as Record<string, unknown>,
			text: Object.fromEntries(LANGUAGE_FIELDS.map((field) => [field, { ...this.fields.text(field) }])),
			state: {
				soldBy: this.soldBy(),
				returnable: this.returnableChoice(),
				metreCut: this.metreCut(),
				metreWidth: this.metreWidth(),
				metreWeight: this.metreWeight(),
				quickLengths: this.quickLengths(),
				ownCharges: this.ownCharges(),
				optionGroups: this.optionGroups(),
				faq: this.faq(),
				addonTemplateCode: this.addonTemplateCode(),
				images: this.images(),
				bundle: this.bundle(),
				variantImages: Object.fromEntries(this.variantImages()),
				tiles: Object.fromEntries(this.tiles()),
				imageSizes: Object.fromEntries(this.imageSizes()),
			},
		};
	}

	/** Puts a draft's values back on the form: all of them, or only the paths named. */
	private restore(snapshot: ProductFormSnapshot, only?: ReadonlySet<string>): void {
		const wanted = (path: string) => !only || only.has(path);
		const raw = snapshot.raw ?? {};
		// The type first: on a new product it adds or removes the price boxes the rest fills.
		if (!this.catalogProduct && wanted('raw.type') && typeof raw['type'] === 'string') {
			this.form.get('type')?.setValue(raw['type']);
		}
		for (const [key, value] of Object.entries(raw)) {
			if (key === 'type' || key === 'variations' || LANGUAGE_FIELDS.includes(key)) continue;
			if (wanted(`raw.${key}`)) this.form.get(key)?.setValue(value, { emitEvent: false });
		}
		if (Array.isArray(raw['variations'])) {
			for (const row of raw['variations'] as Record<string, unknown>[]) {
				const id = String(row?.['id'] ?? '');
				const group = this.variationControl.controls.find((control) => control.value?.id === id);
				if (!group) continue;
				for (const [field, value] of Object.entries(row)) {
					if (field !== 'id' && wanted(`raw.variations.${id}.${field}`)) {
						group.get(field)?.setValue(value, { emitEvent: false });
					}
				}
			}
		}
		if (wanted('raw.categories')) {
			const ids = Array.isArray(raw['categories']) ? raw['categories'].map(String) : [];
			this.selectedCategories = ids;
			this.chosenCategories.set(ids);
		}
		if (wanted('raw.tags')) this.selectedTags = Array.isArray(raw['tags']) ? (raw['tags'] as Number[]) : [];
		const text = Object.fromEntries(LANGUAGE_FIELDS.map((field) => [field, this.fields.text(field)]));
		for (const [field, byLocale] of Object.entries(snapshot.text ?? {})) {
			for (const [locale, value] of Object.entries(byLocale ?? {})) {
				if (wanted(`text.${field}.${locale}`) && text[field]) text[field][locale] = value;
			}
		}
		this.fields.load(text);
		const state = snapshot.state ?? {};
		const take = <T>(name: string, apply: (value: T) => void) => {
			if (name in state && wanted(`state.${name}`)) apply(state[name] as T);
		};
		take<SoldBy>('soldBy', (value) => this.soldBy.set(value));
		take<'' | 'yes' | 'no'>('returnable', (value) => this.returnableChoice.set(value));
		take<string>('metreCut', (value) => this.metreCut.set(value));
		take<string>('metreWidth', (value) => this.metreWidth.set(value));
		take<string>('metreWeight', (value) => this.metreWeight.set(value));
		take<Array<{ length: string; label: Record<string, string> }>>('quickLengths', (value) =>
			this.quickLengths.set(value),
		);
		take<Record<ShippingChargeKind, number | null>>('ownCharges', (value) => this.ownCharges.set(value));
		take<ProductOptionGroup[]>('optionGroups', (value) => this.optionGroups.set(value));
		take<FaqValue>('faq', (value) => this.faq.set(value));
		take<string | null>('addonTemplateCode', (value) => this.addonTemplateCode.set(value));
		take<ReturnType<typeof this.images>>('images', (value) => this.images.set(value));
		take<ProductBundleWrite>('bundle', (value) => this.bundle.set(value));
		take<Record<string, PictureRef | null>>('variantImages', (value) =>
			this.variantImages.set(new Map(Object.entries(value ?? {}))),
		);
		const tiles = state['tiles'] as Record<string, string> | undefined;
		if (tiles) this.tiles.set(new Map([...this.tiles(), ...Object.entries(tiles)]));
		const sizes = state['imageSizes'] as Record<string, readonly [number, number]> | undefined;
		if (sizes) this.imageSizes.set(new Map([...this.imageSizes(), ...Object.entries(sizes)]));
		this.form.updateValueAndValidity();
		this.refreshMissing();
	}

	/** What still stops Save, counted for the Drafts list ("4 things to fix before Save"). */
	private countToFix(): number {
		let count = this.fields.text('name')['en']?.trim() ? 0 : 1;
		const walk = (control: AbstractControl) => {
			if (control instanceof FormGroup || control instanceof FormArray) {
				Object.values(control.controls).forEach(walk);
			} else if (control.invalid && control.enabled) count += 1;
		};
		walk(this.form);
		if (
			this.soldBy() === 'metre' &&
			metreProblem({
				shortestCut: this.metreCut(),
				weightPerMetre: this.metreWeight(),
				width: this.metreWidth(),
				quickLengths: this.quickLengths(),
			})
		) {
			count += 1;
		}
		return count;
	}

	/** The product as it opened is what a draft of changes is compared with. */
	private afterProductLoaded(): void {
		this.base = this.snapshot();
		this.changes.set(new Map());
		this.conflicts.set([]);
		this.draft.set(null);
		this.waitingDraft.set(null);
		this.markClean();
		const draftId = this.route.snapshot?.queryParamMap?.get('draft') ?? null;
		if (draftId) void this.openEditDraft(draftId);
		else void this.lookForDrafts();
	}

	private markClean(): void {
		this.savedPrint = fingerprint(this.snapshot());
	}

	/** Anything on the form not saved anywhere yet. */
	isDirty(): boolean {
		return this.savedPrint !== null && fingerprint(this.snapshot()) !== this.savedPrint;
	}

	private recomputeChanges(): void {
		if (!this.base || !this.catalogProduct) return;
		this.changes.set(new Map(changedPaths(this.base, this.snapshot()).map((change) => [change.path, change.from])));
	}

	/** DraftMarks: the "Changed · was: …" line under a field of a draft of changes. */
	wasFor(path: readonly string[] | null): string | null {
		if (this.draft()?.kind !== 'edit' || !path?.length) return null;
		const key = this.pathKey(path);
		const changes = this.changes();
		if (!key || !changes.has(key)) return null;
		return this.transloco.translate('draft_was', { value: describeValue(changes.get(key)) });
	}

	private pathKey(path: readonly string[]): string | null {
		const [head = '', index, field] = path;
		if (head === 'variations') {
			const id = this.variationControl.at(Number(index))?.value?.id;
			return id && field ? `raw.variations.${id}.${field}` : null;
		}
		if (LANGUAGE_FIELDS.includes(head)) return `text.${head}.${this.fields.locale()}`;
		return `raw.${head}`;
	}

	/** A field's name in words, with its language and tab, for the conflict question. */
	private fieldLabel(path: string): string {
		const t = (key: string) => this.transloco.translate(key);
		const [part, name = '', first = '', second = ''] = path.split('.');
		const tab = t(draftTab(path));
		if (part === 'text') return `${t(name)} · ${languageName(first)} · ${tab}`;
		if (part === 'raw' && name === 'variations') {
			const row = this.variationControl.controls.find((control) => control.value?.id === first);
			return `${row?.value?.variation_name ?? first} · ${t(second)} · ${tab}`;
		}
		return part === 'raw' ? `${t(name)} · ${tab}` : tab;
	}

	/** Save as draft: keeps whatever is on the form, mistakes included; runs no checks. */
	async saveDraft(updateUrl = true): Promise<boolean> {
		const t = (key: string) => this.transloco.translate(key);
		const product = this.catalogProduct;
		const snapshot = this.snapshot();
		const changes = product && this.base ? changedPaths(this.base, snapshot) : [];
		if (product && !changes.length && !this.draft()) {
			this.notifier.showError(t('draft_nothing_changed'));
			return false;
		}
		const current = this.draft();
		try {
			const saved: ProductDraft = await firstValueFrom(
				this.drafts.save(current?.id ?? null, {
					kind: product ? 'edit' : 'new',
					productId: product?.id ?? null,
					title: this.fields.text('name')['en']?.trim() ?? '',
					imageAssetId: this.swatchPhotos()[0] ?? null,
					form: snapshot as unknown as Record<string, unknown>,
					changes,
					toFix: this.countToFix(),
					baseSavedAt: product?.updatedAt ?? null,
				}),
			);
			this.draft.set({ id: saved.id, kind: saved.kind, savedAt: saved.updatedAt, createdAt: saved.createdAt });
			this.waitingDraft.set(null);
			this.markClean();
			this.recomputeChanges();
			if (updateUrl) {
				// The address becomes the draft's own, so refreshing or bookmarking keeps it (brief 7b).
				void this.router.navigate([], {
					relativeTo: this.route,
					queryParams: { draft: saved.id },
					queryParamsHandling: 'merge',
					replaceUrl: true,
				});
			}
			this.notifier.showSuccess(t('draft_saved'));
			this.refreshDraftBadge();
			return true;
		} catch {
			this.notifier.showError(t('draft_not_saved'));
			return false;
		}
	}

	private async openNewDraft(id: string): Promise<void> {
		const draft = await firstValueFrom(this.drafts.get(id)).catch(() => null);
		if (!draft || draft.kind !== 'new') {
			this.notifier.showError(this.transloco.translate('draft_not_found'));
			return;
		}
		this.restore(draft.form as unknown as ProductFormSnapshot);
		this.draft.set({ id: draft.id, kind: 'new', savedAt: draft.updatedAt, createdAt: draft.createdAt });
		setTimeout(() => this.markClean());
	}

	/** A draft of changes: the product as it is now, with the draft's changed fields laid on top. */
	private async openEditDraft(id: string): Promise<void> {
		const product = this.catalogProduct;
		const draft = await firstValueFrom(this.drafts.get(id)).catch(() => null);
		if (!draft || draft.kind !== 'edit' || !product || draft.productId !== product.id || !this.base) {
			this.notifier.showError(this.transloco.translate('draft_not_found'));
			return;
		}
		const mine = draft.form as unknown as ProductFormSnapshot;
		const now = flattenSnapshot(this.base);
		const drafted = flattenSnapshot(mine);
		// Someone saved the field after the draft began, and to something other than the draft's value.
		this.conflicts.set(
			draft.changes
				.filter(
					(change) =>
						stable(now.get(change.path)) !== stable(change.from) &&
						stable(now.get(change.path)) !== stable(drafted.get(change.path)),
				)
				.map((change) => ({
					path: change.path,
					label: this.fieldLabel(change.path),
					theirs: describeValue(now.get(change.path)),
					mine: describeValue(drafted.get(change.path)),
				})),
		);
		this.restore(mine, new Set(draft.changes.map((change) => change.path)));
		this.draft.set({ id: draft.id, kind: 'edit', savedAt: draft.updatedAt, createdAt: draft.createdAt });
		this.waitingDraft.set(null);
		this.recomputeChanges();
		setTimeout(() => this.markClean());
	}

	/** Brief 7f: a product with a draft says so, and the draft is never applied without asking. */
	private async lookForDrafts(): Promise<void> {
		const product = this.catalogProduct;
		if (!product || !this.isBrowser) return;
		let list: Awaited<ReturnType<typeof this.loadProductDrafts>> = null;
		try {
			list = await this.loadProductDrafts(product.id);
		} catch {
			// The note is a help, not a step: without it the form works as before.
		}
		const row = list?.items.find((item) => item.mine) ?? list?.items[0];
		if (row)
			this.waitingDraft.set({ id: row.id, mine: row.mine, updatedAt: row.updatedAt, changed: row.changedCount });
	}

	private loadProductDrafts(productId: string) {
		return firstValueFrom(this.drafts.list({ scope: 'everyone', productId, pageSize: 10 })).catch(() => null);
	}

	continueDraft(): void {
		const waiting = this.waitingDraft();
		if (!waiting?.mine) return;
		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: { draft: waiting.id },
			queryParamsHandling: 'merge',
			replaceUrl: true,
		});
		void this.openEditDraft(waiting.id);
	}

	/** Discard draft: the copy only; the product stays exactly as it is. */
	async discardDraft(): Promise<void> {
		const open = this.draft();
		const waiting = this.waitingDraft();
		const id = open?.id ?? (waiting?.mine ? waiting.id : null);
		if (!id) return;
		const yes = await askConfirm(this.modals, {
			icon: 'ri-delete-bin-line',
			title: 'draft_discard_title',
			body: 'draft_discard_body',
			yes: 'draft_discard',
		});
		if (!yes) return;
		try {
			await firstValueFrom(this.drafts.discard(id));
		} catch {
			this.notifier.showError(this.transloco.translate('draft_not_saved'));
			return;
		}
		this.waitingDraft.set(null);
		this.refreshDraftBadge();
		this.notifier.showSuccess(this.transloco.translate('draft_discarded'));
		if (open?.id !== id) return;
		this.draft.set(null);
		this.leaving = true;
		const product = this.catalogProduct;
		void this.router.navigateByUrl(product ? `/product/edit/${product.id}` : '/product/drafts', {
			onSameUrlNavigation: 'reload',
		});
		if (product) {
			const fresh = await firstValueFrom(this.productService.getCatalogProduct(product.id)).catch(() => null);
			if (fresh) {
				this.applyCatalogProduct(fresh);
				this.afterProductLoaded();
			}
			this.leaving = false;
		}
	}

	/** The menu's count of your drafts. */
	private refreshDraftBadge(): void {
		try {
			this.drafts.list({ scope: 'mine', pageSize: 1 }).subscribe({
				next: (list) => this.menu.setBadge('/product/drafts', list.mine),
				error: () => undefined,
			});
		} catch {
			// The count catches up on the next visit to the list.
		}
	}

	/** Brief 7g: the fields both changed are asked about; "theirs" puts the product's value back. */
	private async resolveConflicts(): Promise<void> {
		const popup = this.modals.open(ProductConflictPopup, {
			centered: true,
			size: 'lg',
			windowClass: 'theme-modal',
			ariaLabelledBy: 'product_conflict_title',
		});
		(popup.componentInstance as ProductConflictPopup).conflicts.set(this.conflicts());
		const choice = (await popup.result.catch(() => null)) as Record<string, 'mine' | 'theirs'> | null;
		if (!choice) return;
		const theirs = new Set(
			Object.entries(choice)
				.filter(([, side]) => side === 'theirs')
				.map(([path]) => path),
		);
		if (theirs.size && this.base) this.restore(this.base, theirs);
		this.conflicts.set([]);
		this.recomputeChanges();
		this.submit();
	}

	/** The route's leave guard asks this first: unsaved work is kept, left or saved (brief 7c). */
	async confirmLeave(): Promise<boolean> {
		if (this.leaving || !this.isDirty()) return true;
		const popup = this.modals.open(ProductLeavePopup, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'product_leave_title',
		});
		(popup.componentInstance as ProductLeavePopup).name.set(this.fields.text('name')['en'] ?? '');
		const choice = (await popup.result.catch(() => 'stay')) as LeaveChoice;
		if (choice === 'leave') return true;
		if (choice === 'draft') return this.saveDraft(false);
		return false;
	}

	/** Closing the tab with unsaved work: the browser's own "Leave site?" box, as the Inbox does. */
	onBeforeUnload(event: BeforeUnloadEvent): void {
		if (this.leaving || !this.isDirty()) return;
		event.preventDefault();
		event.returnValue = '';
	}
}
