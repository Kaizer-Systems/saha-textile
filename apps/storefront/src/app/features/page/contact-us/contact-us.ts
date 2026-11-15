import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbCarousel, NgbModal, NgbSlide } from '@ng-bootstrap/ng-bootstrap';
import { Observable } from 'rxjs';

import { ACTIVE_LOCALE } from '@core/i18n/active-locale';
import { LocaleSeo } from '@core/i18n/locale-seo';
import { type ResolvedImage, roleSrcset } from '@core/media/resolved-image';
import { SiteConfigStore } from '@core/state/site-config.store';
import { IContact, ISiteConfig } from '@data-access/interfaces/site-config.interface';
import { injectBrandQuery } from '@data-access/queries/brand.queries';
import { injectStoreLocationsQuery } from '@data-access/queries/store-location.queries';
import { ContactMessageService } from '@data-access/services/contact-message.service';
import { NotificationService } from '@data-access/services/notification.service';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { ContactSentModal } from '@shared/ui/modal/contact-sent-modal/contact-sent-modal';
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
	private contactMessages = inject(ContactMessageService);
	private notifications = inject(NotificationService);
	private modals = inject(NgbModal);
	private transloco = inject(TranslocoService);
	private readonly locale = inject(ACTIVE_LOCALE);
	/** When the form appeared: a message sent within three seconds is a bot's. */
	private readonly openedAt = Date.now();
	/** True while a message is on its way, so a double click sends it once. */
	readonly sending = signal(false);
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
		// The same limits the API checks (`ContactMessageRequest`). The phone is optional.
		this.form = this.formBuilder.group({
			name: new FormControl('', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]),
			email: new FormControl('', [Validators.required, Validators.email, Validators.maxLength(254)]),
			phone: new FormControl('', [Validators.maxLength(20)]),
			subject: new FormControl('', [Validators.required, Validators.minLength(3), Validators.maxLength(120)]),
			message: new FormControl('', [Validators.required, Validators.minLength(10), Validators.maxLength(2000)]),
			// Hidden from people (stores brief): anything typed here marks a bot.
			website: new FormControl(''),
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

	/** Sends the message; the shop's team gets it in their Gmail mailbox and replies by email. */
	submit() {
		this.form.markAllAsTouched();
		if (this.form.invalid || this.sending()) return;
		const value = this.form.getRawValue() as Record<string, string | null>;
		this.sending.set(true);
		this.contactMessages
			.send({
				name: value['name'] ?? '',
				email: value['email'] ?? '',
				phone: String(value['phone'] ?? ''),
				subject: value['subject'] ?? '',
				message: value['message'] ?? '',
				locale: this.locale,
				website: value['website'] ?? '',
				elapsedMs: Date.now() - this.openedAt,
			})
			.subscribe({
				next: () => {
					this.sending.set(false);
					this.form.reset();
					this.modals.open(ContactSentModal, {
						ariaLabelledBy: 'contact_sent_title',
						centered: true,
						windowClass: 'theme-modal',
					});
				},
				error: (error: unknown) => {
					this.sending.set(false);
					const key =
						error instanceof HttpErrorResponse && error.status === 429
							? 'contact_too_many'
							: 'contact_not_sent';
					this.notifications.showError(this.transloco.translate(key));
				},
			});
	}
}
