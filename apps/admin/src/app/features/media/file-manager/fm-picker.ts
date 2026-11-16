import { NgTemplateOutlet } from '@angular/common';
import { Component, type ElementRef, computed, inject, signal, viewChild } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { languageList } from '@saha-textile/core-domain/languages';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { MediaLibraryGateway, type MediaFileRow } from '@core/media-library/media-library.gateway';
import { MediaUploads } from '@core/media-library/media-uploads';
import {
	MEDIA_LIBRARY_KEY,
	injectMediaBrowseQuery,
	injectMediaTreeQuery,
} from '@data-access/queries/media-library.queries';
import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';

import { fillKey } from '../../setting/image-profiles/profile-words';
import { FmDetails } from './fm-details';
import { FmSidebar, type FmNav } from './fm-sidebar';
import { fileExtension, fileKind } from './file-kinds';
import { FmNewFolder } from './fm-new-folder';
import { FmReprocess, type FmReprocessChoice } from './fm-reprocess';
import { FmUploadFlow } from './fm-upload-flow';
import { planUpload } from './fm-upload-plan';
import { FmUploadPopups } from './fm-upload-popups';

/** What an image field asks of the picker (R4-2, D01–D17). */
export interface FmPickRules {
	/** The popup's title, a translation key (“Choose product images”). */
	title: string;
	accept: 'image' | 'any';
	/** How many the field holds in all, and how many it has already. */
	max: number;
	already: number;
	/** The profile the place needs (D15); its name as the admin reads it. Null: any image. */
	profile: { key: string; name: string; icon: boolean } | null;
}

/** One choice: the photo and the version this place will use (a page stores both, R4-1). */
export interface FmPicked {
	assetId: string;
	versionId: string | null;
	name: string;
	thumbnailUrl: string | null;
}

type PickerNav = Extract<FmNav, 'folder' | 'recent' | 'favourites'>;

/** Camera RAW files are kept as files, never processed (decision 3), so they are never chosen as images (D11). */
const RAW = new Set(['dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf']);
export const isRawFile = (row: Pick<MediaFileRow, 'name'>): boolean => RAW.has(fileExtension(row.name).toLowerCase());

/**
 * The Media manager as a picker (D01–D17): the same sidebar, folders and tiles, narrowed to what the place can use.
 * Only photos with a ready version of the needed profile are listed (a database filter), each with its versions as
 * chips; a switch shows the rest greyed. Nothing still uploading or being made can be chosen. The popup closes with
 * the chosen photos and versions.
 */
@Component({
	selector: 'app-fm-picker',
	templateUrl: './fm-picker.html',
	imports: [FileSizePipe, FmSidebar, FmUploadPopups, NgTemplateOutlet, PluralPipe, TranslocoModule],
	// D10: uploads started here run their own review popups over the picker.
	providers: [FmUploadFlow],
})
export class FmPicker {
	readonly modal = inject(NgbActiveModal);
	private readonly transloco = inject(TranslocoService);
	private readonly modals = inject(NgbModal);
	private readonly gateway = inject(MediaLibraryGateway);
	private readonly uploads = inject(MediaUploads);
	private readonly queries = inject(QueryClient);
	readonly flow = inject(FmUploadFlow);
	readonly uploadPopups = viewChild(FmUploadPopups);
	readonly pickFilesInput = viewChild<ElementRef<HTMLInputElement>>('fmPickFiles');

	readonly rules = signal<FmPickRules>({
		title: 'fm_pick_title',
		accept: 'image',
		max: 1,
		already: 0,
		profile: null,
	});
	readonly nav = signal<PickerNav>('folder');
	readonly folderId = signal<string | null>(null);
	readonly search = signal('');
	/** D16: the photos without the needed version, greyed. */
	readonly showWithout = signal(false);
	/** Chosen, in the order chosen. */
	readonly chosen = signal<ReadonlyMap<string, FmPicked>>(new Map());
	/** A refusal the last click met (D03, D05, D07, D11), shown in the footer until the next good click. */
	readonly warning = signal<string | null>(null);
	/** D14: chosen photos without default alt text in some of the shop's languages (never a refusal). */
	readonly altGaps = signal<ReadonlyMap<string, { name: string; locales: readonly string[] }>>(new Map());

	private readonly base = computed(() => {
		const rules = this.rules();
		return {
			accept: rules.accept,
			...(rules.profile ? { profile: rules.profile.key } : {}),
			...(this.showWithout() ? { showWithout: true } : {}),
			sort: 'name' as const,
			direction: 'asc' as const,
			page: 1,
			pageSize: 120,
			who: 'mine' as const,
		};
	});
	readonly browse = injectMediaBrowseQuery(() => ({
		...this.base(),
		view: this.nav(),
		...(this.nav() === 'folder' && this.folderId() ? { folderId: this.folderId() as string } : {}),
		...(this.search() ? { search: this.search() } : {}),
	}));
	/** D13: lately uploaded photos the place can use, at the top of My files. */
	readonly recent = injectMediaBrowseQuery(
		() => ({ ...this.base(), view: 'recent', pageSize: 6 }),
		() => this.nav() === 'folder' && !this.folderId() && !this.search(),
	);
	readonly tree = injectMediaTreeQuery();

	readonly data = computed(() => this.browse.data());
	readonly recentRows = computed(() =>
		this.nav() === 'folder' && !this.folderId() && !this.search() ? (this.recent.data()?.files ?? []) : [],
	);
	readonly room = computed(() => Math.max(0, this.rules().max - this.rules().already));
	readonly left = computed(() => this.room() - this.chosen().size);
	readonly one = computed(() => this.rules().max === 1);
	readonly kind = fileKind;

	start(rules: FmPickRules): void {
		this.rules.set(rules);
	}

	openNav(view: FmNav): void {
		if (view !== 'folder' && view !== 'recent' && view !== 'favourites') return;
		this.nav.set(view);
		this.folderId.set(null);
		this.search.set('');
	}

	openFolder(id: string | null): void {
		this.nav.set('folder');
		this.folderId.set(id);
		this.search.set('');
	}

	/** Why a row can't be chosen here, as words; null when it can. */
	refusal(row: MediaFileRow): string | null {
		const rules = this.rules();
		if (rules.accept === 'image' && row.kind !== 'image') {
			return this.transloco.translate(isRawFile(row) ? 'fm_pick_raw' : 'fm_pick_not_image', { name: row.name });
		}
		if (row.state !== 'ready' || (row.replacing && row.replacing !== 'failed')) {
			return this.transloco.translate('fm_pick_not_ready', { name: row.name });
		}
		if (rules.profile && !row.fitting?.length) {
			return this.transloco.translate('fm_pick_no_version', { name: row.name, profile: rules.profile.name });
		}
		return null;
	}

	/** A photo's versions of the needed profile, named for the chips (D15, D17). */
	chips(row: MediaFileRow): { versionId: string; label: string }[] {
		const icon = this.rules().profile?.icon ?? false;
		return (row.fitting ?? []).map((version) => ({
			versionId: version.versionId,
			label: this.transloco.translate(fillKey(version.fill, icon)),
		}));
	}

	isChosen(row: MediaFileRow, versionId?: string): boolean {
		const picked = this.chosen().get(row.id);
		return !!picked && (versionId === undefined || picked.versionId === versionId);
	}

	/** A click on a tile takes its first version; a click on a chip takes that version (R4-2). */
	toggle(row: MediaFileRow, versionId?: string): void {
		const refused = this.refusal(row);
		if (refused) {
			this.warning.set(refused);
			return;
		}
		const version = versionId ?? row.fitting?.[0]?.versionId ?? null;
		const next = new Map(this.chosen());
		const picked = next.get(row.id);
		if (picked && (versionId === undefined || picked.versionId === version)) {
			next.delete(row.id);
		} else if (picked) {
			next.set(row.id, { ...picked, versionId: version });
		} else {
			if (this.one()) next.clear();
			else if (next.size >= this.room()) {
				this.warning.set(this.transloco.translate('fm_pick_limit', { count: this.room() }));
				return;
			}
			next.set(row.id, { assetId: row.id, versionId: version, name: row.name, thumbnailUrl: row.thumbnailUrl });
		}
		this.warning.set(null);
		this.chosen.set(next);
		this.altGaps.set(
			new Map(
				[
					...this.altGaps(),
					...(row.altMissing?.length ? [[row.id, { name: row.name, locales: row.altMissing }] as const] : []),
				].filter(([id]) => next.has(id)),
			),
		);
	}

	/** The footer's note (D01, D04, D05, D14, D15); `addText` names the photo D14's Add text opens. */
	readonly note = computed<{ text: string; warn: boolean; addText?: string }>(() => {
		const warning = this.warning();
		if (warning) return { text: warning, warn: true };
		const chosen = [...this.chosen().values()];
		if (!chosen.length) return { text: this.transloco.translate('fm_pick_nothing'), warn: false };
		if (!this.one() && this.left() === 0 && this.room() > 1) {
			return { text: this.transloco.translate('fm_pick_full', { count: this.room() }), warn: true };
		}
		const [gapId, gap] = [...this.altGaps()][0] ?? [];
		if (gapId && gap) {
			return {
				text: this.transloco.translate('fm_pick_alt_missing', {
					name: gap.name,
					languages: languageList(gap.locales, this.transloco.getActiveLang()),
				}),
				warn: false,
				addText: gapId,
			};
		}
		if (chosen.length === 1) {
			const only = chosen[0] as FmPicked;
			const profile = this.rules().profile;
			const version = only.versionId?.split('.')[1];
			const label =
				profile && version
					? `${profile.name} · ${this.transloco.translate(fillKey(version as never, profile.icon))}`
					: '';
			return {
				text: this.transloco.translate(label ? 'fm_pick_one_version' : 'fm_pick_one', {
					name: only.name,
					version: label,
				}),
				warn: false,
			};
		}
		return {
			text: this.transloco.translate('fm_pick_some', { count: chosen.length, max: this.room() }),
			warn: false,
		};
	});

	/**
	 * D16 “Make one”: the photo's Reprocess popup (C01), then its new version is made in the background and the tray
	 * follows it; the photo can be chosen here once the version is ready.
	 */
	async makeOne(row: MediaFileRow): Promise<void> {
		const existing = await lastValueFrom(this.gateway.details(row.id))
			.then((details) => details.versions)
			.catch(() => []);
		const popup = this.modals.open(FmReprocess, {
			size: 'xl',
			centered: true,
			scrollable: true,
			windowClass: 'theme-modal media-modal',
			ariaLabelledBy: 'fm_rp_title',
		});
		(popup.componentInstance as FmReprocess).start({
			photos: [
				{
					id: row.id,
					name: row.name,
					width: row.width,
					height: row.height,
					bytes: row.bytes,
					contentType: row.contentType,
					thumbnailUrl: row.thumbnailUrl,
				},
			],
			versions: existing,
		});
		const choice = (await popup.result.catch(() => null)) as FmReprocessChoice | null;
		if (!choice?.versions.length) return;
		try {
			await lastValueFrom(this.gateway.addVersions(row.id, { versions: choice.versions }));
			this.uploads.watchVersions(choice.label, [row.id]);
			this.warning.set(this.transloco.translate('fm_pick_making', { name: row.name }));
		} catch {
			this.warning.set(this.transloco.translate('fm_action_failed'));
		}
	}

	// --- D10: Upload and New folder inside the picker -------------------------------------------------------------

	/** Uploads and new folders go into the folder shown; from Recent or Favourites, into My files. */
	readonly targetId = computed(() => (this.nav() === 'folder' ? this.folderId() : null));
	/** “My files › Product photos › Banarasi”: where they go, as the popups name it. */
	readonly herePlace = computed(() => {
		const steps = this.nav() === 'folder' && this.folderId() ? (this.data()?.breadcrumb ?? []) : [];
		return [this.transloco.translate('fm_my_files'), ...steps.map((step) => step.name)].join(' › ');
	});

	sidebarUpload(choice: 'files' | 'folder' | 'new_folder'): void {
		if (choice === 'new_folder') {
			this.newFolder();
			return;
		}
		this.pickFilesInput()?.nativeElement.click();
	}

	/**
	 * The upload popups over the picker, with the place's profile ticked on every photo (D10). The new photos appear
	 * here once their version is ready and can then be chosen (D07).
	 */
	filesPicked(input: HTMLInputElement): void {
		const files = [...(input.files ?? [])];
		input.value = '';
		const popups = this.uploadPopups()?.popups();
		if (!files.length || !popups) return;
		this.flow.open(
			planUpload(files.map((file) => ({ file, path: [] as string[] }))),
			this.targetId(),
			this.herePlace(),
			popups,
			this.rules().profile?.key ?? null,
		);
	}

	newFolder(): void {
		const popup = this.modals.open(FmNewFolder, {
			centered: true,
			windowClass: 'theme-modal',
			ariaLabelledBy: 'fm_new_folder_title',
		});
		(popup.componentInstance as FmNewFolder).start({ parentId: this.targetId(), place: this.herePlace() });
		void popup.result.catch(() => undefined);
	}

	/**
	 * D14's Add text: the photo's Text tab (A42) over the picker. When it closes, the languages still empty are
	 * named again, and the lists are read again so every tile knows.
	 */
	async addText(assetId: string): Promise<void> {
		const popup = this.modals.open(FmDetails, {
			size: 'xl',
			centered: true,
			scrollable: true,
			windowClass: 'theme-modal media-modal',
			ariaLabelledBy: 'fm_details_title',
		});
		const details = popup.componentInstance as FmDetails;
		void details.start(assetId, 'text');
		await popup.result.catch(() => undefined);
		const alt = details.details()?.text?.alt ?? {};
		const gap = this.altGaps().get(assetId);
		if (gap) {
			const left = gap.locales.filter((locale) => !alt[locale]?.trim());
			const next = new Map(this.altGaps());
			if (left.length) next.set(assetId, { ...gap, locales: left });
			else next.delete(assetId);
			this.altGaps.set(next);
		}
		void this.queries.invalidateQueries({ queryKey: MEDIA_LIBRARY_KEY });
	}

	choose(): void {
		if (!this.chosen().size) return;
		this.modal.close([...this.chosen().values()]);
	}
}
