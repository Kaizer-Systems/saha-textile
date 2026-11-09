import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, effect, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbCarousel, NgbSlide } from '@ng-bootstrap/ng-bootstrap';
import { Observable } from 'rxjs';

import { LocaleSeo } from '@core/i18n/locale-seo';
import { type ResolvedImage, roleSrcset } from '@core/media/resolved-image';
import { SiteConfigStore } from '@core/state/site-config.store';
import { IContact, ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { injectBrandQuery } from '@data-access/queries/brand.queries';
import { injectStoreLocationsQuery } from '@data-access/queries/store-location.queries';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

import type { PublicStoreLocation, StoreDayHours } from '@data-access/interfaces/store-location.interface';

const STORES_JSONLD = 'stores-jsonld';
const PHOTO_ROLE = 'store_photo';
/** Carousel pace (stores brief): one photo every four seconds. */
const PHOTO_INTERVAL_MS = 4000;
const DAY_NAMES: Readonly<Record<StoreDayHours['day'], string>> = {
	mon: 'Monday',
	tue: 'Tuesday',
	wed: 'Wednesday',
	thu: 'Thursday',
	fri: 'Friday',
	sat: 'Saturday',
	sun: 'Sunday',
};

@Component({
	selector: 'app-contact-us',
	templateUrl: './contact-us.html',
	styleUrls: ['./contact-us.scss'],
	imports: [Breadcrumb, ReactiveFormsModule, Button, TranslocoModule, NgbCarousel, NgbSlide],
})
export class ContactUs {
	private formBuilder = inject(FormBuilder);
	private seo = inject(LocaleSeo);
	private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

	private readonly storesQuery = injectStoreLocationsQuery();
	private readonly brandQuery = injectBrandQuery();
	/** Active stores in the admin's order; the section is left out when there are none. */
	readonly stores = computed<PublicStoreLocation[]>(() => this.storesQuery.data() ?? []);
	/** Shown in the photo box of a store that has no photos yet, so every card lines up. */
	readonly seal = computed(() => this.brandQuery.data()?.seal ?? null);
	/** The carousel stands still on the server and for visitors who ask for reduced motion. */
	readonly interval =
		this.isBrowser && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? PHOTO_INTERVAL_MS : 0;

	siteConfig$: Observable<ISiteConfig> = toObservable(inject(SiteConfigStore).siteConfig) as Observable<ISiteConfig>;

	public breadcrumb = translatedBreadcrumb('contact_us', {
		description: 'contact_us_meta_description',
		ownHeading: true,
	});

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

		effect(() => {
			const stores = this.stores();
			if (stores.length) this.seo.applyJsonLd(STORES_JSONLD, this.structuredData(stores));
		});
	}

	ngOnDestroy() {
		this.seo.removeJsonLd(STORES_JSONLD);
	}

	srcset(photo: ResolvedImage): string | null {
		return roleSrcset(photo, PHOTO_ROLE);
	}

	/** The `src` fallback: the photo at 800 wide, or its widest. */
	src(photo: ResolvedImage): string {
		const sources = photo.roles[PHOTO_ROLE] ?? [];
		return (sources.find((source) => source.width >= 800) ?? sources.at(-1))?.url ?? '';
	}

	/**
	 * schema.org `Store` for each card, so search engines can show the stores in local results.
	 * Days with the same hours share one opening-hours entry.
	 */
	private structuredData(stores: PublicStoreLocation[]) {
		return {
			'@context': 'https://schema.org',
			'@graph': stores.map((store) => {
				const photo = store.photos[0];
				const grouped = new Map<string, string[]>();
				for (const day of store.hours) {
					if (!day.open) continue;
					const key = `${day.opens}|${day.closes}`;
					grouped.set(key, [...(grouped.get(key) ?? []), DAY_NAMES[day.day]]);
				}
				return {
					'@type': 'Store',
					name: store.name,
					address: {
						'@type': 'PostalAddress',
						streetAddress: store.address,
						postalCode: store.pinCode,
						addressCountry: 'IN',
					},
					hasMap: store.mapUrl,
					...(store.phone ? { telephone: store.phone } : {}),
					...(photo ? { image: this.src(photo) } : {}),
					...(store.geo
						? { geo: { '@type': 'GeoCoordinates', latitude: store.geo.lat, longitude: store.geo.lng } }
						: {}),
					openingHoursSpecification: [...grouped].map(([key, dayOfWeek]) => {
						const [opens, closes] = key.split('|');
						return { '@type': 'OpeningHoursSpecification', dayOfWeek, opens, closes };
					}),
				};
			}),
		};
	}

	submit() {
		this.form.markAllAsTouched();
		if (this.form.valid) {
			// The form is wired to the team's Gmail mailbox in the mailboxes chunk; until then it
			// only clears.
			this.form.reset();
		}
	}
}
