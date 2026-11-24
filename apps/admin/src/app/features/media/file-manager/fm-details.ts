import { DatePipe } from '@angular/common';
import { Component, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { lastValueFrom } from 'rxjs';

import { ActiveLanguages } from '@core/i18n/active-languages';
import {
	MediaLibraryGateway,
	type MediaActivityPage,
	type MediaFileDetails,
	type MediaPhotoText,
} from '@core/media-library/media-library.gateway';
import { MediaUploads } from '@core/media-library/media-uploads';
import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { LanguageSwitch } from '@shared/ui/language-switch/language-switch';

import { fillKey, profileNameKey } from '../../setting/image-profiles/profile-words';

import type { MediaFill } from '@saha-textile/contracts';

export type FmDetailsTab = 'text' | 'versions' | 'activity';

/** A49: a save that takes longer than this shows the thin bar; a quicker one never flickers. */
export const TEXT_BAR_AFTER_MS = 300;

/** Trimmed, with empty languages left out; languages not shown in the form (a deleted one's text) are kept. */
function cleanText(text: Readonly<Record<string, string>>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(text)
			.map(([locale, value]) => [locale, value.trim()] as const)
			.filter(([, value]) => value.length > 0),
	);
}

/** The fills a version can have; the contracts package is types-only in the browser, so the list lives here. */
const FILLS: readonly string[] = ['as_is', 'white', 'blur', 'crop', 'colour', 'brand'];
const isFill = (value: string): value is MediaFill => FILLS.includes(value);

/** What the popup's buttons hand back to the Media page (A31): it closes and the page carries on. */
export type FmDetailsAction =
	| { kind: 'add_versions'; versions: { id: string; state: string }[] }
	| { kind: 'download' }
	| { kind: 'share' }
	| { kind: 'focal' };
type Version = MediaFileDetails['versions'][number];
type Family = MediaFileDetails['perPhoto'][number];

/** The words each size family is called by in the tree (the same as Settings › Image profiles). */
const familyKey = (role: string) => `profile_family_${role}`;

/**
 * Image or file details (media step 2e; Media brief A31, A31B, A32, A43): the file's facts on the left, and on the
 * right its versions as a tree (R6-6: version → size family → each file, every level opens and closes, only the
 * first version starts open, the tree scrolls in its own box) and its Activity. A photo's Text tab (A42, media step
 * 4c) holds its default alt text and caption per language, with the Language switch; the unused title is dropped
 * (R5-7). Built from existing pieces: the media popup, the theme's nav tabs and tree box, `fm-vnode`, `fm-activity`,
 * the form fields and the Language switch.
 */
/** A web file name: lowercase words joined by hyphens, as the earlier Image details popup checked it. */
const WEB_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@Component({
	selector: 'app-fm-details',
	templateUrl: './fm-details.html',
	imports: [TranslocoModule, FileSizePipe, FormFields, LanguageSwitch, PluralPipe, DatePipe],
})
export class FmDetails {
	readonly modal = inject(NgbActiveModal);
	private readonly modals = inject(NgbModal);
	private readonly gateway = inject(MediaLibraryGateway);
	private readonly transloco = inject(TranslocoService);
	/** Toasts straight from the theme's toastr: the shared notifier's success closes every popup, this one too. */
	private readonly toastr = inject(ToastrService);
	private readonly uploads = inject(MediaUploads);

	readonly details = signal<MediaFileDetails | null>(null);
	/** A photo on hundreds of products lists the first few places; the rest open in a scroll box on request. */
	readonly USES_SHOWN = 5;
	readonly showAllUses = signal(false);
	readonly activity = signal<MediaActivityPage['items']>([]);
	readonly tab = signal<FmDetailsTab>('versions');
	readonly error = signal(false);
	/** Which tree nodes are open: version ids, `version|role` for families. */
	readonly open = signal<ReadonlySet<string>>(new Set());

	readonly isImage = computed(() => this.details()?.kind === 'image');
	/** The version asked about in the Remove popup. */
	readonly removing = signal<Version | null>(null);
	readonly removeConfirm = viewChild<TemplateRef<unknown>>('fmRemoveVersion');
	/** Option B (owner, 16 Nov): the web file name's own popup, the Media page's Rename popup with its warning. */
	readonly webNamePopup = viewChild<TemplateRef<unknown>>('fmWebName');
	readonly webName = signal('');
	readonly webNameValid = computed(() => WEB_NAME.test(this.webName()));
	/** The picture on the left: a middle-sized file of the first ready version, else nothing. */
	readonly preview = computed(() => {
		const version = this.details()?.versions.find((row) => row.state === 'ready');
		const files = version?.families.flatMap((family) => family.files) ?? [];
		const middle = files.filter((file) => file.width >= 300).sort((a, b) => a.width - b.width)[0] ?? files[0];
		return middle?.url ?? null;
	});

	// --- Text (A42, A49): the photo's own default alt text and caption, per language ---------------------------

	readonly locales = inject(ActiveLanguages).list();
	readonly locale = signal<string>(this.locales[0] ?? 'en');
	readonly alt = signal<Record<string, string>>({});
	readonly caption = signal<Record<string, string>>({});
	readonly saving = signal(false);
	/** A49: the thin bar and “Saving…” only once a save has taken longer than 0.3 s. */
	readonly savingSlow = signal(false);
	/** Default alt text is what every page falls back to, so an empty one is a to-do; a caption is optional. */
	readonly textGaps = computed(() =>
		Object.fromEntries(
			this.locales.map((locale) => [
				locale,
				this.alt()[locale]?.trim() ? [] : [{ key: 'fm_text_alt', label: 'fm_text_alt' }],
			]),
		),
	);

	setText(field: 'alt' | 'caption', value: string): void {
		(field === 'alt' ? this.alt : this.caption).update((text) => ({ ...text, [this.locale()]: value }));
	}

	async saveText(): Promise<void> {
		const file = this.details();
		if (!file || this.saving()) return;
		const text: MediaPhotoText = { alt: cleanText(this.alt()), caption: cleanText(this.caption()) };
		this.saving.set(true);
		const slow = setTimeout(() => this.savingSlow.set(true), TEXT_BAR_AFTER_MS);
		try {
			await lastValueFrom(this.gateway.saveText(file.id, text));
			this.details.set({ ...file, text });
			this.toastr.success(this.transloco.translate('fm_text_saved'));
		} catch (error) {
			this.toastr.error(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
		} finally {
			clearTimeout(slow);
			this.saving.set(false);
			this.savingSlow.set(false);
		}
	}

	/** Set right after the popup opens; `tab` opens a photo on its Text tab (D14's Add text). */
	/** Change: the new name in its own popup; Save makes every size again under it (step 3d's Replace, 'rename'). */
	async changeWebName(): Promise<void> {
		const file = this.details();
		const template = this.webNamePopup();
		if (!file?.slug || !template) return;
		this.webName.set(file.slug);
		const slug = await this.modals
			.open(template, { centered: true, windowClass: 'theme-modal', ariaLabelledBy: 'fm_web_name_title' })
			.result.then(
				(answer: string) => answer,
				() => null,
			);
		if (!slug || slug === file.slug) return;
		try {
			await lastValueFrom(this.gateway.saveWebName(file.id, slug));
			this.toastr.success(this.transloco.translate('fm_web_name_saved'));
			void this.uploads.followRename(file.id, file.name);
			await this.start(file.id, this.tab());
		} catch (error) {
			this.toastr.error(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
		}
	}

	async start(fileId: string, tab?: FmDetailsTab): Promise<void> {
		try {
			const details = await lastValueFrom(this.gateway.details(fileId));
			this.showAllUses.set(false);
			this.details.set(details);
			this.alt.set({ ...(details.text?.alt ?? {}) });
			this.caption.set({ ...(details.text?.caption ?? {}) });
			if (tab && details.kind === 'image') this.tab.set(tab);
			// The version the website shows opens first (R6-6); else the first one.
			const first = details.versions.find((row) => row.shown) ?? details.versions[0];
			if (first) this.open.set(new Set([first.id]));
			if (details.kind !== 'image') this.tab.set('activity');
			const trail = await lastValueFrom(this.gateway.itemActivity(fileId));
			this.activity.set(trail.items);
		} catch {
			this.error.set(true);
		}
	}

	/** A31's badge: shown on the website while the photo is used somewhere (it can't be removed then). */
	inUse(version: Version): boolean {
		return !!version.shown && (this.details()?.usedOn.length ?? 0) > 0;
	}

	/** Remove is offered for a version that isn't in use, isn't being made, and isn't the photo's last one. */
	canRemove(version: Version): boolean {
		return !this.inUse(version) && version.state !== 'making' && (this.details()?.versions.length ?? 0) > 1;
	}

	/** Add versions, Download original, Share: the popup closes and the Media page opens the next step. */
	act(kind: FmDetailsAction['kind']): void {
		const versions = (this.details()?.versions ?? []).map((row) => ({ id: row.id, state: row.state }));
		this.modal.close(kind === 'add_versions' ? { kind, versions } : { kind });
	}

	/** Remove an unused version (A31), after a confirmation; its files are deleted. */
	async remove(version: Version): Promise<void> {
		const file = this.details();
		const template = this.removeConfirm();
		if (!file || !template) return;
		this.removing.set(version);
		const yes = await this.modals
			.open(template, { centered: true, windowClass: 'theme-modal text-center', ariaLabelledBy: 'fm_rv_title' })
			.result.then(
				() => true,
				() => false,
			);
		if (!yes) return;
		try {
			await lastValueFrom(this.gateway.removeVersion(file.id, version.id));
			this.toastr.success(this.transloco.translate('fm_version_removed', { name: this.versionName(version) }));
			this.details.set(await lastValueFrom(this.gateway.details(file.id)));
		} catch (error) {
			this.toastr.error(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
		}
	}

	toggle(key: string): void {
		this.open.update((set) => {
			const next = new Set(set);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}

	/** "Product 3:4 · White padding": the profile's name (its key for an unnamed one) and the fill's. */
	versionName(version: Version): string {
		const nameKey = profileNameKey({ key: version.profileKey });
		const name = this.transloco.translate(nameKey);
		const profile = name === nameKey ? version.profileKey : name;
		const fillName = isFill(version.fill)
			? this.transloco.translate(fillKey(version.fill, version.profileKey === 'browser_icon_1x1'))
			: version.fill;
		return `${profile} · ${fillName}`;
	}

	familyName(family: Family): string {
		const key = familyKey(family.role);
		const name = this.transloco.translate(key);
		return name === key ? family.role : name;
	}

	widths(family: Family): string {
		return family.files.map((file) => file.width).join(', ');
	}

	sizeCount(version: Version): number {
		return version.families.reduce((sum, family) => sum + family.files.length, 0);
	}

	fileLabel(url: string): string {
		// Never-run fallback removed: split() always gives at least one part, so pop() finds it.
		return url.split('/').pop() as string;
	}

	async copy(url: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(url);
			this.toastr.success(this.transloco.translate('fm_address_copied'));
		} catch {
			this.toastr.error(this.transloco.translate('fm_action_failed'));
		}
	}

	/** One line of the item's Activity, in the admin's words where the action is known. */
	activityText(row: { action: string }): string {
		const key = `fm_activity_${row.action.replace(/^media(\.asset)?\./, '').replace(/\./g, '_')}`;
		const text = this.transloco.translate(key);
		return text === key ? row.action : text;
	}
}
