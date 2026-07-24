import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, input } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2Data, Select2Module } from 'ng-select2-component';
import { Subject, of } from 'rxjs';
import { map, switchMap, takeUntil } from 'rxjs/operators';

import { AttributeService } from '@data-access/services/attribute.service';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';

@Component({
	selector: 'app-form-attribute',
	templateUrl: './form-attribute.html',
	styleUrls: ['./form-attribute.scss'],
	imports: [ReactiveFormsModule, FormFields, Select2Module, Button, TranslocoModule],
})
export class FormAttribute {
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private attributeService = inject(AttributeService);

	readonly type = input<string>(undefined);

	public form: FormGroup;
	public documents = [{ value: '', hex_color: '', id: '' }];
	public id: number;
	public isBrowser: boolean;

	private destroy$ = new Subject<void>();

	public variantStyle: Select2Data = [
		{
			value: 'rectangle',
			label: 'Rectangle',
		},
		{
			value: 'circle',
			label: 'Circle',
		},
		{
			value: 'radio',
			label: 'Radio',
		},
		{
			value: 'radio_bar',
			label: 'Radio Bar',
		},
		{
			value: 'dropdown',
			label: 'Dropdown',
		},
		{
			value: 'image',
			label: 'Image',
		},
		{
			value: 'image_tile',
			label: 'Image V2',
		},
		{
			value: 'color',
			label: 'Color',
		},
	];

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);
		this.form = this.formBuilder.group({
			name: new FormControl('', [Validators.required]),
			style: new FormControl('rectangle', [Validators.required]),
			status: new FormControl(1),
			value: this.formBuilder.array([], [Validators.required]),
		});
	}

	get valueControl(): FormArray {
		return this.form.get('value') as FormArray;
	}

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => {
					if (!params['id']) return of();
					return this.attributeService
						.getAttributes()
						.pipe(map((res) => res.data.find((attribute) => attribute.id == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((attribute) => {
				this.id = attribute?.id!;
				// Set Value in form
				this.form.patchValue({
					name: attribute?.name,
					style: attribute?.style,
					status: attribute?.status,
				});
				// Set Attribute Values
				attribute?.attribute_values!.forEach((document) =>
					this.valueControl.push(
						this.formBuilder.group({
							value: new FormControl(document.value, [Validators.required]),
							hex_color: new FormControl(document.hex_color),
							id: new FormControl(document.id, []),
						}),
					),
				);
			});

		if (this.type() == 'create') {
			this.documents.forEach((document) =>
				this.valueControl.push(
					this.formBuilder.group({
						value: [document.value, [Validators.required]],
						hex_color: [document.hex_color],
						id: [document.id],
					}),
				),
			);
		}
	}

	add(event: Event) {
		event.preventDefault();
		const valueGroup =
			this.form.get('style')!.value === 'color'
				? this.formBuilder.group({
						value: ['', [Validators.required]],
						hex_color: [''],
					})
				: this.formBuilder.group({
						value: ['', [Validators.required]],
					});
		this.valueControl.push(valueGroup);
	}

	remove(index: number) {
		if (this.valueControl.length <= 1) return;
		this.valueControl.removeAt(+index);
	}

	submit() {
		this.form.markAllAsTouched();

		if (this.form.valid) {
			// Create/update have no backend yet — just navigate back to the list.
			void this.router.navigateByUrl('/attribute');
		}
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}
