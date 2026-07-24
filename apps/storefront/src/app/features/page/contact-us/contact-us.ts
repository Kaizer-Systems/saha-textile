import { Component, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { SiteConfigStore } from '@core/state/site-config.store';
import { IContact, ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

@Component({
	selector: 'app-contact-us',
	templateUrl: './contact-us.html',
	styleUrls: ['./contact-us.scss'],
	imports: [Breadcrumb, ReactiveFormsModule, Button, TranslocoModule],
})
export class ContactUs {
	private formBuilder = inject(FormBuilder);

	siteConfig$: Observable<ISiteConfig> = toObservable(inject(SiteConfigStore).siteConfig) as Observable<ISiteConfig>;

	public breadcrumb = translatedBreadcrumb('contact_us');

	public form: FormGroup;
	public contactData: IContact;

	constructor() {
		this.form = this.formBuilder.group({
			name: new FormControl('', [Validators.required]),
			email: new FormControl('', [Validators.required, Validators.email]),
			phone: new FormControl('', [Validators.required]),
			subject: new FormControl('', [Validators.required]),
			message: new FormControl('', [Validators.required]),
		});

		this.siteConfig$.subscribe((data) => (this.contactData = data?.contact_us));
	}

	submit() {
		this.form.markAllAsTouched();
		if (this.form.valid) {
			// Contact form has no backend yet — just reset locally.
			this.form.reset();
		}
	}
}
