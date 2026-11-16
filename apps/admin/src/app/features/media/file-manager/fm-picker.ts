import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import type { MediaFileRow } from '@core/media-library/media-library.gateway';
import { injectMediaBrowseQuery, injectMediaTreeQuery } from '@data-access/queries/media-library.queries';
import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';

import { fillKey } from '../../setting/image-profiles/profile-words';
import { FmSidebar, type FmNav } from './fm-sidebar';
import { fileExtension, fileKind } from './file-kinds';

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
	imports: [FileSizePipe, FmSidebar, NgTemplateOutlet, PluralPipe, TranslocoModule],
})
export class FmPicker {
	readonly modal = inject(NgbActiveModal);
	private readonly transloco = inject(TranslocoService);

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
	}

	/** The footer's note (D01, D04, D05, D15). */
	readonly note = computed<{ text: string; warn: boolean }>(() => {
		const warning = this.warning();
		if (warning) return { text: warning, warn: true };
		const chosen = [...this.chosen().values()];
		if (!chosen.length) return { text: this.transloco.translate('fm_pick_nothing'), warn: false };
		if (!this.one() && this.left() === 0 && this.room() > 1) {
			return { text: this.transloco.translate('fm_pick_full', { count: this.room() }), warn: true };
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

	choose(): void {
		if (!this.chosen().size) return;
		this.modal.close([...this.chosen().values()]);
	}
}
