import { Component, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';

import { injectTagQuery } from '@data-access/queries/tag.queries';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ITag } from '@data-access/interfaces/tag.interface';

@Component({
	selector: 'app-form-tag',
	templateUrl: './form-tag.html',
	styleUrls: ['./form-tag.scss'],
	imports: [ReactiveFormsModule, FormFields, Button, TranslateModule],
})
export class FormTag {
	private router = inject(Router);
	private route = inject(ActivatedRoute);
	private formBuilder = inject(FormBuilder);

	readonly type = input<string>(undefined);
	readonly tagType = input<string | null>('product');

	public form: FormGroup;
	public tag: ITag | null;

	private readonly tagId = signal<number | undefined>(undefined);
	readonly tagQuery = injectTagQuery(() => this.tagId());

	constructor() {
		this.form = this.formBuilder.group({
			name: new FormControl('', [Validators.required]),
			description: new FormControl(),
			type: new FormControl(this.tagType(), []),
			status: new FormControl(true),
		});

		// Patch the form once the tag (by id) resolves — replaces the old
		// EditTagAction dispatch + selectedTag selection.
		effect(() => {
			const tag = this.tagQuery.data();
			if (tag) {
				this.tag = tag;
				this.form.patchValue({
					name: tag.name,
					description: tag.description,
					status: tag.status,
				});
			}
		});
	}

	ngOnChanges() {
		this.form.controls['type'].setValue(this.tagType());
	}

	ngOnInit() {
		this.route.params.subscribe((params) => {
			if (params['id']) this.tagId.set(Number(params['id']));
		});
	}

	submit() {
		this.form.markAllAsTouched();
		if (this.form.valid) {
			// Create/update have no backend yet (were no-op NGXS actions) — just navigate.
			if (this.tagType() == 'post') void this.router.navigateByUrl('/blog/tag');
			else void this.router.navigateByUrl('/tag');
		}
	}
}
