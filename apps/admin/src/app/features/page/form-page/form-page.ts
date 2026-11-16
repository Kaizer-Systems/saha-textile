import { DOCUMENT, DatePipe, isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { languageName } from '@saha-textile/core-domain/languages';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { Editor, NgxEditorModule } from 'ngx-editor';
import { lastValueFrom } from 'rxjs';

import { ActiveLanguages } from '@core/i18n/active-languages';
import { focusField, gapsByLocale, type LanguageGap, LocalizedFields } from '@core/i18n/localized-fields';
import { type AdminLegalPage, LegalPagesGateway } from '@core/legal-pages/legal-pages.gateway';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

const LANGUAGE_FIELDS = ['title', 'content', 'meta_title', 'meta_description'];
/** The search title and description may stay empty: the shop then uses the title and the opening words. */
const OPTIONAL_FIELDS = ['meta_title', 'meta_description'];
/** The API's field names for the controls a refused save names. */
const CONTROL_FOR: Readonly<Record<string, string>> = { title: 'title', content: 'content' };

/** One field a save was refused for: a language the shop shows with Title or Content empty (P6). */
export interface PageGap {
	locale: string;
	field: string;
}

/**
 * Admin › Pages › a legal page (Legal Pages brief, P3–P6). One Language switch changes Title, Content, Meta Title
 * and Meta Description; the address is fixed (choice A) and the share picture is shared by every language. A save
 * needs Title and Content in every language the shop shows; anything missing comes back as a red alert whose lines
 * open that language and field. The page is always on the shop, so there is no Status switch (owner, 16 Nov).
 */
@Component({
	selector: 'app-form-page',
	templateUrl: './form-page.html',
	styleUrls: ['./form-page.scss'],
	imports: [
		ReactiveFormsModule,
		FormFields,
		NgxEditorModule,
		ImageUpload,
		Button,
		LanguageSwitch,
		TranslocoModule,
		DatePipe,
	],
})
export class FormPage {
	private readonly gateway = inject(LegalPagesGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly notifications = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly page = inject(DOCUMENT);

	/** The earlier Add Page screen (create-page, on the end-of-project cleanup list) still passes `create`. */
	readonly type = input<string>('edit');
	readonly locales = inject(ActiveLanguages).list();
	readonly form = new FormGroup({
		title: new FormControl(''),
		content: new FormControl(''),
		meta_title: new FormControl(''),
		meta_description: new FormControl(''),
	});
	readonly fields = new LocalizedFields(this.form, LANGUAGE_FIELDS, OPTIONAL_FIELDS);
	readonly gaps = signal<Record<string, LanguageGap[]>>({});
	readonly refused = signal<PageGap[]>([]);
	readonly row = signal<AdminLegalPage | null>(null);
	readonly saving = signal(false);
	readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
	readonly editor: Editor | null = this.isBrowser ? new Editor() : null;
	private metaImageAssetId: string | null = null;

	constructor() {
		const slug = this.route.snapshot.params['id'] as string | undefined;
		if (slug) void this.load(slug);
	}

	private async load(slug: string): Promise<void> {
		try {
			const row = await lastValueFrom(this.gateway.get(slug));
			this.row.set(row);
			this.metaImageAssetId = row.page.metaImageAssetId;
			this.fields.load({
				title: row.page.title,
				content: row.page.content,
				meta_title: row.page.metaTitle,
				meta_description: row.page.metaDescription,
			});
			this.refreshGaps();
			const missing = this.route.snapshot.queryParams['missing'] as string | undefined;
			if (missing && this.locales.includes(missing)) this.switchLanguage(missing);
		} catch (error) {
			this.notifications.showError(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
		}
	}

	metaImage(): IAttachment | null {
		const row = this.row();
		return row?.metaImageUrl && this.metaImageAssetId
			? ({ id: this.metaImageAssetId, original_url: row.metaImageUrl } as IAttachment)
			: null;
	}

	selectMetaImage(data: IAttachment | null): void {
		this.metaImageAssetId = data ? String(data.id) : null;
	}

	switchLanguage(locale: string): void {
		this.fields.switchTo(locale);
		this.refreshGaps();
	}

	openLanguageGap({ key, locale }: { key: string; locale: string }): void {
		this.switchLanguage(locale);
		focusField(this.page, key);
	}

	/** A line of the red alert opens the language, and the field, where the text is missing (P6). */
	openGap(gap: PageGap): void {
		this.switchLanguage(gap.locale);
		focusField(this.page, CONTROL_FOR[gap.field] ?? 'title');
	}

	gapLabel(gap: PageGap): string {
		// Language names in their own script (owner, 15 Nov).
		const language = languageName(gap.locale);
		return `${language}: ${this.transloco.translate(gap.field === 'content' ? 'content' : 'title')}`;
	}

	async submit(): Promise<void> {
		const row = this.row();
		if (!row || this.saving()) return;
		this.saving.set(true);
		this.refused.set([]);
		try {
			const saved = await lastValueFrom(
				this.gateway.save(row.page.slug, {
					title: this.fields.text('title'),
					content: this.fields.text('content'),
					metaTitle: this.fields.text('meta_title'),
					metaDescription: this.fields.text('meta_description'),
					metaImageAssetId: this.metaImageAssetId,
				}),
			);
			this.row.set(saved);
			this.notifications.showSuccess(this.transloco.translate('page_saved'));
		} catch (error) {
			const missing = refusedFields(error);
			if (missing.length) this.refused.set(missing);
			else
				this.notifications.showError(
					readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'),
				);
		} finally {
			this.saving.set(false);
		}
	}

	private refreshGaps(): void {
		this.gaps.set(gapsByLocale(this.locales, (locale) => this.fields.gaps(locale)));
	}
}

/** The fields a refused save names (`legal_page_incomplete`), or none for any other answer. */
export function refusedFields(error: unknown): PageGap[] {
	// The API's error envelope: `{ error: { code, message, issues } }`; each issue's path is [field, locale].
	const body = (error as { error?: { error?: { issues?: { code?: string; path?: unknown[] }[] } } })?.error;
	return (body?.error?.issues ?? [])
		.filter((issue) => issue.code === 'legal_page_incomplete')
		.map((issue) => ({ field: String(issue.path?.[0] ?? ''), locale: String(issue.path?.[1] ?? '') }));
}
