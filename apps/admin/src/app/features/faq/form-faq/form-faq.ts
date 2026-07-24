import { Component, inject, input } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { map, of, Subject, switchMap, takeUntil } from 'rxjs';

import { IFaq } from '@data-access/interfaces/faq.interface';
import { FaqService } from '@data-access/services/faq.service';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';

@Component({
	selector: 'app-form-faq',
	templateUrl: './form-faq.html',
	styleUrls: ['./form-faq.scss'],
	imports: [ReactiveFormsModule, FormFields, Button, TranslocoModule],
})
export class FormFaq {
	private faqService = inject(FaqService);
	private router = inject(Router);
	private route = inject(ActivatedRoute);
	private formBuilder = inject(FormBuilder);

	readonly type = input<string>(undefined);

	public form: FormGroup;
	public faq: IFaq | null;

	private destroy$ = new Subject<void>();

	constructor() {
		this.form = this.formBuilder.group({
			title: new FormControl('', [Validators.required]),
			description: new FormControl('', [Validators.required]),
			status: new FormControl(true),
		});
	}

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => {
					if (!params['id']) return of();
					return this.faqService
						.getFaqs()
						.pipe(map((res) => res.data.find((faq) => faq.id == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((faq) => {
				this.faq = faq;
				this.form.patchValue({
					title: this.faq?.title,
					description: this.faq?.description,
					status: this.faq?.status,
				});
			});
	}

	submit() {
		this.form.markAllAsTouched();

		if (this.form.valid) {
			// Create/update have no backend yet — just navigate.
			void this.router.navigateByUrl('/faq');
		}
	}
}
