import type { MediaFolderTree } from '@core/media-library/media-library.gateway';

/** One folder card or one file row/tile, in the order the page shows them. */
export interface FmItemRef {
	type: 'folder' | 'file';
	id: string;
}

/** Ticked folders and files (A27); the page keeps them until it moves to another place. */
export interface FmSelection {
	folders: ReadonlySet<string>;
	files: ReadonlySet<string>;
}

export const NO_SELECTION: FmSelection = { folders: new Set(), files: new Set() };

/** How a click picks (A39): a plain click, ⌘/Ctrl+click, or Shift+click. */
export type FmPickHow = 'only' | 'toggle' | 'range';

export function pickHow(event: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }): FmPickHow {
	if (event.shiftKey) return 'range';
	if (event.metaKey || event.ctrlKey) return 'toggle';
	return 'only';
}

export function isPicked(selection: FmSelection, item: FmItemRef): boolean {
	return (item.type === 'folder' ? selection.folders : selection.files).has(item.id);
}

export function pickedCount(selection: FmSelection): number {
	return selection.folders.size + selection.files.size;
}

const fromItems = (items: readonly FmItemRef[]): FmSelection => ({
	folders: new Set(items.filter((item) => item.type === 'folder').map((item) => item.id)),
	files: new Set(items.filter((item) => item.type === 'file').map((item) => item.id)),
});

/**
 * The selection after a click (A39). A plain click picks only that item; ⌘/Ctrl+click adds or
 * removes it; Shift+click picks everything between the last plain or ⌘/Ctrl click and this one.
 */
export function pickItem(
	current: FmSelection,
	ordered: readonly FmItemRef[],
	item: FmItemRef,
	how: FmPickHow,
	anchor: FmItemRef | null,
): FmSelection {
	if (how === 'only') return fromItems([item]);
	if (how === 'toggle') {
		const folders = new Set(current.folders);
		const files = new Set(current.files);
		const set = item.type === 'folder' ? folders : files;
		if (set.has(item.id)) set.delete(item.id);
		else set.add(item.id);
		return { folders, files };
	}
	const same = (a: FmItemRef) => (b: FmItemRef) => a.type === b.type && a.id === b.id;
	const to = ordered.findIndex(same(item));
	const from = anchor ? ordered.findIndex(same(anchor)) : -1;
	if (to < 0) return current;
	if (from < 0) return fromItems([item]);
	return fromItems(ordered.slice(Math.min(from, to), Math.max(from, to) + 1));
}

/** The item next to the current one for the arrow keys; the first one when nothing is picked. */
export function stepItem(ordered: readonly FmItemRef[], at: FmItemRef | null, step: 1 | -1): FmItemRef | null {
	if (!ordered.length) return null;
	const index = at ? ordered.findIndex((row) => row.type === at.type && row.id === at.id) : -1;
	if (index < 0) return ordered[step === 1 ? 0 : ordered.length - 1] ?? null;
	return ordered[Math.min(ordered.length - 1, Math.max(0, index + step))] ?? null;
}

type TreeRow = MediaFolderTree['folders'][number];

/** Folders the chosen folders may not go into: each of them and everything inside (break-it list). */
export function blockedTargets(rows: readonly TreeRow[], chosenFolders: Iterable<string>): Set<string> {
	const blocked = new Set(chosenFolders);
	let grew = true;
	while (grew) {
		grew = false;
		for (const row of rows) {
			if (row.parentId && blocked.has(row.parentId) && !blocked.has(row.id)) {
				blocked.add(row.id);
				grew = true;
			}
		}
	}
	return blocked;
}

/**
 * Where everything chosen sits now (null is My files), or `undefined` when the items are in
 * different places: moving them where they already are does nothing, so that place is greyed.
 */
export function commonPlace(places: readonly (string | null)[]): string | null | undefined {
	if (!places.length) return undefined;
	const first = places[0] ?? null;
	return places.every((place) => (place ?? null) === first) ? first : undefined;
}

/** Items per call for bulk changes: each answer moves the tray's count (A48). */
export const BULK_PART = 50;

/** A selection in parts of `size`, folders first, so a big change can count as it goes. */
export function splitSelection(
	selection: { folderIds: readonly string[]; fileIds: readonly string[] },
	size = BULK_PART,
): { folderIds: string[]; fileIds: string[] }[] {
	const items = [
		...selection.folderIds.map((id) => ({ type: 'folder' as const, id })),
		...selection.fileIds.map((id) => ({ type: 'file' as const, id })),
	];
	const parts: { folderIds: string[]; fileIds: string[] }[] = [];
	for (let at = 0; at < items.length; at += size) {
		const chunk = items.slice(at, at + size);
		parts.push({
			folderIds: chunk.filter((item) => item.type === 'folder').map((item) => item.id),
			fileIds: chunk.filter((item) => item.type === 'file').map((item) => item.id),
		});
	}
	return parts;
}
