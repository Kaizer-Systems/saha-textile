import { isPlatformBrowser, AsyncPipe } from '@angular/common';
import { Component, PLATFORM_ID, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Editor, NgxEditorModule } from 'ngx-editor';
import { Observable, Subject, of } from 'rxjs';
import { map, switchMap, takeUntil } from 'rxjs/operators';

import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { ICategoryModel } from '@data-access/interfaces/category.interface';
import { injectCategoriesQuery } from '@data-access/queries/category.queries';
import { injectTagsQuery } from '@data-access/queries/tag.queries';
import { BlogService } from '@data-access/services/blog.service';
import { AdvancedDropdown } from '@shared/ui/advanced-dropdown/advanced-dropdown';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';

@Component({
	selector: 'app-form-blog',
	templateUrl: './form-blog.html',
	styleUrls: ['./form-blog.scss'],
	imports: [
		ReactiveFormsModule,
		FormFields,
		NgxEditorModule,
		ImageUpload,
		AdvancedDropdown,
		Button,
		TranslocoModule,
		AsyncPipe,
	],
})
export class FormBlog {
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private blogService = inject(BlogService);

	readonly type = input<string>(undefined);

	private readonly categoriesQuery = injectCategoriesQuery(() => ({ type: 'post' }));
	category$: Observable<ICategoryModel | undefined> = toObservable(this.categoriesQuery.data);
	readonly tagsQuery = injectTagsQuery(() => ({ type: 'post' }));

	public form: FormGroup;
	public id: number;
	public selectedCategories: number[] = [];
	public selectedTags: number[] = [];
	public html = '';
	public editor: Editor;
	private destroy$ = new Subject<void>();
	public isBrowser: boolean;

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);

		this.form = this.formBuilder.group({
			title: new FormControl('', [Validators.required]),
			description: new FormControl(),
			content: new FormControl(),
			meta_title: new FormControl(),
			meta_description: new FormControl(),
			blog_meta_image_id: new FormControl(),
			blog_thumbnail_id: new FormControl('', [Validators.required]),
			categories: new FormControl('', [Validators.required]),
			tags: new FormControl(),
			is_featured: new FormControl(0),
			is_sticky: new FormControl(0),
			status: new FormControl(1),
		});
	}

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => {
					if (!params['id']) return of();
					return this.blogService
						.getBlogs()
						.pipe(map((res) => res.data.find((blog) => blog.id == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((blog) => {
				this.id = blog?.id!;
				this.selectedCategories = blog?.categories.map((value) => value?.id!)!;
				this.selectedTags = blog?.tags.map((value) => value?.id!)!;
				this.form.patchValue({
					title: blog?.title,
					description: blog?.description,
					content: blog?.content,
					blog_thumbnail_id: blog?.blog_thumbnail_id,
					categories: this.selectedCategories,
					tags: this.selectedTags,
					meta_title: blog?.meta_title,
					meta_description: blog?.meta_description,
					is_featured: blog?.is_featured,
					is_sticky: blog?.is_sticky,
					status: blog?.status,
				});
			});

		if (this.isBrowser) {
			this.editor = new Editor();
		}
	}

	selectThumbnail(data: IAttachment) {
		if (!Array.isArray(data)) {
			this.form.controls['blog_thumbnail_id'].setValue(data ? data.id : '');
		}
	}

	selectMetaImage(data: IAttachment) {
		if (!Array.isArray(data)) {
			this.form.controls['blog_meta_image_id'].setValue(data ? data.id : null);
		}
	}

	selectCategoryItem(data: number[]) {
		if (Array.isArray(data)) {
			this.form.controls['categories'].setValue(data);
		}
	}

	selectTagItem(data: number[]) {
		if (Array.isArray(data)) {
			this.form.controls['tags'].setValue(data);
		}
	}

	submit() {
		this.form.markAllAsTouched();

		if (this.form.valid) {
			// Create/update have no backend yet — just navigate back to the list.
			void this.router.navigateByUrl('/blog');
		}
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}
