import {
	CAMERA_RAW,
	type PhotoShape,
	fitsShape,
	isProcessedPhoto,
	looksLikeHeic,
	minSizeCheck,
	photoFills,
	suggestProfile,
	waitsForImageProfiles,
} from '@saha-textile/core-domain/media-files';
import {
	HEADER_MEASURED_KINDS,
	PHOTO_FILE_ENDINGS,
	PHOTO_KIND_TYPES,
	SNIFF_BYTES,
	type ByteReader,
	type PhotoKind,
	measureFromHeader,
	photoKindOf,
	sniffPhotoKind,
} from '@saha-textile/core-domain/photo-header';

import type { MediaFill, MediaProfile } from '@saha-textile/contracts';

/** A photo over this is listed and left out (B04); other files have no limit from us. */
export const PHOTO_MAX_BYTES = 25 * 1024 * 1024;

/** One profile picked for a photo, with the fills ticked when its shape differs (“As is” when it fits). */
export interface FmPick {
	profileKey: string;
	fills: MediaFill[];
}

/** One picked or dropped file, with the folders it sat in under what was picked (empty for loose files). */
export interface FmPicked {
	file: File;
	path: readonly string[];
}

/** One line of the upload popup (B03). */
export interface FmUploadRow {
	key: string;
	file: File;
	name: string;
	bytes: number;
	contentType: string;
	/** What kind of photo it is, from its type or name, then from its first bytes (media step 5); null for files. */
	kind: PhotoKind | null;
	/** Folders under the place the upload goes, as picked: kept on upload. */
	folderPath: readonly string[];
	/** A picture type the image worker does not read yet: listed as waiting, not sent. */
	waits: boolean;
	/** A photo the worker reads: it uploads with the versions picked for it (media step 2). */
	photo: boolean;
	/** The photo's size as the browser decoded it, once read. */
	size: PhotoShape | null;
	/** The browser has tried to read the photo (a size of null after that: it cannot be read). */
	sizeRead: boolean;
	/** Profiles picked for the photo, suggested from its shape (B01). */
	picks: FmPick[];
	/** A HEIC photo: turned into a full-size JPEG in the browser before it uploads (B02). */
	heic: boolean;
	/** The file as picked, kept for the duplicate check when what uploads is a converted copy. */
	source: File | null;
}

export interface FmUploadPlan {
	rows: FmUploadRow[];
	/** The picked folder's own name, when a whole folder was picked or dropped alone. */
	folderName: string | null;
}

/** What computers leave in folders that nobody means to upload. */
const LEFT_BY_THE_COMPUTER = /^(\.ds_store|thumbs\.db|desktop\.ini|\._.*|\.localized|icon\r)$/i;

/** What a browser calls a file with no known type; the API needs one. */
export const UNKNOWN_TYPE = 'application/octet-stream';

/**
 * Turns what was picked or dropped into the upload popup's rows: files the computer leaves behind
 * are left out, every row keeps its folder path, and the folders to make are listed parents first.
 */
export function planUpload(picked: readonly FmPicked[]): FmUploadPlan {
	const rows: FmUploadRow[] = [];
	for (const [index, { file, path }] of picked.entries()) {
		if (LEFT_BY_THE_COMPUTER.test(file.name) || path.some((part) => part.startsWith('.'))) continue;
		const typed = /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : UNKNOWN_TYPE;
		// Camera RAW files are stored as files, whatever their bytes look like (decision 3).
		const kind = CAMERA_RAW.test(file.name) ? null : photoKindOf(typed, file.name);
		const base: FmUploadRow = {
			key: `${index}:${[...path, file.name].join('/')}`,
			file,
			name: file.name,
			bytes: file.size,
			contentType: typed,
			kind: null,
			folderPath: path,
			photo: false,
			waits: waitsForImageProfiles(typed, file.name),
			size: null,
			sizeRead: false,
			picks: [],
			heic: false,
			source: null,
		};
		rows.push(kind ? asPhotoKind(base, kind) : base);
	}
	const tops = new Set(rows.map((row) => row.folderPath[0] ?? ''));
	// Never-run fallback removed: a set of one always has a first item.
	const folderName = tops.size === 1 && !tops.has('') ? ([...tops][0] as string) : null;
	return { rows, folderName };
}

/** The folders that hold the given rows, parents before children: what a folder upload makes. */
export function foldersFor(rows: readonly Pick<FmUploadRow, 'folderPath'>[]): string[][] {
	const paths = new Map<string, string[]>();
	for (const row of rows)
		for (let depth = 1; depth <= row.folderPath.length; depth += 1) {
			const parts = row.folderPath.slice(0, depth);
			paths.set(parts.join('/'), parts);
		}
	return [...paths.values()].sort((a, b) => a.length - b.length);
}

/** Files at most this big are read whole to count their SHA-256 for the duplicate check (S6). */
export const HASH_LIMIT_BYTES = 256 * 1024 * 1024;

/**
 * The SHA-256 of a file in hex, or null when it is too big to read whole in a browser tab, or the
 * page is not on HTTPS (no Web Crypto there): those files get the same-name check only.
 */
export async function sha256Hex(file: Blob): Promise<string | null> {
	if (file.size > HASH_LIMIT_BYTES || !globalThis.crypto?.subtle) return null;
	const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** How far one upload is, 0–100. */
export function uploadPercent(job: { sent: number; bytes: number }): number {
	return job.bytes ? Math.min(100, Math.round((job.sent / job.bytes) * 100)) : 100;
}

/** Seconds left for one upload at its speed so far; null until there is a speed to go by. */
export function uploadSecondsLeft(job: { sent: number; bytes: number; startedAt: number | null }, now = Date.now()) {
	return job.startedAt ? secondsLeft(job.sent, job.bytes, now - job.startedAt) : null;
}

/** “9 s left”, or “4 min left” from a minute and a half on (B20). */
export function timeLeft(seconds: number): { key: 'fm_seconds_left' | 'fm_minutes_left'; count: number } {
	return seconds >= 90
		? { key: 'fm_minutes_left', count: Math.round(seconds / 60) }
		: { key: 'fm_seconds_left', count: seconds };
}

/** “14.6 of 22.8 MB · 9 s left”: the seconds come from the speed so far. */
export function secondsLeft(sent: number, total: number, elapsedMs: number): number | null {
	if (sent <= 0 || elapsedMs < 500 || sent >= total) return null;
	return Math.ceil(((total - sent) / sent) * (elapsedMs / 1000));
}

interface EntryLike {
	isFile: boolean;
	isDirectory: boolean;
	name: string;
	file?: (done: (file: File) => void, failed: (error: unknown) => void) => void;
	createReader?: () => {
		readEntries: (done: (entries: EntryLike[]) => void, failed: (error: unknown) => void) => void;
	};
}

/**
 * What was dropped from the computer (A29): loose files, and whole folders read to the bottom.
 * A folder reader answers in batches, so it is read until it answers with none.
 */
export async function readDropped(items: readonly { webkitGetAsEntry(): unknown }[]): Promise<FmPicked[]> {
	const out: FmPicked[] = [];
	const walk = async (entry: EntryLike, path: readonly string[]): Promise<void> => {
		if (entry.isFile && entry.file) {
			const file = await new Promise<File>((done, failed) => entry.file?.(done, failed));
			out.push({ file, path });
			return;
		}
		if (!entry.isDirectory || !entry.createReader) return;
		const reader = entry.createReader();
		for (;;) {
			const batch = await new Promise<EntryLike[]>((done, failed) => reader.readEntries(done, failed));
			if (!batch.length) break;
			for (const child of batch) await walk(child, [...path, entry.name]);
		}
	};
	const entries = items.map((item) => item.webkitGetAsEntry() as EntryLike | null).filter(Boolean);
	for (const entry of entries) await walk(entry as EntryLike, []);
	return out;
}

/** A folder picked with the folder picker: each file names its folders in `webkitRelativePath`. */
export function readPickedFolder(files: readonly File[]): FmPicked[] {
	return files.map((file) => {
		const parts = (file.webkitRelativePath || file.name).split('/');
		return { file, path: parts.slice(0, -1) };
	});
}

// --- Photos (media step 2d): sizes, suggested profiles, notes ----------------------------------------------------

type Profile = Pick<MediaProfile, 'key' | 'shape' | 'fills' | 'minSize' | 'enabled' | 'mainPhotoOnly' | 'maxBytes'>;

/**
 * The row as a photo of this kind: the type the API is told is the kind's own, so a `.jpg` that is really a PNG
 * uploads as a PNG and the worker does not refuse it. A HEIC keeps its type until it is converted (B02).
 */
export function asPhotoKind<R extends Pick<FmUploadRow, 'contentType' | 'kind' | 'photo' | 'waits' | 'heic' | 'name'>>(
	row: R,
	kind: PhotoKind,
): R {
	const heic = kind === 'heic' || looksLikeHeic(row.contentType, row.name);
	const contentType = heic ? row.contentType : PHOTO_KIND_TYPES[kind];
	const photo = heic || isProcessedPhoto(contentType);
	// Never-run check removed: every photo kind is a processed type or a HEIC, so a photo kind never waits.
	return { ...row, kind, contentType, heic, photo, waits: false };
}

/** What a picked file's first bytes say it is; null when they are not a photo, or cannot be read. */
export async function sniffFile(file: Blob): Promise<PhotoKind | null> {
	try {
		return sniffPhotoKind(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
	} catch {
		return null;
	}
}

/** Slices of a picked file, read as they are asked for: a TIFF's header may sit at its end. */
export const blobReader = (file: Blob): ByteReader => ({
	size: file.size,
	read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
});

/** Kinds every browser shows in a picture tag; the others (TIFF, JPEG XL, JPEG 2000, PSD) get their type's icon. */
export const BROWSERS_SHOW: readonly PhotoKind[] = ['jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico'];

/** A photo's upright size: from its header for the kinds browsers can't open (an SVG as the picture made from it). */
export async function measurePhoto(file: Blob, kind: PhotoKind | null): Promise<PhotoShape | null> {
	if (kind && HEADER_MEASURED_KINDS.includes(kind)) return measureFromHeader(blobReader(file), kind);
	return readPhotoSize(file);
}

/** What a file chooser for photos takes (Replace): every type the worker reads, by type and by name. */
export const PHOTO_PICKER_ACCEPT = [
	...new Set(Object.values(PHOTO_KIND_TYPES)),
	'image/heif',
	...PHOTO_FILE_ENDINGS,
].join(',');

/** The photo's upright size as the browser decodes it; null when it cannot be read here. */
export async function readPhotoSize(file: Blob): Promise<PhotoShape | null> {
	if (typeof createImageBitmap !== 'function') return null;
	try {
		const bitmap = await createImageBitmap(file);
		const size = { width: bitmap.width, height: bitmap.height };
		bitmap.close();
		return size;
	} catch {
		return null;
	}
}

/** The profiles a photo may be given: switched on, chosen by people (not the link preview). */
export const choosable = <P extends Profile>(profiles: readonly P[]): P[] =>
	profiles.filter((profile) => profile.enabled && !profile.mainPhotoOnly);

/** The suggestion for a photo (B01): the first profile it already fits, kept as is. */
export function suggestedPicks(profiles: readonly Profile[], size: PhotoShape): FmPick[] {
	const key = suggestProfile(profiles as Parameters<typeof suggestProfile>[0], size);
	return key ? [{ profileKey: key, fills: ['as_is'] }] : [];
}

/** A newly ticked profile: “As is” when the photo fits, else the profile's first fill. */
export function newPick(profile: Profile, size: PhotoShape): FmPick {
	const fills = photoFills(profile as Parameters<typeof photoFills>[0], size);
	return { profileKey: profile.key, fills: fills.slice(0, 1) as MediaFill[] };
}

/** One yellow note or red refusal for a picked profile (B02b). */
export interface FmPhotoNote {
	profileKey: string;
	kind: 'shape' | 'small' | 'too_small' | 'over';
	px?: number;
	has?: number;
	edge?: 'short' | 'width';
}

/** What the popup says about a photo's picks: a different shape, smaller than asked, or refused. */
export function photoNotes(
	row: Pick<FmUploadRow, 'size' | 'picks' | 'bytes'>,
	profiles: readonly Profile[],
): FmPhotoNote[] {
	const notes: FmPhotoNote[] = [];
	if (!row.size) return notes;
	for (const pick of row.picks) {
		const profile = profiles.find((entry) => entry.key === pick.profileKey);
		if (!profile) continue;
		if (row.bytes > profile.maxBytes) notes.push({ profileKey: profile.key, kind: 'over' });
		const check = minSizeCheck(profile.minSize, row.size);
		if (check.result === 'refuse')
			notes.push({ profileKey: profile.key, kind: 'too_small', px: check.px, has: check.has, edge: check.edge });
		else if (check.result === 'warn')
			notes.push({ profileKey: profile.key, kind: 'small', px: check.px, has: check.has, edge: check.edge });
		if (!fitsShape(row.size, profile.shape ?? null)) notes.push({ profileKey: profile.key, kind: 'shape' });
	}
	return notes;
}

/** A refusal stops the photo; a note only asks for a confirmation (B05). */
export const isRefusal = (note: FmPhotoNote): boolean => note.kind === 'too_small' || note.kind === 'over';

/** The versions a photo asks for: one per profile and ticked fill. */
export const versionsOf = (row: Pick<FmUploadRow, 'picks'>): { profileKey: string; fill: MediaFill }[] =>
	row.picks.flatMap((pick) => pick.fills.map((fill) => ({ profileKey: pick.profileKey, fill })));

/** A name for a pasted picture (B17): `pasted-image-15-nov-2026-10-32.png`. */
export function pastedName(type: string, at = new Date()): string {
	const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
	const two = (value: number) => String(value).padStart(2, '0');
	const extension = type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : (type.split('/')[1] ?? 'img');
	return `pasted-image-${at.getDate()}-${months[at.getMonth()]}-${at.getFullYear()}-${two(at.getHours())}-${two(at.getMinutes())}.${extension}`;
}

/** A photo's own shape as people say it (“3:4”, “2:1”), or as a decimal when it is no common one. */
const COMMON_SHAPES: readonly [number, number][] = [
	[1, 1],
	[4, 5],
	[3, 4],
	[2, 3],
	[9, 16],
	[5, 4],
	[4, 3],
	[3, 2],
	[16, 9],
	[2, 1],
	[21, 9],
	[3, 1],
];
export function photoShapeLabel(size: PhotoShape): string {
	const ratio = size.width / size.height;
	const near = COMMON_SHAPES.find(([w, h]) => Math.abs(ratio - w / h) / (w / h) <= 0.02);
	return near ? `${near[0]}:${near[1]}` : `${ratio.toFixed(2)}:1`;
}
