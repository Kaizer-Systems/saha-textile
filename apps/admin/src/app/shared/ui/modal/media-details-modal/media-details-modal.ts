import { HttpErrorResponse } from '@angular/common/http';
import { Component, TemplateRef, computed, inject, output, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { gapsByLocale, LocalizedFields, type LanguageGap } from '@core/i18n/localized-fields';
import { ActiveLanguages } from '@core/i18n/active-languages';
import { MediaGateway } from '@core/media/media.gateway';
import { MediaUploads } from '@core/media-library/media-uploads';
import { NotificationService } from '@data-access/services/notification.service';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

/** The API's rule for a file name: lowercase words joined by single hyphens, at most 80 characters. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Turns what was typed into a valid file name: "Red Banarasi Saree.jpg" → "red-banarasi-saree-jpg". */
export const fileNameOf = (text: string): string =>
	text
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
		.replace(/-+$/, '');

/**
 * Edit details for one Media Library image: one search-friendly file name for every language,
 * then alt text, title and caption in each language behind one Language switch. A new file name
 * renames every size of the image in the background, so the window says so before saving: like a Replace, the
 * files are made again under the new name, pages switch when they are in place, and the old files stay 7 days
 * (R5-6, media step 3d). The tray follows it.
 */
@Component({
	selector: 'app-media-details-modal',
	templateUrl: './media-details-modal.html',
	imports: [ReactiveFormsModule, TranslocoModule, Button, FormFields, LanguageSwitch],
})
export class MediaDetailsModal {
	private modalService = inject(NgbModal);
	private media = inject(MediaGateway);
	private notifier = inject(NotificationService);
	private transloco = inject(TranslocoService);
	private uploads = inject(MediaUploads);

	readonly template = viewChild<TemplateRef<unknown>>('detailsModal');
	/** After a save, so the library can refresh. */
	readonly saved = output<string>();

	readonly locales = inject(ActiveLanguages).list();
	readonly form = new FormGroup({
		slug: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(SLUG)] }),
		alt: new FormControl('', { nonNullable: true }),
		title: new FormControl('', { nonNullable: true }),
		caption: new FormControl('', { nonNullable: true }),
	});
	/** Alt text is needed in every language; a title or caption only once it is written in English. */
	readonly fields = new LocalizedFields(this.form, ['alt', 'title', 'caption'], ['title', 'caption']);
	readonly gaps = signal<Record<string, LanguageGap[]>>({});
	private readonly savedSlug = signal('');
	readonly slug = signal('');
	readonly renaming = computed(() => !!this.savedSlug() && this.slug() !== this.savedSlug());
	readonly saving = signal(false);
	private assetId: string | null = null;

	async openModal(assetId: string): Promise<void> {
		this.assetId = assetId;
		const details = await firstValueFrom(this.media.details(assetId));
		this.form.reset({ slug: details.slug });
		this.savedSlug.set(details.slug);
		this.slug.set(details.slug);
		this.fields.switchTo(this.locales[0] as string);
		this.fields.load(details.text);
		this.refreshGaps();
		this.modalService
			.open(this.template(), {
				ariaLabelledBy: 'media-details-title',
				centered: true,
				windowClass: 'theme-modal',
			})
			.result.catch(() => undefined);
	}

	setSlug(text: string): void {
		const slug = fileNameOf(text);
		this.form.controls.slug.setValue(slug);
		this.slug.set(slug);
	}

	switchLanguage(locale: string): void {
		this.fields.switchTo(locale);
		this.refreshGaps();
	}

	refreshGaps(): void {
		this.gaps.set(gapsByLocale(this.locales, (locale) => this.fields.gaps(locale)));
	}

	async save(modal: NgbModalRef): Promise<void> {
		const assetId = this.assetId;
		this.form.markAllAsTouched();
		if (!assetId || this.form.controls.slug.invalid) return;
		this.saving.set(true);
		const renamed = this.renaming();
		const slug = this.form.controls.slug.value;
		try {
			await firstValueFrom(
				this.media.saveDetails(assetId, {
					slug,
					alt: this.fields.text('alt'),
					title: this.fields.text('title'),
					caption: this.fields.text('caption'),
				}),
			);
			modal.close('saved');
			this.saved.emit(assetId);
			this.notifier.showSuccess(this.transloco.translate('media_details_saved'));
			if (renamed) void this.uploads.followRename(assetId, slug);
		} catch (error) {
			const code =
				error instanceof HttpErrorResponse
					? (error.error as { issues?: { code?: string }[] } | null)?.issues?.[0]?.code
					: undefined;
			this.notifier.showError(
				this.transloco.translate(code === 'rename_waits' ? 'file_name_rename_waits' : 'media_details_rejected'),
			);
		} finally {
			this.saving.set(false);
		}
	}
}
