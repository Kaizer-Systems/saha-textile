import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { buildTree } from './fm-sidebar';

import type { MediaFolderTree } from '@core/media-library/media-library.gateway';

export type FmMenuKey =
	| 'open'
	| 'new_inside'
	| 'preview'
	| 'rename'
	| 'download'
	| 'download_original'
	| 'move'
	| 'star'
	| 'unstar'
	| 'trash';

/** One line of a right-click or ⋮ menu (A20–A22); `divider` is the rule above Move to Trash. */
export type FmMenuLine = FmMenuKey | 'divider';

const LOOK: Readonly<Record<FmMenuKey, { icon: string; label: string }>> = {
	open: { icon: 'ri-folder-open-line', label: 'fm_open' },
	new_inside: { icon: 'ri-folder-add-line', label: 'fm_new_folder_inside' },
	preview: { icon: 'ri-eye-line', label: 'fm_preview' },
	rename: { icon: 'ri-edit-line', label: 'rename' },
	download: { icon: 'ri-download-2-line', label: 'fm_download' },
	download_original: { icon: 'ri-download-2-line', label: 'fm_download_original' },
	move: { icon: 'ri-drag-move-2-line', label: 'fm_move_to' },
	star: { icon: 'ri-star-line', label: 'fm_star' },
	unstar: { icon: 'ri-star-fill', label: 'fm_unstar' },
	trash: { icon: 'ri-delete-bin-line', label: 'fm_move_to_trash' },
};

/**
 * The Media page's menu (A20–A22): the theme's dropdown with the brief's `fm-ctx` look, and Move
 * to as a cascade of folders. A folder opens its own list on hover or click; its first line puts
 * the items in that folder itself. Places the items cannot go are greyed: a chosen folder and
 * everything inside it, and the place they already are.
 */
@Component({
	selector: 'app-fm-menu',
	templateUrl: './fm-menu.html',
	imports: [NgTemplateOutlet, TranslocoModule],
})
export class FmMenu {
	readonly lines = input<readonly FmMenuLine[]>([]);
	/** Top-left corner, in pixels inside the page's main column. */
	readonly at = input.required<{ x: number; y: number }>();
	/** The bulk bar's Move to: the folder list is the whole menu. */
	readonly moveOnly = input(false);
	/** Near the right edge, lists open to the left. */
	readonly flip = input(false);
	readonly folders = input<readonly MediaFolderTree['folders'][number][]>([]);
	readonly blocked = input<ReadonlySet<string>>(new Set());
	/** Where the chosen items are now; `undefined` when they are in different places. */
	readonly here = input<string | null | undefined>(undefined);

	readonly choose = output<FmMenuKey>();
	readonly moveTo = output<string | null>();

	readonly look = LOOK;
	readonly tree = computed(() => buildTree(this.folders()));
	readonly moveOpen = signal(false);
	/** The folders whose lists are open, from the top. */
	readonly path = signal<readonly string[]>([]);

	enter(line: FmMenuKey): void {
		this.moveOpen.set(line === 'move');
		if (line !== 'move') this.path.set([]);
	}

	pick(line: FmMenuKey): void {
		if (line === 'move') this.moveOpen.update((open) => !open);
		else this.choose.emit(line);
	}

	/** Hovering a folder opens its list, and closes any list deeper than it. */
	openAt(depth: number, id: string, hasChildren: boolean): void {
		const kept = this.path().slice(0, depth);
		this.path.set(hasChildren && !this.blocked().has(id) ? [...kept, id] : kept);
	}

	canGo(id: string | null): boolean {
		return (id === null || !this.blocked().has(id)) && this.here() !== id;
	}

	go(id: string | null): void {
		if (this.canGo(id)) this.moveTo.emit(id);
	}
}
