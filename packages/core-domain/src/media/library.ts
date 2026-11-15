import type {
	MediaAsset,
	MediaCategory,
	MediaFolder,
	ShareExpiry,
	ShareLink,
	StorageColour,
} from '@saha-textile/contracts';

export { CAMERA_RAW, waitsForImageProfiles } from '../catalog/media-files';

/**
 * The Media page as a file manager (media build step 1, brief revision 6): names, folders, Trash,
 * categories, share links and the storage check. Rules only; the API and the adapters apply them.
 */

const DAY_MS = 86_400_000;

/** Items stay in Trash this long, then they are removed for good (A18). */
export const TRASH_DAYS = 30;

// --- Names --------------------------------------------------------------------------------------

export type NameRefusal = 'empty' | 'too_long' | 'bad_character' | 'reserved';

/**
 * A folder or file name as people type it, cleaned: spaces trimmed and single, no slashes or
 * control characters (they would read as a path), never "." or "..". Bengali, emoji and long names
 * are fine up to 120 characters (break-it list).
 */
export function cleanMediaName(raw: string): { ok: true; name: string } | { ok: false; reason: NameRefusal } {
	const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
	if (!name) return { ok: false, reason: 'empty' };
	if ([...name].length > 120) return { ok: false, reason: 'too_long' };
	// eslint-disable-next-line no-control-regex
	if (/[\\/\u0000-\u001f\u007f]/.test(name)) return { ok: false, reason: 'bad_character' };
	if (name === '.' || name === '..') return { ok: false, reason: 'reserved' };
	return { ok: true, name };
}

/** "red.jpg" → { stem: "red", extension: ".jpg" }; a leading dot is part of the stem. */
export function splitExtension(name: string): { stem: string; extension: string } {
	const dot = name.lastIndexOf('.');
	if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: '' };
	return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

/**
 * The first free name in a folder: the name itself, then "name (1).ext", "name (2).ext" … (S6, B14).
 * Compares without letter case, as people read names.
 */
export function freeName(name: string, taken: Iterable<string>): string {
	const used = new Set([...taken].map((entry) => entry.toLocaleLowerCase()));
	if (!used.has(name.toLocaleLowerCase())) return name;
	const { stem, extension } = splitExtension(name);
	const base = stem.replace(/ \(\d+\)$/, '');
	for (let n = 1; ; n += 1) {
		const candidate = `${base} (${n})${extension}`;
		if (!used.has(candidate.toLocaleLowerCase())) return candidate;
	}
}

/** Renaming keeps the extension: only the part before it may change (A24). */
export function renameKeepingExtension(current: string, typed: string): string {
	const { extension } = splitExtension(current);
	if (!extension) return typed;
	return typed.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase())
		? typed.slice(0, typed.length - extension.length) + extension
		: `${typed}${extension}`;
}

/**
 * The name a downloaded file is saved under: its Media name, with the stored file's extension when
 * the name has none (older photos are named without one), so the computer knows how to open it.
 */
export function downloadName(name: string, storageKey: string): string {
	if (splitExtension(name).extension) return name;
	const { extension } = splitExtension(storageKey.slice(storageKey.lastIndexOf('/') + 1));
	return `${name}${extension.toLowerCase()}`;
}

// --- Folders ------------------------------------------------------------------------------------

export type MoveRefusal = 'into_itself' | 'target_in_trash' | 'unknown_target';

/** A folder may not go into itself or anything inside it (break-it list). */
export function folderMoveRefusal(
	folder: Pick<MediaFolder, 'id'>,
	target: Pick<MediaFolder, 'id' | 'ancestors' | 'trashedAt'> | null,
): MoveRefusal | null {
	if (!target) return null;
	if (target.trashedAt) return 'target_in_trash';
	if (target.id === folder.id || target.ancestors.includes(folder.id)) return 'into_itself';
	return null;
}

/** The ancestors a folder has once it sits under `parent`. */
export function ancestorsUnder(parent: Pick<MediaFolder, 'id' | 'ancestors'> | null): string[] {
	return parent ? [...parent.ancestors, parent.id] : [];
}

// --- Trash --------------------------------------------------------------------------------------

/** Days left before an item in Trash is removed for good. */
export function trashDaysLeft(trashedAt: string, now: Date): number {
	const left = TRASH_DAYS - Math.floor((now.getTime() - new Date(trashedAt).getTime()) / DAY_MS);
	return Math.max(0, left);
}

/** Trashed long enough ago to be removed for good by the nightly purge. */
export function trashPurgeDue(trashedAt: string | null, now: Date): boolean {
	return !!trashedAt && now.getTime() - new Date(trashedAt).getTime() >= TRASH_DAYS * DAY_MS;
}

/**
 * Where a restored item goes (A19): its old folder when that folder is still there and not in
 * Trash; when the folder is in Trash too, either that folder comes back as well or the item goes
 * to My files; when the folder is gone for good, My files.
 */
export function restoreTarget(
	trashedFrom: string | null,
	folder: Pick<MediaFolder, 'id' | 'trashedAt'> | null,
	whenFolderGone: 'restore_folder' | 'my_files',
): { folderId: string | null; restoreFolder: boolean } {
	if (!trashedFrom || !folder) return { folderId: null, restoreFolder: false };
	if (!folder.trashedAt) return { folderId: folder.id, restoreFolder: false };
	return whenFolderGone === 'restore_folder'
		? { folderId: folder.id, restoreFolder: true }
		: { folderId: null, restoreFolder: false };
}

// --- Categories ---------------------------------------------------------------------------------

const ARCHIVES = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i;
const BACKUPS = /\.(bak|dump|archive|bson|sql)$|(^|[-_.])backup([-_.]|$)/i;
const DOCUMENTS = /^(application\/(pdf|msword|rtf|vnd\.(ms-|openxmlformats|oasis))|text\/)/;

/** The category a file is listed under (A13–A16), from its type and name. */
export function mediaCategory(contentType: string, name: string): MediaCategory {
	if (BACKUPS.test(name)) return 'backups';
	if (contentType.startsWith('image/')) return 'images';
	if (contentType.startsWith('video/')) return 'videos';
	if (ARCHIVES.test(name) || /zip|x-7z|x-rar|x-tar|gzip/.test(contentType)) return 'archives';
	if (DOCUMENTS.test(contentType)) return 'documents';
	return 'other';
}

// --- Share links (R4-5, decision 13) --------------------------------------------------------------

const EXPIRY_MS: Readonly<Record<Exclude<ShareExpiry, 'date' | 'never'>, number>> = {
	'1h': 3_600_000,
	'1d': DAY_MS,
	'7d': 7 * DAY_MS,
	'30d': 30 * DAY_MS,
};

/** When a link made now stops: a set length, a chosen date (in the future), or never. */
export function shareExpiresAt(
	expiry: ShareExpiry,
	now: Date,
	date?: string,
): { ok: true; expiresAt: string | null } | { ok: false; reason: 'date_in_past' } {
	if (expiry === 'never') return { ok: true, expiresAt: null };
	if (expiry === 'date') {
		const at = new Date(date ?? '');
		if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return { ok: false, reason: 'date_in_past' };
		return { ok: true, expiresAt: at.toISOString() };
	}
	return { ok: true, expiresAt: new Date(now.getTime() + EXPIRY_MS[expiry]).toISOString() };
}

/** Whether a link opens now. A stopped link stays stopped, even after its file is restored. */
export function shareLinkState(
	link: Pick<ShareLink, 'stoppedAt' | 'expiresAt'>,
	now: Date,
): 'active' | 'expired' | 'stopped' {
	if (link.stoppedAt) return 'stopped';
	if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) return 'expired';
	return 'active';
}

/** How long the hand-over address from Spaces lasts once a link checks out (five minutes). */
export const SHARE_HANDOVER_SECONDS = 300;

/** Page sizes, in the order the share popup prefers them; link previews, emails and zoom are not pages. */
const PAGE_ROLES = ['gallery', 'banner', 'blog', 'store_photo', 'category_icon', 'brand_logo', 'card', 'thumb'];

/**
 * The picture the website already shows for a public photo (A35D: “Product page · 1600 px”): the
 * widest size of the first page role it has. Null for a private file or one with no sizes yet.
 */
export function websitePicture(
	asset: Pick<MediaAsset, 'visibility' | 'derivatives'>,
): { role: string; width: number; storageKey: string } | null {
	if (asset.visibility !== 'public') return null;
	for (const role of PAGE_ROLES) {
		const sizes = asset.derivatives.filter((row) => row.role === role);
		if (!sizes.length) continue;
		const widest = sizes.reduce((a, b) => (b.width > a.width ? b : a));
		return { role, width: widest.width, storageKey: widest.storageKey };
	}
	return null;
}

export type ShareCreateRefusal = 'public_file' | 'password_for_admins' | 'file_in_trash';

/**
 * Whether a link may be made. A public file already has a permanent address, so expiring links
 * are for private files (a photo's private original included). A link for admins only needs their
 * sign-in, not a password: the shop page checks it with the admin's session and never sends a
 * password with it.
 */
export function shareCreateRefusal(input: {
	kind: 'image' | 'video' | 'file';
	visibility: 'public' | 'private';
	trashed: boolean;
	who: 'anyone' | 'admins';
	hasPassword: boolean;
}): ShareCreateRefusal | null {
	if (input.trashed) return 'file_in_trash';
	if (input.kind === 'file' && input.visibility === 'public') return 'public_file';
	if (input.who === 'admins' && input.hasPassword) return 'password_for_admins';
	return null;
}

export type ShareOpenState = 'open' | 'password' | 'admins_only' | 'expired';

/**
 * What opening a link does now. A missing, stopped or expired link, or one whose file is gone or
 * in Trash, all read as expired, so a guessed code learns nothing. Admins-only links need a
 * signed-in admin; a password link needs the right password.
 */
export function shareOpenState(input: {
	link: Pick<ShareLink, 'stoppedAt' | 'expiresAt' | 'who' | 'passwordHash'> | null;
	fileAvailable: boolean;
	now: Date;
	signedInAdmin: boolean;
	passwordOk: boolean | null;
}): ShareOpenState {
	const { link } = input;
	if (!link || !input.fileAvailable || shareLinkState(link, input.now) !== 'active') return 'expired';
	if (link.who === 'admins') return input.signedInAdmin ? 'open' : 'admins_only';
	if (link.passwordHash && input.passwordOk !== true) return 'password';
	return 'open';
}

// --- Storage (R4-7) ------------------------------------------------------------------------------

/**
 * A super admin holds the seeded system Administrator role (its key). Only they approve going past
 * the plan, and only they let other admins do so (decision 14, B18).
 */
export const SUPER_ADMIN_ROLE_KEY = 'administrator';

/** A storage hold lasts this long unless the work releases it first, so a crashed upload frees it. */
export const STORAGE_HOLD_SECONDS = 3600;

/** DigitalOcean counts in GiB, so the box does too and matches the bill. */
export const GIB = 1024 ** 3;
export const STORAGE_PLAN_BYTES = 250 * GIB;
/** On-demand storage past the plan, US dollars per GiB a month. */
export const ON_DEMAND_USD_PER_GIB = 0.02;

/** The storage bar's colour: green under 60%, yellow from 60%, red from 85% (A46). */
export function storageColour(percent: number): StorageColour {
	if (percent >= 85) return 'red';
	if (percent >= 60) return 'yellow';
	return 'green';
}

export function onDemand(bytes: number, planBytes = STORAGE_PLAN_BYTES): { bytes: number; monthlyUsd: number } {
	const extra = Math.max(0, bytes - planBytes);
	return { bytes: extra, monthlyUsd: Math.round((extra / GIB) * ON_DEMAND_USD_PER_GIB * 100) / 100 };
}

export interface StorageCheckInput {
	usedBytes: number;
	/** What other admins' running operations will add. */
	reservedBytes: number;
	addBytes: number;
	planBytes?: number;
	superAdmin: boolean;
	/** A super admin let other admins use on-demand storage (B18, A47). */
	othersMayUseOnDemand: boolean;
	/** The person said yes to going past the plan for this operation. */
	approved: boolean;
}

/**
 * The one check before every operation that adds stored data (R4-7): within the plan it goes;
 * past it, a super admin (or another admin, once super admins allow it) is asked once per
 * operation; otherwise it is refused (B19).
 */
export function decideStorage(input: StorageCheckInput): 'go' | 'ask' | 'refused' {
	const plan = input.planBytes ?? STORAGE_PLAN_BYTES;
	const after = input.usedBytes + input.reservedBytes + input.addBytes;
	if (after <= plan) return 'go';
	const mayApprove = input.superAdmin || input.othersMayUseOnDemand;
	if (!mayApprove) return 'refused';
	return input.approved ? 'go' : 'ask';
}
