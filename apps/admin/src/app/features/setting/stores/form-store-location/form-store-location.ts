import { HttpErrorResponse } from '@angular/common/http';
import { Component, DOCUMENT, computed, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { Select2, type Select2Data } from 'ng-select2-component';
import { forkJoin } from 'rxjs';

import { STORE_GO_LIVE_WORDS, goLiveToast } from '@core/catalog/go-live-report';
import {
	focusField,
	gapsByLocale,
	type LanguageGap,
	LocalizedFields,
	SOURCE_LOCALE,
} from '@core/i18n/localized-fields';
import { ActiveLanguages } from '@core/i18n/active-languages';
import { MediaGateway } from '@core/media/media.gateway';
import { WEEKDAYS, summariseStoreHours } from '@core/stores/store-hours';
import { STORE_LOCATIONS_KEY, StoreLocationGateway } from '@core/stores/store-location.gateway';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload, type PickedAttachment } from '@shared/ui/image-upload/image-upload';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

import type { AdminStoreLocationRow, StoreDayHours, StoreLocationWrite, Weekday } from '@saha-textile/contracts';
import { LanguageListPipe } from '@shared/pipes/language.pipes';

/** 06:00 to 23:30 in half hours: the times the opens and closes pickers offer. */
export const STORE_TIMES: Select2Data = Array.from({ length: 36 }, (_, index) => {
	const minutes = 6 * 60 + index * 30;
	const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
	return { value, label: value };
});

/** Empty or only spaces. */
const blank = (value: string | undefined): boolean => !(value && value.trim());

const DEFAULT_OPENS = '10:00';
const DEFAULT_CLOSES = '21:00';

type DayGroup = FormGroup<{
	day: FormControl<Weekday>;
	open: FormControl<boolean>;
	opens: FormControl<string>;
	closes: FormControl<string>;
}>;

/**
 * The store form under Settings › Stores, for a new store and an existing one. Name, address and
 * landmark are written per language through the one Language switch; everything else is shared.
 */
@Component({
	selector: 'app-form-store-location',
	templateUrl: './form-store-location.html',
	imports: [
		LanguageListPipe,
		PageWrapper,
		ReactiveFormsModule,
		TranslocoModule,
		FormFields,
		Button,
		ImageUpload,
		LanguageSwitch,
		Select2,
	],
})
export class FormStoreLocation {
	private readonly page = inject<Document>(DOCUMENT);
	private readonly gateway = inject(StoreLocationGateway);
	private readonly media = inject(MediaGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly fb = inject(FormBuilder).nonNullable;

	readonly times = STORE_TIMES;
	readonly weekdays = WEEKDAYS;
	readonly locales = inject(ActiveLanguages).list();
	readonly storeId = signal<string | null>(null);
	readonly photos = signal<IAttachment[]>([]);
	readonly gaps = signal<Record<string, LanguageGap[]>>({});
	/** Bumped on every hours change, so the preview line recomputes. */
	private readonly hoursVersion = signal(0);

	readonly form = this.fb.group({
		name: [''],
		address: [''],
		landmark: [''],
		pinCode: [''],
		mapUrl: [''],
		phone: [''],
		active: [false],
		hours: this.fb.array<DayGroup>(WEEKDAYS.map((day) => this.dayGroup(day, false, DEFAULT_OPENS, DEFAULT_CLOSES))),
	});
	readonly fields = new LocalizedFields(
		this.form as unknown as FormGroup,
		['name', 'address', 'landmark'],
		['landmark'],
	);

	readonly hoursPreview = computed(() => {
		this.hoursVersion();
		return summariseStoreHours(this.hoursValue(), this.transloco.getActiveLang());
	});

	constructor() {
		this.form.controls.hours.valueChanges.subscribe(() => this.hoursVersion.update((value) => value + 1));
		const id = this.route.snapshot.params['id'] as string | undefined;
		if (id) {
			this.storeId.set(id);
			this.gateway.detail(id).subscribe((row) => this.load(row));
		}
		this.refreshMissing();
	}

	get hours(): FormArray<DayGroup> {
		return this.form.controls.hours;
	}

	get onSourceLanguage(): boolean {
		return this.fields.locale() === SOURCE_LOCALE;
	}

	switchLanguage(locale: string) {
		this.fields.switchTo(locale);
		this.refreshMissing();
	}

	openLanguageGap({ key, locale }: { key: string; locale: string }) {
		this.switchLanguage(locale);
		focusField(this.page, key);
	}

	refreshMissing() {
		this.gaps.set(gapsByLocale(this.locales, (locale) => this.fields.gaps(locale)));
	}

	/** Copies Monday's open switch and times to the other six days. */
	copyMonday() {
		const monday = this.hours.at(0).getRawValue();
		this.hours.controls
			.slice(1)
			.forEach((day) => day.patchValue({ open: monday.open, opens: monday.opens, closes: monday.closes }));
	}

	selectPhotos(selection: IAttachment[] | IAttachment | null | undefined) {
		const list = Array.isArray(selection) ? selection : selection ? [selection] : [];
		this.photos.set(list.slice(0, 8));
	}

	submit() {
		this.form.markAllAsTouched();
		const name = this.fields.text('name');
		const address = this.fields.text('address');
		const missingName = blank(name['en']);
		const missingAddress = blank(address['en']);
		if (missingName || missingAddress) {
			this.switchLanguage(SOURCE_LOCALE);
			if (missingName) this.form.controls.name.setErrors({ required: true });
			if (missingAddress) this.form.controls.address.setErrors({ required: true });
			return;
		}
		const raw = this.form.getRawValue();
		const body: StoreLocationWrite = {
			name,
			address,
			landmark: this.fields.text('landmark'),
			pinCode: raw.pinCode,
			mapUrl: raw.mapUrl,
			phone: raw.phone,
			hours: this.hoursValue(),
			photoAssetIds: this.photos().map((photo) => String(photo.id)),
			// The version each photo was chosen with (R4-1; media step 4d).
			imageVersions: Object.fromEntries(
				this.photos().flatMap((photo) => {
					const versionId = (photo as PickedAttachment).versionId;
					return versionId ? [[String(photo.id), versionId]] : [];
				}),
			),
			active: raw.active,
		};
		this.gateway.save(this.storeId(), body).subscribe({
			next: (result) => {
				void this.queryClient.invalidateQueries({ queryKey: STORE_LOCATIONS_KEY });
				if (raw.active && !result.active) {
					goLiveToast(
						{ live: false, gaps: result.gaps },
						this.notifier,
						(key) => this.transloco.translate(key),
						STORE_GO_LIVE_WORDS,
					);
				} else {
					this.notifier.showSuccess(this.transloco.translate('store_saved'));
				}
				void this.router.navigateByUrl('/setting/stores');
			},
			error: (error: unknown) => this.showFieldErrors(error),
		});
	}

	private hoursValue(): StoreDayHours[] {
		return this.hours
			.getRawValue()
			.map((day) =>
				day.open
					? { day: day.day, open: true, opens: day.opens, closes: day.closes }
					: { day: day.day, open: false, opens: null, closes: null },
			);
	}

	/** Marks the fields the API refused (a bad PIN code, phone or map link). */
	private showFieldErrors(error: unknown) {
		const issues = error instanceof HttpErrorResponse ? error.error?.error?.issues : undefined;
		if (!Array.isArray(issues)) return;
		for (const issue of issues as { path: (string | number)[] }[]) {
			const control = this.form.get(String(issue.path[0]));
			control?.setErrors({ invalid: true });
		}
	}

	private load(row: AdminStoreLocationRow) {
		const store = row.store;
		this.form.patchValue({
			pinCode: store.pinCode,
			mapUrl: store.mapUrl,
			phone: store.phone,
			active: store.active,
		});
		store.hours.forEach((day, index) =>
			this.hours.at(index).patchValue({
				open: day.open,
				opens: day.opens ?? DEFAULT_OPENS,
				closes: day.closes ?? DEFAULT_CLOSES,
			}),
		);
		this.fields.load({ name: store.name, address: store.address, landmark: store.landmark });
		// Fetched together so the photos keep their carousel order.
		if (store.photoAssetIds.length) {
			forkJoin(store.photoAssetIds.map((id) => this.media.get(id))).subscribe((list) =>
				this.photos.set(
					list.map((photo) => {
						const versionId = store.imageVersions?.[String(photo.id)];
						return versionId ? ({ ...photo, versionId } as IAttachment) : photo;
					}),
				),
			);
		}
		this.refreshMissing();
	}

	private dayGroup(day: Weekday, open: boolean, opens: string, closes: string): DayGroup {
		return this.fb.group({
			day: this.fb.control<Weekday>(day),
			open: this.fb.control(open),
			opens: this.fb.control(opens),
			closes: this.fb.control(closes),
		});
	}
}
