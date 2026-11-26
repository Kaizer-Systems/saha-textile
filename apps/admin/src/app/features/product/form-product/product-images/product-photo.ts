import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { lastValueFrom } from 'rxjs';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { MediaLibraryGateway, type MediaFileDetails } from '@core/media-library/media-library.gateway';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

import { fillKey, profileNameKey } from '../../../setting/image-profiles/profile-words';

/** What E05 opens with: the photo, its version and alt text on this product, and the photo's own default alt text. */
export interface ProductPhotoInput {
	assetId: string;
	thumbnailUrl: string | null;
	profileKey: string;
	versionId: string | null;
	alt: Readonly<Record<string, string>>;
	defaultAlt: Readonly<Record<string, string>>;
}

/** What Save hands back: the version this product shows, and its alt text per language (empty: the photo's default). */
export interface ProductPhotoResult {
	versionId: string | null;
	alt: Record<string, string>;
}

/**
 * E05 “Photo on this product” (R4-6): which of this photo's versions the product shows, and alt text written for this
 * product in each language, with the photo's default text shown as what an empty field uses.
 */
@Component({
	selector: 'app-product-photo',
	templateUrl: './product-photo.html',
	imports: [FormFields, LanguageSwitch, TranslocoModule],
})
export class ProductPhoto {
	readonly modal = inject(NgbActiveModal);
	private readonly gateway = inject(MediaLibraryGateway);
	private readonly transloco = inject(TranslocoService);
	readonly locales = inject(ActiveLanguages).list();

	readonly input = signal<ProductPhotoInput | null>(null);
	readonly details = signal<MediaFileDetails | null>(null);
	readonly locale = signal<string>(this.locales[0] ?? 'en');
	readonly versionId = signal<string | null>(null);
	readonly alt = signal<Record<string, string>>({});

	/** Only this photo's ready versions of the product's profile are offered. */
	readonly versions = computed(() => {
		const input = this.input();
		const details = this.details();
		if (!input || !details) return [];
		const name = this.transloco.translate(profileNameKey({ key: input.profileKey }));
		return details.versions
			.filter((version) => version.profileKey === input.profileKey && version.state === 'ready')
			.map((version) => ({
				id: version.id,
				label: `${name} · ${this.transloco.translate(fillKey(version.fill as never, false))}`,
			}));
	});
	/** “also used on Red Banarasi Silk”: the other places that show this photo. */
	readonly elsewhere = computed(() => this.details()?.usedOn.join(', ') ?? '');

	async start(input: ProductPhotoInput): Promise<void> {
		this.input.set(input);
		this.versionId.set(input.versionId);
		this.alt.set({ ...input.alt });
		const details = await lastValueFrom(this.gateway.details(input.assetId)).catch(() => null);
		this.details.set(details);
		if (!this.versionId()) this.versionId.set(this.versions()[0]?.id ?? null);
	}

	setAlt(text: string): void {
		this.alt.update((alt) => ({ ...alt, [this.locale()]: text }));
	}

	save(): void {
		const alt = Object.fromEntries(Object.entries(this.alt()).filter(([, text]) => text.trim()));
		this.modal.close({ versionId: this.versionId(), alt } satisfies ProductPhotoResult);
	}
}
