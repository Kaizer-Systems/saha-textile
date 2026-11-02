import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { type ContentBlock, ContentBlocksGateway, type ContentBlockInput } from '@core/media/content-blocks.gateway';
import { MediaGateway } from '@core/media/media.gateway';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';

/** Locales the storefront serves during development (en + fr; Bengali later, as data). */
export const BANNER_LOCALES = ['en', 'fr'] as const;

type Band = 'desktop' | 'tablet' | 'phone';
const WIDE_SLOTS = new Set(['hero:main', 'strip:main', 'bar:main', 'category_banner:main']);

const localizedGroup = () =>
	new FormGroup(
		Object.fromEntries(BANNER_LOCALES.map((locale) => [locale, new FormControl('', { nonNullable: true })])),
	);

const toLocal = (iso: string | null) => (iso ? iso.slice(0, 16) : '');
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);
const clean = (map: Record<string, string>) =>
	Object.fromEntries(Object.entries(map).filter(([, value]) => value.trim()));

/**
 * One banner slot (owner log § Media → Banners): up to three images chosen by viewport width,
 * the "image contains text" switch, live text and alt per locale, link, schedule and status.
 * Built from the admin's existing field components and theme switch markup.
 */
@Component({
	selector: 'app-banner-slot-form',
	templateUrl: './banner-slot-form.html',
	imports: [ReactiveFormsModule, TranslocoModule, FormFields, ImageUpload, Button],
})
export class BannerSlotForm implements OnInit {
	private readonly gateway = inject(ContentBlocksGateway);
	private readonly media = inject(MediaGateway);
	private readonly notifications = inject(NotificationService);

	readonly ownerType = input<'home' | 'global'>('home');
	readonly position = input<'hero' | 'newsletter_popup'>('hero');
	readonly slot = input.required<string>();
	readonly existing = input<ContentBlock | null>(null);
	readonly saved = output<void>();

	readonly locales = BANNER_LOCALES;
	readonly bands: Band[] = ['desktop', 'tablet', 'phone'];
	readonly previews = signal<Record<Band, IAttachment | null>>({ desktop: null, tablet: null, phone: null });
	readonly saving = signal(false);

	readonly form = new FormGroup({
		desktop: new FormControl<string | null>(null),
		tablet: new FormControl<string | null>(null),
		phone: new FormControl<string | null>(null),
		containsText: new FormControl(false, { nonNullable: true }),
		heading: localizedGroup(),
		subheading: localizedGroup(),
		ctaLabel: localizedGroup(),
		alt: localizedGroup(),
		linkHref: new FormControl('', { nonNullable: true }),
		linkExternal: new FormControl(false, { nonNullable: true }),
		status: new FormControl<'draft' | 'active' | 'archived'>('draft', { nonNullable: true }),
		startsAt: new FormControl('', { nonNullable: true }),
		endsAt: new FormControl('', { nonNullable: true }),
	});

	/** Wide slots shrink to a sliver on phones, so art with text needs its own phone image. */
	get phoneRequired(): boolean {
		return this.form.controls.containsText.value && WIDE_SLOTS.has(`${this.position()}:${this.slot()}`);
	}

	async ngOnInit(): Promise<void> {
		const block = this.existing();
		if (!block) return;
		this.form.patchValue({
			desktop: block.images.desktop,
			tablet: block.images.tablet,
			phone: block.images.phone,
			containsText: block.containsText,
			heading: block.heading,
			subheading: block.subheading,
			ctaLabel: block.ctaLabel,
			alt: block.alt,
			linkHref: block.link?.href ?? '',
			linkExternal: block.link?.external ?? false,
			status: block.status,
			startsAt: toLocal(block.startsAt),
			endsAt: toLocal(block.endsAt),
		});
		const previews = { ...this.previews() };
		for (const band of this.bands) {
			const id = block.images[band];
			if (id) previews[band] = await firstValueFrom(this.media.get(id)).catch(() => null);
		}
		this.previews.set(previews);
	}

	pick(band: Band, selection: IAttachment | IAttachment[] | null): void {
		const image = Array.isArray(selection) ? (selection[0] ?? null) : selection;
		this.form.controls[band].setValue(image ? String(image.id) : null);
		this.previews.update((current) => ({ ...current, [band]: image }));
	}

	async save(): Promise<void> {
		const value = this.form.getRawValue();
		if (!value.desktop) return this.notifications.showError('Choose a desktop image first.');
		if (this.phoneRequired && !value.phone)
			return this.notifications.showError('This slot needs a phone image when the art contains text.');
		const block: ContentBlockInput = {
			ownerType: this.ownerType(),
			ownerId: null,
			position: this.position(),
			slot: this.slot(),
			images: { desktop: value.desktop, tablet: value.tablet, phone: value.phone },
			containsText: value.containsText,
			localeImages: this.existing()?.localeImages ?? {},
			heading: value.containsText ? {} : clean(value.heading),
			subheading: value.containsText ? {} : clean(value.subheading),
			ctaLabel: value.containsText ? {} : clean(value.ctaLabel),
			link: value.linkHref.trim() ? { href: value.linkHref.trim(), external: value.linkExternal } : null,
			alt: clean(value.alt),
			status: value.status,
			startsAt: toIso(value.startsAt),
			endsAt: toIso(value.endsAt),
		};
		this.saving.set(true);
		try {
			await firstValueFrom(this.gateway.save(block));
			this.notifications.showSuccess('Banner saved.');
			this.saved.emit();
		} catch (error) {
			const body = (error as { error?: { message?: string | string[] } }).error;
			this.notifications.showError([body?.message ?? 'The banner could not be saved.'].flat().join(' '));
		} finally {
			this.saving.set(false);
		}
	}

	async remove(): Promise<void> {
		const block = this.existing();
		if (!block) return;
		await firstValueFrom(this.gateway.remove(block.key));
		this.notifications.showSuccess('Banner removed.');
		this.saved.emit();
	}
}
