import { Injectable, type TemplateRef, computed, inject, signal } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import { NgbModal, type NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { lastValueFrom } from 'rxjs';

import { heicToJpeg } from '@core/media-library/heic';
import {
	type MediaDuplicateAnswer,
	MediaLibraryGateway,
	type StorageCheckAnswer,
} from '@core/media-library/media-library.gateway';
import { MediaUploads } from '@core/media-library/media-uploads';
import { injectMediaProfilesQuery } from '@data-access/queries/media-profiles.queries';
import { NotificationService } from '@data-access/services/notification.service';

import {
	type FmPhotoNote,
	type FmUploadPlan,
	type FmUploadRow,
	PHOTO_MAX_BYTES,
	choosable,
	foldersFor,
	isRefusal,
	newPick,
	photoNotes,
	readPhotoSize,
	sha256Hex,
	suggestedPicks,
	versionsOf,
} from './fm-upload-plan';

import type { MediaFill, StorageOperation } from '@saha-textile/contracts';

/** The popups the flow opens; the page owns their templates. */
export interface FmUploadPopups {
	review: TemplateRef<unknown>;
	duplicate: TemplateRef<unknown>;
	onDemand: TemplateRef<unknown>;
	refused: TemplateRef<unknown>;
	/** B04: photos over 25 MB, listed before anything uploads. */
	overLimit: TemplateRef<unknown>;
	/** B05: photos with notes, confirmed before they upload. */
	notes: TemplateRef<unknown>;
	/** B12: a photo uploaded anyway beside one of the same name: keep both, or replace that one. */
	anyway?: TemplateRef<unknown>;
	/** B13: the photo to replace is used on the website: the pages, then “Replace everywhere”. */
	replaceInUse?: TemplateRef<unknown>;
}

/** A photo that takes the place of one already in the folder (B12), instead of uploading beside it. */
export interface FmReplaceRow {
	row: FmUploadRow;
	id: string;
	name: string;
}

/** The upload popup (B03): what was picked, where it goes, and what is left out. */
export interface FmReview {
	plan: FmUploadPlan;
	rows: FmUploadRow[];
	skipped: ReadonlySet<string>;
	targetId: string | null;
	place: string;
	checking: boolean;
	/** D10: the profile the picker that opened this upload asks for; it is ticked on every photo. */
	asked: string | null;
}

/** S6: one file that matches something already in Media (B10 same bytes, B11 same name). */
export interface FmDuplicateAsk {
	kind: 'identical' | 'name';
	row: FmUploadRow;
	existing: { name: string; location: string };
	keepBothName: string;
	/** Later files with the same kind of match, for “Same answer for the other N”. */
	others: number;
	sameForOthers: boolean;
}

/** B18/B19: the storage check's answer, with what the upload adds. */
export type FmStorageAsk = StorageCheckAnswer & {
	bytes: number;
	files: number;
	what?: string | null;
	operation?: StorageOperation;
};

/** The duplicate check takes this many files per call. */
const DUPLICATES_PER_CALL = 500;

/**
 * Upload on the Media page (step 1.5e), from the popup to the tray: the duplicate check (S6), the
 * storage check (B18, B19), the folders a folder upload brings, then the files go to the tray.
 * Photos wait for image profiles (owner, 15 Nov), so they are listed and left out.
 */
@Injectable()
export class FmUploadFlow {
	private readonly gateway = inject(MediaLibraryGateway);
	private readonly modals = inject(NgbModal);
	private readonly notifications = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly uploads = inject(MediaUploads);

	private readonly profilesQuery = injectMediaProfilesQuery();
	/** The profiles a photo can be given, as the upload popup lists them. */
	readonly profiles = computed(() => choosable((this.profilesQuery.data() ?? []).map((item) => item.profile)));
	readonly review = signal<FmReview | null>(null);
	readonly duplicate = signal<FmDuplicateAsk | null>(null);
	readonly storageAsk = signal<FmStorageAsk | null>(null);
	/** B12: the photo asked about and the name it would get if both are kept. */
	readonly anyway = signal<{ row: FmUploadRow; existing: string; keepBothName: string; place: string } | null>(null);
	readonly anywayChoice = signal<'keep' | 'replace'>('keep');
	/** B13: where the photo to replace is used. */
	readonly replaceInUse = signal<{ name: string; places: string[] } | null>(null);
	/** B18's box: a super admin also lets other admins use on-demand storage. */
	readonly alsoLetOthers = signal(false);

	/** Ticked rows that can go: files, and photos with a readable size, at least one version and no refusal. */
	readonly going = computed(() => {
		const review = this.review();
		return review ? review.rows.filter((row) => !review.skipped.has(row.key) && this.canGo(row)) : [];
	});
	readonly photos = computed(() => (this.review()?.rows ?? []).filter((row) => row.photo));
	/** Ticked photos over 25 MB (B04): listed and left out. */
	readonly overLimit = computed(() => {
		const review = this.review();
		return review
			? review.rows.filter((row) => row.photo && row.bytes > PHOTO_MAX_BYTES && !review.skipped.has(row.key))
			: [];
	});
	/** Photos going with yellow notes (B05). */
	readonly noted = computed(() =>
		this.going().filter((row) => row.photo && this.notesFor(row).some((note) => !isRefusal(note))),
	);
	/** B02's bar: the profile added to or removed from every ticked photo. */
	readonly bulkProfile = signal<string>('');
	/** Photos still being read for their size. */
	readonly reading = signal(0);
	/** Ticked files that are not photos: stored as they are. */
	readonly goingFiles = computed(() => this.going().filter((row) => !row.photo).length);
	/** Each photo's preview while the popup is open; let go when it closes. */
	private readonly thumbs = signal<ReadonlyMap<string, string>>(new Map());

	thumb(key: string): string | null {
		return this.thumbs().get(key) ?? null;
	}

	private dropThumbs(): void {
		for (const url of this.thumbs().values()) URL.revokeObjectURL(url);
		this.thumbs.set(new Map());
	}
	readonly waiting = computed(() => (this.review()?.rows ?? []).filter((row) => row.waits).length);
	/** Folders a folder upload makes: those holding something that goes. */
	readonly foldersToMake = computed(() => foldersFor(this.going()).length);
	readonly goingBytes = computed(() => this.going().reduce((sum, row) => sum + row.bytes, 0));

	open(
		plan: FmUploadPlan,
		targetId: string | null,
		place: string,
		popups: FmUploadPopups,
		asked: string | null = null,
	): void {
		if (!plan.rows.length) return;
		this.review.set({ plan, rows: plan.rows, skipped: new Set(), targetId, place, checking: false, asked });
		void this.readSizes();
		void this.show(popups.review, { size: 'xl', windowClass: 'theme-modal media-modal' }, 'fm_review_title').then(
			() => this.dropThumbs(),
		);
	}

	/** Each photo's size, read in the browser, then its suggested profile (B01). */
	private async readSizes(): Promise<void> {
		const photos = (this.review()?.rows ?? []).filter((row) => row.photo && !row.size);
		this.reading.set(photos.length);
		if (typeof URL.createObjectURL === 'function') {
			this.thumbs.set(new Map(photos.map((row) => [row.key, URL.createObjectURL(row.file)])));
		}
		for (const row of photos) {
			// A HEIC becomes a full-size JPEG first, one at a time (phones have little memory).
			const converted = row.heic ? await heicToJpeg(row.file).catch(() => null) : null;
			const file = converted ?? row.file;
			const size = row.heic && !converted ? null : await readPhotoSize(file);
			if (converted) {
				const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(converted) : null;
				if (url) this.thumbs.update((all) => new Map([...all, [row.key, url]]));
			}
			this.updateRow(row.key, (current) => ({
				...current,
				...(converted
					? {
							source: current.file,
							file: converted,
							name: converted.name,
							contentType: 'image/jpeg',
							bytes: converted.size,
						}
					: {}),
				size,
				sizeRead: true,
				picks: size ? this.firstPicks(size) : [],
			}));
			this.reading.update((left) => Math.max(0, left - 1));
		}
	}

	/** A picker's own profile (D10), else the one the photo's shape suggests (B01). */
	private firstPicks(size: { width: number; height: number }) {
		const asked = this.review()?.asked;
		const profile = asked ? this.profiles().find((entry) => entry.key === asked) : undefined;
		return profile ? [newPick(profile, size)] : suggestedPicks(this.profiles(), size);
	}

	private canGo(row: FmUploadRow): boolean {
		if (row.waits) return false;
		if (!row.photo) return true;
		if (row.bytes > PHOTO_MAX_BYTES || !row.size || !versionsOf(row).length) return false;
		return !this.notesFor(row).some(isRefusal);
	}

	notesFor(row: FmUploadRow): FmPhotoNote[] {
		return row.photo ? photoNotes(row, this.profiles()) : [];
	}

	isPicked(row: FmUploadRow, profileKey: string): boolean {
		return row.picks.some((pick) => pick.profileKey === profileKey);
	}

	hasFill(row: FmUploadRow, profileKey: string, fill: MediaFill): boolean {
		return row.picks.find((pick) => pick.profileKey === profileKey)?.fills.includes(fill) ?? false;
	}

	/** Ticks or unticks a profile for one photo (B02's menu). */
	togglePick(rowKey: string, profileKey: string): void {
		const profile = this.profiles().find((entry) => entry.key === profileKey);
		this.updateRow(rowKey, (row) => {
			if (!row.size || !profile) return row;
			const picks = this.isPicked(row, profileKey)
				? row.picks.filter((pick) => pick.profileKey !== profileKey)
				: [...row.picks, newPick(profile, row.size)];
			return { ...row, picks };
		});
	}

	/** B21: each fill ticked under a profile becomes its own version; the last one cannot be unticked. */
	toggleFill(rowKey: string, profileKey: string, fill: MediaFill): void {
		this.updateRow(rowKey, (row) => ({
			...row,
			picks: row.picks.map((pick) => {
				if (pick.profileKey !== profileKey) return pick;
				const fills = pick.fills.includes(fill)
					? pick.fills.filter((entry) => entry !== fill)
					: [...pick.fills, fill];
				return fills.length ? { ...pick, fills } : pick;
			}),
		}));
	}

	/** B02's bar: one profile added to, or taken off, every ticked photo. */
	bulk(action: 'add' | 'remove'): void {
		const key = this.bulkProfile();
		const review = this.review();
		if (!key || !review) return;
		for (const row of review.rows) {
			if (!row.photo || review.skipped.has(row.key)) continue;
			const picked = this.isPicked(row, key);
			if ((action === 'add' && !picked) || (action === 'remove' && picked)) this.togglePick(row.key, key);
		}
	}

	private updateRow(key: string, change: (row: FmUploadRow) => FmUploadRow): void {
		this.review.update((review) =>
			review ? { ...review, rows: review.rows.map((row) => (row.key === key ? change(row) : row)) } : review,
		);
	}

	toggleRow(key: string): void {
		this.review.update((review) => {
			if (!review) return review;
			const skipped = new Set(review.skipped);
			if (skipped.has(key)) skipped.delete(key);
			else skipped.add(key);
			return { ...review, skipped };
		});
	}

	/** The head checkbox: every row that can go, or none. */
	toggleAll(on: boolean): void {
		this.review.update((review) =>
			review
				? {
						...review,
						skipped: on
							? new Set()
							: new Set(review.rows.filter((row) => !row.waits).map((row) => row.key)),
					}
				: review,
		);
	}

	removeRow(key: string): void {
		this.review.update((review) =>
			review ? { ...review, rows: review.rows.filter((row) => row.key !== key) } : review,
		);
	}

	/** Upload: checks, asks, makes folders, and hands the files to the tray. */
	async start(closeReview: () => void, popups: FmUploadPopups): Promise<void> {
		const review = this.review();
		const going = this.going();
		if (!review || review.checking || !going.length) return;
		// B04: photos over 25 MB are named first; B05: photos with notes are confirmed.
		if (this.overLimit().length) {
			const go = await this.show<'yes'>(
				popups.overLimit,
				{ size: 'lg', windowClass: 'theme-modal text-center' },
				'fm_over_title',
			);
			if (!go) return;
		}
		if (this.noted().length) {
			const go = await this.show<'yes'>(
				popups.notes,
				{ windowClass: 'theme-modal text-center' },
				'fm_notes_title',
			);
			if (!go) return;
		}
		this.review.set({ ...review, checking: true });
		try {
			const hashes = new Map<string, string | null>();
			// The duplicate check uses the file as picked, so the same HEIC picked twice is still caught.
			for (const row of going) hashes.set(row.key, await sha256Hex(row.source ?? row.file));
			const answers = await this.duplicates(going, hashes, review.targetId);
			if (!answers) return;
			closeReview();
			const decided = await this.decide(going, answers, popups, review.place);
			if (!decided || (!decided.keep.length && !decided.replace.length)) return;
			const { keep, replace } = decided;
			const reservationId = await this.storageGo([...keep, ...replace.map((one) => one.row)], popups);
			if (reservationId === false) return;
			const folderIds = await this.makeFolders(keep, review.targetId);
			if (!folderIds) {
				if (reservationId) void lastValueFrom(this.gateway.releaseHold(reservationId)).catch(() => undefined);
				return;
			}
			// B12: these take the place of the photo of the same name; its versions are remade from them (S7).
			for (const one of replace) {
				const sha256 = hashes.get(one.row.key);
				void this.uploads.replacePhoto({
					fileId: one.id,
					name: one.name,
					file: one.row.file,
					request: {
						fileName: one.row.name,
						contentType: one.row.contentType,
						byteSize: one.row.bytes,
						width: one.row.size?.width ?? 1,
						height: one.row.size?.height ?? 1,
						...(sha256 ? { sha256 } : {}),
						...(reservationId ? { reservationId } : {}),
					},
				});
			}
			if (!keep.length) return;
			this.uploads.add(
				keep.map((row) => ({
					file: row.file,
					name: row.name,
					contentType: row.contentType,
					folderId: folderIds.get(row.folderPath.join('/')) ?? review.targetId,
					sha256: hashes.get(row.key) ?? null,
					...(row.photo && row.size
						? { photo: { width: row.size.width, height: row.size.height, versions: versionsOf(row) } }
						: {}),
				})),
				reservationId,
			);
		} finally {
			this.review.set(null);
		}
	}

	private async duplicates(
		rows: readonly FmUploadRow[],
		hashes: ReadonlyMap<string, string | null>,
		folderId: string | null,
	): Promise<MediaDuplicateAnswer['files'] | null> {
		const out: MediaDuplicateAnswer['files'] = [];
		try {
			for (let at = 0; at < rows.length; at += DUPLICATES_PER_CALL) {
				const chunk = rows.slice(at, at + DUPLICATES_PER_CALL);
				const answer = await lastValueFrom(
					this.gateway.duplicates({
						folderId,
						files: chunk.map((row) => {
							const sha256 = hashes.get(row.key);
							return { name: row.name, bytes: row.bytes, ...(sha256 ? { sha256 } : {}) };
						}),
					}),
				);
				out.push(...answer.files);
			}
			return out;
		} catch (error) {
			this.failed(error);
			return null;
		}
	}

	/**
	 * Asks about each match in turn (B10, B11). A file going into a folder the upload makes has no
	 * neighbours yet, so only the same-bytes question applies to it. Closing a question stops the
	 * whole upload: nothing is sent that the admin did not agree to.
	 */
	private async decide(
		rows: readonly FmUploadRow[],
		answers: MediaDuplicateAnswer['files'],
		popups: FmUploadPopups,
		place = '',
	): Promise<{ keep: FmUploadRow[]; replace: FmReplaceRow[] } | null> {
		const kindOf = (index: number): 'identical' | 'name' | null => {
			const answer = answers[index];
			const row = rows[index];
			if (!answer || !row) return null;
			if (answer.identical) return 'identical';
			return answer.sameName && !row.folderPath.length ? 'name' : null;
		};
		const remembered: Partial<Record<'identical' | 'name', 'upload' | 'existing'>> = {};
		const keep: FmUploadRow[] = [];
		const replace: FmReplaceRow[] = [];
		for (const [index, row] of rows.entries()) {
			const kind = kindOf(index);
			const answer = answers[index];
			if (!kind || !answer) {
				keep.push(row);
				continue;
			}
			let choice = remembered[kind];
			if (!choice) {
				const others = rows.slice(index + 1).filter((_, later) => kindOf(index + 1 + later) === kind).length;
				const existing =
					kind === 'identical' && answer.identical
						? { name: answer.identical.name, location: answer.identical.location }
						: { name: answer.sameName?.name ?? row.name, location: '' };
				this.duplicate.set({
					kind,
					row,
					existing,
					keepBothName: answer.keepBothName,
					others,
					sameForOthers: false,
				});
				const picked = await this.show<'upload' | 'existing'>(
					popups.duplicate,
					{ size: 'lg', windowClass: 'theme-modal text-center' },
					'fm_duplicate_title',
				);
				if (!picked) return null;
				choice = picked;
				if (this.duplicate()?.sameForOthers) remembered[kind] = picked;
			}
			if (choice !== 'upload') continue;
			// B12: a photo beside one of the same name may take its place instead (S6). Files keep both.
			const same = kind === 'name' ? answer.sameName : null;
			if (same && row.photo && row.size && popups.anyway) {
				const how = await this.askAnyway(row, same, answer.keepBothName, place, popups);
				if (!how) return null;
				if (how === 'replace') {
					replace.push({ row, id: same.id, name: same.name });
					continue;
				}
			}
			keep.push(row);
		}
		return { keep, replace };
	}

	/**
	 * B12, then B13 when the photo is used on the website: answers how the photo goes in (beside, or in place of the
	 * one already there), or null when the admin goes back (nothing uploads).
	 */
	private async askAnyway(
		row: FmUploadRow,
		same: { id: string; name: string },
		keepBothName: string,
		place: string,
		popups: FmUploadPopups,
	): Promise<'keep' | 'replace' | null> {
		if (!popups.anyway) return 'keep';
		this.anyway.set({ row, existing: same.name, keepBothName, place });
		this.anywayChoice.set('keep');
		const go = await this.show<'go'>(popups.anyway, { windowClass: 'theme-modal text-center' }, 'fm_anyway_title');
		if (!go) return null;
		if (this.anywayChoice() === 'keep') return 'keep';
		const usedOn = await lastValueFrom(this.gateway.details(same.id))
			.then((details) => details.usedOn)
			.catch(() => null);
		if (usedOn === null) {
			this.notifications.showError(this.transloco.translate('fm_action_failed'));
			return null;
		}
		if (usedOn.length && popups.replaceInUse) {
			this.replaceInUse.set({ name: same.name, places: usedOn });
			const yes = await this.show<'yes'>(
				popups.replaceInUse,
				{ size: 'lg', windowClass: 'theme-modal text-center' },
				'fm_replace_in_use_title',
			);
			if (!yes) return null;
		}
		return 'replace';
	}

	/** B18/B19: one check for the whole upload; its approval is held until the last file settles. */
	private storageGo(rows: readonly FmUploadRow[], popups: FmUploadPopups): Promise<string | null | false> {
		const bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
		return this.storageCheck('upload', bytes, rows.length, null, popups);
	}

	/**
	 * The shared storage check (R4-7) before anything that adds stored data: an upload, or new versions (C07). Answers
	 * the approval to pass on, null when none is needed, or false when the work must not start. `what` is the line
	 * the on-demand popup shows (C07: “Hero 21:9 · Crop for 612 photos.”); null uses the upload's own words.
	 */
	async storageCheck(
		operation: StorageOperation,
		bytes: number,
		files: number,
		what: string | null,
		popups: Pick<FmUploadPopups, 'onDemand' | 'refused'>,
	): Promise<string | null | false> {
		const ask = async (approve: boolean, alsoLetOthers?: boolean) => {
			try {
				return await lastValueFrom(
					this.gateway.checkStorage({
						operation,
						bytes,
						approve,
						...(alsoLetOthers === undefined ? {} : { alsoLetOthers }),
					}),
				);
			} catch (error) {
				this.failed(error);
				return null;
			}
		};
		const first = await ask(false);
		if (!first) return false;
		if (first.decision === 'go') return first.reservationId;
		this.storageAsk.set({ ...first, bytes, files, what, operation });
		if (first.decision === 'refused') {
			await this.show(popups.refused, { windowClass: 'theme-modal text-center' }, 'fm_refused_title');
			return false;
		}
		this.alsoLetOthers.set(false);
		const yes = await this.show<'yes'>(
			popups.onDemand,
			{ size: 'lg', windowClass: 'theme-modal text-center' },
			'fm_on_demand_title',
		);
		if (!yes) return false;
		const approved = await ask(true, first.canApprove ? this.alsoLetOthers() : undefined);
		if (!approved) return false;
		if (approved.decision === 'go') return approved.reservationId;
		this.storageAsk.set({ ...approved, bytes, files, what, operation });
		await this.show(popups.refused, { windowClass: 'theme-modal text-center' }, 'fm_refused_title');
		return false;
	}

	/** A folder upload keeps its folders: parents first; a taken name gets “(1)” on the server. */
	private async makeFolders(
		rows: readonly FmUploadRow[],
		targetId: string | null,
	): Promise<Map<string, string | null> | null> {
		const ids = new Map<string, string | null>([['', targetId]]);
		try {
			for (const path of foldersFor(rows)) {
				const parent = ids.get(path.slice(0, -1).join('/')) ?? targetId;
				const made = await lastValueFrom(
					this.gateway.createFolder({ name: path[path.length - 1] ?? '', parentId: parent }),
				);
				ids.set(path.join('/'), made.id);
			}
			return ids;
		} catch (error) {
			this.failed(error);
			return null;
		}
	}

	private failed(error: unknown): void {
		this.notifications.showError(readApiErrorMessage(error) ?? this.transloco.translate('fm_action_failed'));
	}

	/** Opens a popup and answers what it was closed with, or null when it was dismissed. */
	private show<T>(template: TemplateRef<unknown>, options: NgbModalOptions, labelledBy: string): Promise<T | null> {
		return this.modals.open(template, { centered: true, ariaLabelledBy: labelledBy, ...options }).result.then(
			(value: T) => value,
			() => null,
		);
	}
}
