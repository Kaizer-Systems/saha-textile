import { waitsForImageProfiles } from '@saha-textile/core-domain/media-files';

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
	/** Folders under the place the upload goes, as picked: kept on upload. */
	folderPath: readonly string[];
	/** A photo: it waits for image profiles (owner, 15 Nov); everything else uploads now. */
	waits: boolean;
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
		const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : UNKNOWN_TYPE;
		rows.push({
			key: `${index}:${[...path, file.name].join('/')}`,
			file,
			name: file.name,
			bytes: file.size,
			contentType,
			folderPath: path,
			waits: waitsForImageProfiles(contentType, file.name),
		});
	}
	const tops = new Set(rows.map((row) => row.folderPath[0] ?? ''));
	const folderName = tops.size === 1 && !tops.has('') ? ([...tops][0] ?? null) : null;
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
