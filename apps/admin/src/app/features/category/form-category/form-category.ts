import { Component, inject, input } from '@angular/core';
import { FormGroup, FormBuilder, FormControl, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import { switchMap, map, takeUntil } from 'rxjs/operators';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';
import { NumberDirective } from '@shared/directives/numbers-only.directive';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { ICategory } from '@data-access/interfaces/category.interface';
import { CategoryService } from '@data-access/services/category.service';

@Component({
	selector: 'app-form-category',
	templateUrl: './form-category.html',
	styleUrls: ['./form-category.scss'],
	imports: [
		PageWrapper,
		ReactiveFormsModule,
		FormFields,
		NumberDirective,
		AdvancedDropdown,
		ImageUpload,
		Button,
		TranslateModule,
	],
})
export class FormCategory {
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private categoryService = inject(CategoryService);

	readonly type = input<string>(undefined);
	readonly categories = input<ICategory[]>(undefined);
	readonly categoryType = input<string | null>('product');

	public form: FormGroup;
	public category: ICategory;
	public id: number;

	private destroy$ = new Subject<void>();

	constructor() {
		this.form = this.formBuilder.group({
			name: new FormControl('', [Validators.required]),
			description: new FormControl(),
			parent_id: new FormControl(),
			type: new FormControl(this.categoryType(), []),
			commission_rate: new FormControl(),
			category_image_id: new FormControl(),
			category_icon_id: new FormControl(),
			status: new FormControl(true),
		});
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
						.getCategories()
						.pipe(map((res) => res.data.find((category) => category.id == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((category) => {
				this.category = category!;
				this.form.patchValue({
					name: this.category?.name,
					description: this.category?.description,
					parent_id: this.category?.parent_id,
					type: this.category?.type,
					commission_rate: this.category?.commission_rate,
					category_image_id: this.category?.category_image_id,
					category_icon_id: this.category?.category_icon_id,
					status: this.category?.status,
				});
			});
	}

	selectItem(data: number[]) {
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

		if (this.form.valid) {
			// Create/update have no backend yet — mirror the post-save UX locally.
			if (this.type() == 'create') {
				this.form.reset();
				this.form.controls['category_image_id'].setValue('');
				this.form.controls['category_icon_id'].setValue('');
				this.form.controls['status'].setValue(true);
			} else {
				if (this.form.value.type === 'product') {
					void this.router.navigateByUrl('/category');
				} else {
					void this.router.navigateByUrl('/blog/category');
				}
			}
		}
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}
