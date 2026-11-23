import { Component, DOCUMENT, inject, input, output, signal } from '@angular/core';
import { FormGroup, FormBuilder, FormControl, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Select2 } from 'ng-select2-component';
import { Subject, firstValueFrom, forkJoin, of } from 'rxjs';
import { switchMap, map, takeUntil } from 'rxjs/operators';

import { BLOG_GO_LIVE_WORDS, gapsFromError, goLiveToast } from '@core/catalog/go-live-report';
import { ActiveLanguages } from '@core/i18n/active-languages';
import { focusField, gapsByLocale, type LanguageGap, LocalizedFields } from '@core/i18n/localized-fields';
import { ShippingGateway } from '@core/shipping/shipping.gateway';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { ICategory } from '@data-access/interfaces/category.interface';
import { BlogService } from '@data-access/services/blog.service';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';
import { askYesNo } from '@features/purchasing/shared/popups';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload, type PickedAttachment, ImageUploadValue, onePicture } from '@shared/ui/image-upload/image-upload';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

import type { AdminCategoryRow, AdminCategoryWrite, BlogCategory } from '@saha-textile/contracts';

const LANGUAGE_FIELDS = ['name', 'description', 'seo_title', 'seo_description'];

const attachment = (image: AdminCategoryRow['image']) =>
	image ? ({ id: image.id, original_url: image.url } as unknown as IAttachment) : undefined;

/** A tile's picture with the version the category stored for it, so the tile can name it (E04). */
const withVersion = <T extends { id: string | number } | null | undefined>(
	image: T,
	versions: Readonly<Record<string, string>>,
): T => (image && versions[String(image.id)] ? ({ ...image, versionId: versions[String(image.id)] } as T) : image);

const picked = (id: unknown): string | null => (id ? String(id) : null);

@Component({
	selector: 'app-form-category',
	templateUrl: './form-category.html',
	styleUrls: ['./form-category.scss'],
	imports: [
		PageWrapper,
		ReactiveFormsModule,
		FormFields,
		AdvancedDropdown,
		LanguageSwitch,
		Select2,
		ImageUpload,
		Button,
		TranslocoModule,
		RouterLink,
	],
})
export class FormCategory {
	private page = inject<Document>(DOCUMENT);
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private categoryService = inject(CategoryService);
	private blogs = inject(BlogService);
	private queryClient = inject(QueryClient);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private modals = inject(NgbModal);
	private shipping = inject(ShippingGateway);
	/** "Used by 214 products: 209 inherit these values, 5 set their own" (brief cat01); null when unknown. */
	readonly shippingUsage = signal<{ products: number; ownCharges: number } | null>(null);
	/** This category's own exception per zone, for the "Shipping rules" row (brief cat01). */
	readonly zoneExceptions = signal<Array<{ zone: 'domestic' | 'international'; label: string; cantShip: boolean }>>(
		[],
	);

	readonly type = input<string>(undefined);
	readonly categories = input<ICategory[]>(undefined);
	readonly categoryType = input<string | null>('product');

	public form: FormGroup;
	public category: ICategory;
	/** The version each chosen picture shows, by photo id (R4-1; media step 4d). */
	private imageVersions: Record<string, string> = {};
	public id: string;

	readonly locales = inject(ActiveLanguages).list();
	readonly fields: LocalizedFields;
	/** The tree beside this form follows its language. */
	readonly localeChange = output<string>();
	readonly gaps = signal<Record<string, LanguageGap[]>>({});

	private destroy$ = new Subject<void>();

	constructor() {
		this.form = this.formBuilder.group({
			name: new FormControl(''),
			description: new FormControl(''),
			seo_title: new FormControl(''),
			seo_description: new FormControl(''),
			slug: new FormControl('', [Validators.required, Validators.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)]),
			parent_id: new FormControl(),
			also_under: new FormControl<string[]>([]),
			hsn_code: new FormControl<string>('', [Validators.pattern(/^(\d{4}|\d{6}|\d{8})$/)]),
			returnable: new FormControl<'yes' | 'no'>('yes'),
			// Shipping (brief cat01): empty inherits from the parent category, then the shop default.
			ship_domestic: new FormControl<number | null>(null, [Validators.min(0)]),
			ship_first: new FormControl<number | null>(null, [Validators.min(0)]),
			ship_further: new FormControl<number | null>(null, [Validators.min(0)]),
			ship_weight: new FormControl<number | null>(null, [Validators.min(0)]),
			ship_length: new FormControl<number | null>(null, [Validators.min(0)]),
			ship_width: new FormControl<number | null>(null, [Validators.min(0)]),
			ship_height: new FormControl<number | null>(null, [Validators.min(0)]),
			type: new FormControl(this.categoryType(), []),
			category_image_id: new FormControl(),
			category_icon_id: new FormControl(),
			status: new FormControl(true),
		});
		this.fields = new LocalizedFields(this.form, LANGUAGE_FIELDS);
	}

	ngOnChanges() {
		this.form.controls['type'].setValue(this.categoryType());
	}

	/** Blog categories are flat and have no pictures or search text: only the name, address, description and status. */
	isBlog(): boolean {
		return this.categoryType() === 'post';
	}

	ngOnInit() {
		if (this.isBlog()) {
			// A new blog category may leave its address empty: it is made from the English name.
			this.form.controls['slug'].removeValidators(Validators.required);
			this.form.controls['slug'].updateValueAndValidity();
			this.route.params
				.pipe(
					switchMap((params) =>
						params['id']
							? this.blogs
									.getTerms('categories')
									.pipe(map((rows) => rows.find((row) => row.id === params['id']) ?? null))
							: of(null),
					),
					takeUntil(this.destroy$),
				)
				.subscribe((row) => {
					if (row) this.loadBlog(row);
					this.refreshMissing();
				});
			return;
		}
		this.route.params
			.pipe(
				switchMap((params) => {
					if (!params['id']) return of();
					return this.categoryService
						.getCategoryRows()
						.pipe(map((rows) => rows.find((row) => row.id == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((row) => {
				if (!row) return;
				this.id = row.id;
				this.savedHsn = row.hsnCode ?? null;
				this.form.patchValue({
					slug: row.slug,
					parent_id: row.parentId,
					also_under: row.alsoUnder,
					hsn_code: row.hsnCode ?? '',
					returnable: row.returnable === false ? 'no' : 'yes',
					ship_domestic: row.shipping?.domesticINR ?? null,
					ship_first: row.shipping?.internationalFirstINR ?? null,
					ship_further: row.shipping?.internationalFurtherINR ?? null,
					ship_weight: row.shipping?.weightGrams ?? null,
					ship_length: row.shipping?.lengthCm ?? null,
					ship_width: row.shipping?.widthCm ?? null,
					ship_height: row.shipping?.heightCm ?? null,
					category_image_id: row.image?.id ?? '',
					category_icon_id: row.icon?.id ?? '',
				});
				this.imageVersions = { ...(row.imageVersions ?? {}) };
				this.category = {
					...this.category,
					category_image: withVersion(attachment(row.image), this.imageVersions),
					category_icon: withVersion(attachment(row.icon), this.imageVersions),
				};
				this.fields.load({
					name: row.name,
					description: row.description,
					seo_title: row.seoTitle,
					seo_description: row.seoDescription,
				});
				this.refreshMissing();
				this.loadShipping(row.id);
			});
		this.refreshMissing();
	}

	/** Who reads this category's charges, and its own exception; both need the shipping permission. */
	private loadShipping(id: string) {
		this.shipping.categoryUsage(id).subscribe({
			next: (usage) => this.shippingUsage.set(usage),
			error: () => this.shippingUsage.set(null),
		});
		forkJoin([this.shipping.exceptions(), this.shipping.overview()]).subscribe({
			next: ([exceptions, overview]) => {
				const own = exceptions.find((e) => e.target.kind === 'category' && e.target.categoryId === id);
				const nameOf = (ruleSetId: string) =>
					overview.ruleSets.find((r) => r.id === ruleSetId)?.name ?? ruleSetId;
				const zones = ['domestic', 'international'] as const;
				this.zoneExceptions.set(
					own
						? zones
								.map((zone) => ({ zone, choice: own[zone] }))
								.filter((item) => item.choice.kind !== 'siteWide')
								.map((item) => ({
									zone: item.zone,
									label:
										item.choice.kind === 'ruleSet'
											? nameOf(item.choice.ruleSetId)
											: this.transloco.translate(`ship_choice_${item.choice.kind}`),
									cantShip: item.choice.kind === 'cantShip',
								}))
						: [],
				);
			},
			error: () => this.zoneExceptions.set([]),
		});
	}

	private loadBlog(row: BlogCategory) {
		this.id = row.id;
		this.form.patchValue({ slug: row.slug, status: row.status === 'live' });
		this.fields.load({ name: row.name, description: row.description });
	}

	switchLanguage(locale: string) {
		this.fields.switchTo(locale);
		this.localeChange.emit(locale);
		this.refreshMissing();
	}

	openLanguageGap({ key, locale }: { key: string; locale: string }) {
		this.switchLanguage(locale);
		focusField(this.page, key);
	}

	private refreshMissing() {
		// A blog category has no search text, and its description is optional.
		const english = this.fields.text('description')['en']?.trim();
		const shown = (gap: LanguageGap) =>
			!this.isBlog() || gap.key === 'name' || (gap.key === 'description' && !!english);
		this.gaps.set(gapsByLocale(this.locales, (locale) => this.fields.gaps(locale).filter(shown)));
	}

	/** A top-level category and its children, for the second-parent dropdown. */
	placementOptions() {
		const flat = (rows: readonly ICategory[]): ICategory[] =>
			rows.flatMap((row) => [row, ...flat(row.subcategories ?? [])]);
		return flat(this.categories() ?? [])
			.filter((row) => row.id !== this.id)
			.map((row) => ({ value: row.id, label: row.name }));
	}

	/** A top-level category inherits charges from the shop defaults, not a parent. */
	hasParent(): boolean {
		const parent: unknown = this.form.controls['parent_id'].value;
		return typeof parent === 'string' && parent !== '';
	}

	selectItem(data: string[]) {
		if (Array.isArray(data) && data.length) {
			this.form.controls['parent_id'].setValue(data[0]);
		} else {
			this.form.controls['parent_id'].setValue('');
		}
	}

	/** Keeps the version a picture was chosen with in the Media picker (R4-1; media step 4d). */
	private keepVersion(data: IAttachment | null | undefined) {
		const versionId = (data as PickedAttachment | null | undefined)?.versionId;
		if (data && versionId) this.imageVersions = { ...this.imageVersions, [String(data.id)]: versionId };
	}

	selectCategoryImage(value: ImageUploadValue) {
		const data = onePicture(value);
		if (!Array.isArray(value)) {
			this.keepVersion(data);
			this.form.controls['category_image_id'].setValue(data ? data.id : '');
		}
	}

	selectCategoryIcon(value: ImageUploadValue) {
		const data = onePicture(value);
		if (!Array.isArray(value)) {
			this.keepVersion(data);
			this.form.controls['category_icon_id'].setValue(data ? data.id : '');
		}
	}

	/** The HSN the category had when opened, to tell a change apart (F03). */
	private savedHsn: string | null = null;

	/**
	 * F03: a changed HSN asks whether the products that follow the category (its old code, or
	 * none) take the new one; products with their own code are named and left alone.
	 */
	private async askProductsHsn(next: string | null): Promise<boolean | null> {
		if (!this.id || next === this.savedHsn) return false;
		const impact = await firstValueFrom(this.categoryService.hsnImpact(this.id)).catch(() => null);
		// Nothing follows the category's code: there is nobody to ask about.
		if (!impact || impact.using === 0) return false;
		const shown = impact.own.slice(0, 6);
		return askYesNo(this.modals, {
			icon: 'ri-error-warning-line',
			title: 'category_hsn_title',
			body: impact.own.length ? 'category_hsn_body_own' : 'category_hsn_body',
			params: { count: impact.using, from: this.savedHsn ?? '—', to: next ?? '—', own: impact.own.length },
			items: shown.map((row) => `${row.sku} · ${row.title} · ${row.hsnCode}`),
			more:
				impact.own.length > shown.length
					? this.transloco.translate('and_n_more', { count: impact.own.length - shown.length })
					: undefined,
			yes: 'category_hsn_update',
			no: 'category_hsn_only',
		});
	}

	submit() {
		this.form.markAllAsTouched();
		const name = this.fields.text('name');
		if (!name['en']?.trim()) {
			this.switchLanguage('en');
			this.form.get('name')?.setErrors({ required: true });
			return;
		}
		if (this.isBlog()) {
			this.saveBlog(name);
			return;
		}
		if (!this.form.valid) return;
		const raw = this.form.getRawValue() as Record<string, unknown>;
		const parent = raw['parent_id'];
		const also = raw['also_under'];
		const hsn = String(raw['hsn_code'] ?? '').trim() || null;
		const body: AdminCategoryWrite = {
			hsnCode: hsn,
			returnable: raw['returnable'] !== 'no',
			shipping: {
				domesticINR: shippingValue(raw['ship_domestic']),
				internationalFirstINR: shippingValue(raw['ship_first']),
				internationalFurtherINR: shippingValue(raw['ship_further']),
				weightGrams: shippingValue(raw['ship_weight']),
				lengthCm: shippingValue(raw['ship_length']),
				widthCm: shippingValue(raw['ship_width']),
				heightCm: shippingValue(raw['ship_height']),
			},
			updateProductsHsn: false,
			name,
			description: this.fields.text('description'),
			seoTitle: this.fields.text('seo_title'),
			seoDescription: this.fields.text('seo_description'),
			slug: String(raw['slug']),
			parentId: typeof parent === 'string' && parent ? parent : null,
			alsoUnder: Array.isArray(also) ? also.map(String) : [],
			imageId: picked(raw['category_image_id']),
			iconId: picked(raw['category_icon_id']),
			imageVersions: this.imageVersions,
		};
		// F03: a changed HSN on a saved category first asks about the products that follow it.
		if (this.id && hsn !== this.savedHsn) {
			void this.askProductsHsn(hsn).then((update) => {
				if (update !== null) this.send({ ...body, updateProductsHsn: update });
			});
			return;
		}
		this.send(body);
	}

	private send(body: AdminCategoryWrite) {
		this.categoryService.saveCategory(this.id ?? null, body).subscribe({
			next: () => {
				void this.queryClient.invalidateQueries({ queryKey: ['categories'] });
				this.notifier.showSuccess(this.transloco.translate('saved'));
				void this.router.navigateByUrl('/category');
			},
			error: () => this.notifier.showError(this.transloco.translate('category_rejected')),
		});
	}

	private saveBlog(name: Record<string, string>) {
		if (this.form.controls['slug'].invalid) return;
		const raw = this.form.getRawValue() as Record<string, unknown>;
		const typed = typeof raw['slug'] === 'string' ? raw['slug'].trim() : '';
		const slug =
			typed ||
			(name['en'] ?? '')
				.toLowerCase()
				.normalize('NFKD')
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '');
		const body = {
			name,
			description: this.fields.text('description'),
			slug,
			status: raw['status'] ? ('live' as const) : ('draft' as const),
		};
		this.blogs.saveTerm('categories', this.id ?? null, body).subscribe({
			next: () => {
				void this.queryClient.invalidateQueries({ queryKey: ['categories'] });
				this.notifier.showSuccess(this.transloco.translate('saved'));
				void this.router.navigateByUrl('/blog/category');
			},
			error: (error: unknown) => {
				const gaps = gapsFromError(error);
				if (!gaps.length) {
					this.notifier.showError(this.transloco.translate('category_rejected'));
					return;
				}
				goLiveToast(
					{ live: false, gaps },
					this.notifier,
					(key) => this.transloco.translate(key),
					BLOG_GO_LIVE_WORDS,
				);
				const locale = gaps.find((gap) => gap.locale)?.locale;
				if (locale) this.switchLanguage(locale);
			},
		});
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}

/** A typed shipping value: empty means "inherit", anything else a non-negative number. */
function shippingValue(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? n : null;
}
