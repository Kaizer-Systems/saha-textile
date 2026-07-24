import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, input } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Editor, NgxEditorModule } from 'ngx-editor';
import { Subject, of } from 'rxjs';
import { map, switchMap, takeUntil } from 'rxjs/operators';

import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { IPage } from '@data-access/interfaces/page.interface';
import { PageService } from '@data-access/services/page.service';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';

@Component({
	selector: 'app-form-page',
	templateUrl: './form-page.html',
	styleUrls: ['./form-page.scss'],
	imports: [ReactiveFormsModule, FormFields, NgxEditorModule, ImageUpload, Button, TranslocoModule],
})
export class FormPage {
	private pageService = inject(PageService);
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);

	readonly type = input<string>(undefined);

	public form: FormGroup;
	public id: number;
	public page: IPage | null;

	public editor: Editor;
	public html = '';
	public isBrowser: boolean;

	private destroy$ = new Subject<void>();

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);
		this.form = this.formBuilder.group({
			title: new FormControl('', [Validators.required]),
			content: new FormControl(),
			meta_title: new FormControl(),
			meta_description: new FormControl(),
			page_meta_image_id: new FormControl(),
			status: new FormControl(1),
		});
	}

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => {
					if (!params['id']) return of();
					return this.pageService
						.getPages()
						.pipe(map((res) => res.data.find((page) => page.id == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((page) => {
				this.page = page;
				this.id = page?.id!;
				this.form.patchValue({
					title: page?.title,
					content: page?.content,
					meta_title: page?.meta_title,
					meta_description: page?.meta_description,
					status: page?.status,
				});
			});

		if (this.isBrowser) {
			this.editor = new Editor();
		}
	}

	selectMetaImage(data: IAttachment) {
		if (!Array.isArray(data)) {
			this.form.controls['page_meta_image_id'].setValue(data ? data.id : null);
		}
	}

	submit() {
		this.form.markAllAsTouched();

		if (this.form.valid) {
			// Create/update have no backend yet — just navigate.
			void this.router.navigateByUrl('/page');
		}
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}
