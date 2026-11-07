import { Component, inject, input, signal } from '@angular/core';
import { FormGroup, FormBuilder, FormControl, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import type { AdminCategoryWrite } from '@saha-textile/contracts';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Select2 } from 'ng-select2-component';
import { Subject, of } from 'rxjs';
import { switchMap, map, takeUntil } from 'rxjs/operators';

import { ADMIN_LOCALES, LocalizedFields } from '@core/i18n/localized-fields';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { ICategory } from '@data-access/interfaces/category.interface';
import { CategoryService } from '@data-access/services/category.service';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

const LANGUAGE_FIELDS = ['name', 'description', 'seo_title', 'seo_description'];

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
	],
})
export class FormCategory {
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private categoryService = inject(CategoryService);
	private queryClient = inject(QueryClient);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);

	readonly type = input<string>(undefined);
	readonly categories = input<ICategory[]>(undefined);
	readonly categoryType = input<string | null>('product');

	public form: FormGroup;
	public category: ICategory;
	public id: string;

	readonly locales = ADMIN_LOCALES;
	readonly fields: LocalizedFields;
	readonly missing = signal<Record<string, number>>({});

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

	ngOnInit() {
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
				this.form.patchValue({ slug: row.slug, parent_id: row.parentId, also_under: row.alsoUnder });
				this.fields.load({
					name: row.name,
					description: row.description,
					seo_title: row.seoTitle,
					seo_description: row.seoDescription,
				});
				this.refreshMissing();
			});
		this.refreshMissing();
	}

	switchLanguage(locale: string) {
		this.fields.switchTo(locale);
		this.refreshMissing();
	}

	private refreshMissing() {
		this.missing.set(Object.fromEntries(this.locales.map((locale) => [locale, this.fields.missing(locale)])));
	}

	/** A top-level category and its children, for the second-parent dropdown. */
	placementOptions() {
		const flat = (rows: readonly ICategory[]): ICategory[] =>
			rows.flatMap((row) => [row, ...flat(row.subcategories ?? [])]);
		return flat(this.categories() ?? [])
			.filter((row) => row.id !== this.id)
			.map((row) => ({ value: row.id, label: row.name }));
	}

	selectItem(data: string[]) {
		if (Array.isArray(data) && data.length) {
			this.form.controls['parent_id'].setValue(data[0]);
		} else {
			this.form.controls['parent_id'].setValue('');
		}
	}

	selectCategoryImage(data: IAttachment) {
		if (!Array.isArray(data)) {
			this.form.controls['category_image_id'].setValue(data ? data.id : '');
		}
	}

	selectCategoryIcon(data: IAttachment) {
		if (!Array.isArray(data)) {
			this.form.controls['category_icon_id'].setValue(data ? data.id : '');
		}
	}

	submit() {
		this.form.markAllAsTouched();
		const name = this.fields.text('name');
		if (!name['en']?.trim()) {
			this.switchLanguage('en');
			this.form.get('name')?.setErrors({ required: true });
			return;
		}
		if (!this.form.valid) return;
		if (this.categoryType() === 'post') {
			void this.router.navigateByUrl('/blog/category');
			return;
		}
		const raw = this.form.getRawValue() as Record<string, unknown>;
		const parent = raw['parent_id'];
		const also = raw['also_under'];
		const body: AdminCategoryWrite = {
			name,
			description: this.fields.text('description'),
			seoTitle: this.fields.text('seo_title'),
			seoDescription: this.fields.text('seo_description'),
			slug: String(raw['slug']),
			parentId: typeof parent === 'string' && parent ? parent : null,
			alsoUnder: Array.isArray(also) ? also.map(String) : [],
			displayOrder: 0,
		};
		this.categoryService.saveCategory(this.id ?? null, body).subscribe({
			next: () => {
				void this.queryClient.invalidateQueries({ queryKey: ['categories'] });
				this.notifier.showSuccess(this.transloco.translate('saved'));
				void this.router.navigateByUrl('/category');
			},
			error: () => this.notifier.showError(this.transloco.translate('category_rejected')),
		});
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}
