import { Component, inject, input } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2 } from 'ng-select2-component';
import { map, of, Subject, switchMap, takeUntil } from 'rxjs';

import { FaqScope, IFaq } from '@data-access/interfaces/faq.interface';
import { FaqService } from '@data-access/services/faq.service';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';

const idList = (value: string): string[] =>
	value
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);

@Component({
	selector: 'app-form-faq',
	templateUrl: './form-faq.html',
	styleUrls: ['./form-faq.scss'],
	imports: [Select2, ReactiveFormsModule, FormFields, Button, TranslocoModule],
})
export class FormFaq {
	private faqService = inject(FaqService);
	private router = inject(Router);
	private route = inject(ActivatedRoute);
	private formBuilder = inject(FormBuilder);

	readonly type = input<string>(undefined);

	readonly scopes = [
		{ value: 'global', label: 'global' },
		{ value: 'category', label: 'category' },
		{ value: 'product', label: 'product' },
		{ value: 'mixed', label: 'mixed' },
	];

	public form: FormGroup;
	public faq: IFaq | null;

	private destroy$ = new Subject<void>();

	constructor() {
		this.form = this.formBuilder.group({
			title: new FormControl('', [Validators.required]),
			description: new FormControl('', [Validators.required]),
			titleFr: new FormControl(''),
			descriptionFr: new FormControl(''),
			status: new FormControl(true),
			scope: new FormControl('global'),
			categoryIds: new FormControl(''),
			productIds: new FormControl(''),
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
					titleFr: this.faq?.titleFr,
					descriptionFr: this.faq?.descriptionFr,
					status: this.faq?.status,
					scope: this.faq?.scope ?? 'global',
					categoryIds: this.faq?.categoryIds?.join(', ') ?? '',
					productIds: this.faq?.productIds?.join(', ') ?? '',
				});
			});
	}

	submit() {
		this.form.markAllAsTouched();

		if (this.form.valid) {
			const raw = this.form.getRawValue() as {
				title: string;
				description: string;
				titleFr: string;
				descriptionFr: string;
				status: boolean;
				scope: FaqScope;
				categoryIds: string;
				productIds: string;
			};
			this.faqService
				.save({
					...raw,
					categoryIds: idList(raw.categoryIds),
					productIds: idList(raw.productIds),
					faqId: this.faq?.faqId,
				})
				.pipe(takeUntil(this.destroy$))
				.subscribe(() => void this.router.navigateByUrl('/faq'));
		}
	}
}
