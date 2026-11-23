import { DOCUMENT } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { languageName } from '@saha-textile/core-domain/languages';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { lastValueFrom } from 'rxjs';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { focusField, gapsByLocale, type LanguageGap, LocalizedFields } from '@core/i18n/localized-fields';
import { type AdminBuilderPage, PageBuilderGateway } from '@core/page-builder/page-builder.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload, type PickedAttachment, ImageUploadValue, onePicture } from '@shared/ui/image-upload/image-upload';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

/** The form's controls, by the API's field names (contract `PAGE_SETTINGS_FIELDS`). */
const LANGUAGE_FIELDS = ['title', 'description', 'heading'];
/** What a search result shows in full (contract `SEARCH_RESULT_LENGTHS`). */
export const SEARCH_RESULT = { title: 60, description: 160 } as const;

/** One field a save was refused for: a language the shop shows with it empty. */
export interface SettingsGap {
	locale: string;
	field: string;
}

/** The text a search result shows: whole, or cut with "…" at a word where possible. */
export function searchCut(text: string, length: number): { text: string; cut: boolean } {
	const clean = text.replace(/\s+/g, ' ').trim();
	if (clean.length <= length) return { text: clean, cut: false };
	const room = clean.slice(0, length - 1);
	const word = room.lastIndexOf(' ');
	return { text: `${(word > length * 0.6 ? room.slice(0, word) : room).trimEnd()}…`, cut: true };
}

/**
 * Page Builder › a page › Page settings (brief P3, SG-6, SG-7, Q17 A). The page's own search title, description,
 * main heading (shown or for search engines only) and share picture: the same whichever layout shows, so a seasonal
 * layout never changes how the page reads in search results. One Language switch changes the three word fields;
 * Save waits until every language the shop shows has them, as the legal pages do, and a refusal lists each missing
 * language and field. Below the form, how a search result would read (SG-7).
 */
@Component({
	selector: 'app-pb-page-settings',
	templateUrl: './pb-page-settings.html',
	imports: [
		Button,
		FormFields,
		ImageUpload,
		LanguageSwitch,
		PageWrapper,
		ReactiveFormsModule,
		RouterLink,
		TranslocoModule,
	],
})
export class PbPageSettings {
	private readonly gateway = inject(PageBuilderGateway);
	private readonly notifications = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly document = inject(DOCUMENT);
	readonly pageType = (inject(ActivatedRoute).snapshot.paramMap.get('type') ?? 'home').toLowerCase();
	readonly locales = inject(ActiveLanguages).list();
	readonly form = new FormGroup({
		title: new FormControl(''),
		description: new FormControl(''),
		heading: new FormControl(''),
		headingShown: new FormControl(false, { nonNullable: true }),
	});
	readonly fields = new LocalizedFields(this.form, LANGUAGE_FIELDS);
	readonly gaps = signal<Record<string, LanguageGap[]>>({});
	readonly refused = signal<SettingsGap[]>([]);
	readonly page = signal<AdminBuilderPage | null>(null);
	readonly saving = signal(false);
	/** The words the preview shows; follows the form as it is typed. */
	readonly typed = signal({ title: '', description: '' });
	private shareImage: { assetId: string; versionId: string | null } | null = null;

	/** SG-7: the search result as it would read in the language shown. */
	readonly preview = computed(() => {
		const typed = this.typed();
		return {
			address: `sahatextile.com › ${this.fields.locale()}`,
			title: searchCut(typed.title, SEARCH_RESULT.title),
			description: searchCut(typed.description, SEARCH_RESULT.description),
		};
	});

	constructor() {
		this.form.valueChanges.subscribe((value) =>
			this.typed.set({ title: value.title ?? '', description: value.description ?? '' }),
		);
		void this.load();
	}

	private async load(): Promise<void> {
		try {
			const page = await lastValueFrom(this.gateway.page(this.pageType));
			this.page.set(page);
			this.shareImage = page.settings.shareImage;
			this.fields.load({
				title: page.settings.title,
				description: page.settings.description,
				heading: page.settings.heading,
			});
			this.form.controls.headingShown.setValue(page.settings.headingShown);
			this.refreshGaps();
			this.syncPreview();
		} catch (error) {
			this.notifications.showError(readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed'));
		}
	}

	shareImageTile(): PickedAttachment | null {
		const url = this.page()?.shareImageUrl;
		return url && this.shareImage
			? ({
					id: this.shareImage.assetId,
					original_url: url,
					versionId: this.shareImage.versionId,
				} as unknown as PickedAttachment)
			: null;
	}

	selectShareImage(value: ImageUploadValue): void {
		const data = onePicture(value);
		this.shareImage = data ? { assetId: String(data.id), versionId: data.versionId ?? null } : null;
	}

	switchLanguage(locale: string): void {
		this.fields.switchTo(locale);
		this.refreshGaps();
		this.syncPreview();
	}

	/** The form is filled without events when a language shows, so the preview reads it then too. */
	private syncPreview(): void {
		const value = this.form.getRawValue();
		this.typed.set({ title: value.title ?? '', description: value.description ?? '' });
	}

	openLanguageGap({ key, locale }: { key: string; locale: string }): void {
		this.switchLanguage(locale);
		focusField(this.document, key);
	}

	/** A line of the red alert opens the language, and the field, where the words are missing. */
	openGap(gap: SettingsGap): void {
		this.switchLanguage(gap.locale);
		focusField(this.document, gap.field);
	}

	gapLabel(gap: SettingsGap): string {
		// Language names in their own script (owner, 15 Nov).
		return `${languageName(gap.locale)}: ${this.transloco.translate(`pb_settings_${gap.field}`)}`;
	}

	async submit(): Promise<void> {
		if (!this.page() || this.saving()) return;
		this.saving.set(true);
		this.refused.set([]);
		try {
			const saved = await lastValueFrom(
				this.gateway.saveSettings(this.pageType, {
					title: this.fields.text('title'),
					description: this.fields.text('description'),
					heading: this.fields.text('heading'),
					headingShown: this.form.controls.headingShown.value,
					shareImage: this.shareImage,
				}),
			);
			this.page.set(saved);
			this.notifications.showSuccess(this.transloco.translate('pb_settings_saved'));
		} catch (error) {
			const missing = refusedSettings(error);
			if (missing.length) this.refused.set(missing);
			else
				this.notifications.showError(
					readApiErrorMessage(error) ?? this.transloco.translate('pb_action_failed'),
				);
		} finally {
			this.saving.set(false);
		}
	}

	private refreshGaps(): void {
		this.gaps.set(gapsByLocale(this.locales, (locale) => this.fields.gaps(locale)));
	}
}

/** The fields a refused save names (`page_settings_incomplete`), or none for any other answer. */
export function refusedSettings(error: unknown): SettingsGap[] {
	const body = (error as { error?: { error?: { issues?: { code?: string; path?: unknown[] }[] } } })?.error;
	return (body?.error?.issues ?? [])
		.filter((issue) => issue.code === 'page_settings_incomplete')
		.map((issue) => ({ field: String(issue.path?.[0] ?? ''), locale: String(issue.path?.[1] ?? '') }));
}
