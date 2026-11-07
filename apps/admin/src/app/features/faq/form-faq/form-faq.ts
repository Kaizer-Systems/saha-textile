import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2 } from 'ng-select2-component';
import { map, of, Subject, switchMap, takeUntil } from 'rxjs';

import { ADMIN_LOCALES, LocalizedFields, SOURCE_LOCALE } from '@core/i18n/localized-fields';
import { FaqScope, IFaq } from '@data-access/interfaces/faq.interface';
import { FaqService } from '@data-access/services/faq.service';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

const idList = (value: string): string[] =>
	value
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);

@Component({
	selector: 'app-form-faq',
	templateUrl: './form-faq.html',
	styleUrls: ['./form-faq.scss'],
	imports: [Select2, ReactiveFormsModule, FormFields, Button, TranslocoModule, LanguageSwitch],
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
	readonly fields: LocalizedFields;
	readonly locales = ADMIN_LOCALES;
	readonly missing = signal<Record<string, number>>({});

	private destroy$ = new Subject<void>();

	constructor() {
		this.form = this.formBuilder.group({
			title: new FormControl(''),
			description: new FormControl(''),
			status: new FormControl(true),
			scope: new FormControl('global'),
			categoryIds: new FormControl(''),
			productIds: new FormControl(''),
		});
		this.fields = new LocalizedFields(this.form, ['title', 'description']);
	}

	get onSourceLanguage(): boolean {
		return this.fields.locale() === SOURCE_LOCALE;
	}

	switchLanguage(locale: string) {
		this.fields.switchTo(locale);
		this.refreshMissing();
	}

	refreshMissing() {
		this.missing.set(Object.fromEntries(this.locales.map((locale) => [locale, this.fields.missing(locale)])));
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
					status: this.faq?.status,
					scope: this.faq?.scope ?? 'global',
					categoryIds: this.faq?.categoryIds?.join(', ') ?? '',
					productIds: this.faq?.productIds?.join(', ') ?? '',
				});
				this.fields.load({
					title: { en: this.faq?.title ?? '', fr: this.faq?.titleFr ?? '' },
					description: { en: this.faq?.description ?? '', fr: this.faq?.descriptionFr ?? '' },
				});
				this.refreshMissing();
			});
		this.refreshMissing();
	}

	submit() {
		this.form.markAllAsTouched();
		const title = this.fields.text('title');
		const description = this.fields.text('description');
		if (!title['en']?.trim() || !description['en']?.trim()) {
			this.switchLanguage(SOURCE_LOCALE);
			if (!title['en']?.trim()) this.form.controls['title'].setErrors({ required: true });
			if (!description['en']?.trim()) this.form.controls['description'].setErrors({ required: true });
			return;
		}
		const raw = this.form.getRawValue() as {
			status: boolean;
			scope: FaqScope;
			categoryIds: string;
			productIds: string;
		};
		this.faqService
			.save({
				...raw,
				title: title['en'],
				description: description['en'],
				titleFr: title['fr'] ?? '',
				descriptionFr: description['fr'] ?? '',
				categoryIds: idList(raw.categoryIds),
				productIds: idList(raw.productIds),
				faqId: this.faq?.faqId,
			})
			.pipe(takeUntil(this.destroy$))
			.subscribe(() => void this.router.navigateByUrl('/faq'));
	}
}
