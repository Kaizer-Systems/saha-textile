import { Component, inject, input } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import { map, switchMap, takeUntil } from 'rxjs/operators';

import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { TaxService } from '@data-access/services/tax.service';

@Component({
	selector: 'app-form-tax',
	templateUrl: './form-tax.html',
	styleUrls: ['./form-tax.scss'],
	imports: [ReactiveFormsModule, FormFields, Button, TranslateModule],
})
export class FormTax {
	private taxService = inject(TaxService);
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);

	readonly type = input<string>(undefined);

	public id: number;
	public form: FormGroup;

	private destroy$ = new Subject<void>();

	constructor() {
		this.form = this.formBuilder.group({
			name: new FormControl('', [Validators.required]),
			rate: new FormControl('', [Validators.required]),
			status: new FormControl(1),
		});
	}

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => {
					if (!params['id']) return of();
					return this.taxService
						.getTaxes()
						.pipe(map((res) => res.data.find((tax) => tax.id == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((tax) => {
				this.id = tax?.id!;
				this.form.patchValue({
					name: tax?.name,
					rate: tax?.rate,
					status: tax?.status,
				});
			});
	}

	submit() {
		this.form.markAllAsTouched();

		if (this.form.valid) {
			// Create/update have no backend yet — just navigate.
			void this.router.navigateByUrl('/tax');
		}
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}
