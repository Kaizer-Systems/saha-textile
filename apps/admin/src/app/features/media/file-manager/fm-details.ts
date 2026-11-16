import { DatePipe } from '@angular/common';
import { Component, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';

import { ToastrService } from '@damjantonkli/ngx-toastr';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { readApiErrorMessage } from '@saha-textile/http-transport';
import { lastValueFrom } from 'rxjs';

import {
	MediaLibraryGateway,
	type MediaActivityPage,
	type MediaFileDetails,
} from '@core/media-library/media-library.gateway';
import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';

import { fillKey, profileNameKey } from '../../setting/image-profiles/profile-words';

import type { MediaFill } from '@saha-textile/contracts';

type Tab = 'versions' | 'activity';

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
 * first version starts open, the tree scrolls in its own box) and its Activity. The Text tab (alt text on the photo)
 * comes with the picker in step 4. Built from existing pieces: the media popup, the theme's nav tabs and tree box,
 * `fm-vnode`, `fm-activity`.
 */
@Component({
	selector: 'app-fm-details',
	templateUrl: './fm-details.html',
	imports: [TranslocoModule, FileSizePipe, PluralPipe, DatePipe],
})
export class FmDetails {
	readonly modal = inject(NgbActiveModal);
	private readonly modals = inject(NgbModal);
	private readonly gateway = inject(MediaLibraryGateway);
	private readonly transloco = inject(TranslocoService);
	/** Toasts straight from the theme's toastr: the shared notifier's success closes every popup, this one too. */
	private readonly toastr = inject(ToastrService);

	readonly details = signal<MediaFileDetails | null>(null);
	readonly activity = signal<MediaActivityPage['items']>([]);
	readonly tab = signal<Tab>('versions');
	readonly error = signal(false);
	/** Which tree nodes are open: version ids, `version|role` for families. */
	readonly open = signal<ReadonlySet<string>>(new Set());

	readonly isImage = computed(() => this.details()?.kind === 'image');
	/** The version asked about in the Remove popup. */
	readonly removing = signal<Version | null>(null);
	readonly removeConfirm = viewChild<TemplateRef<unknown>>('fmRemoveVersion');
	/** The picture on the left: a middle-sized file of the first ready version, else nothing. */
	readonly preview = computed(() => {
		const version = this.details()?.versions.find((row) => row.state === 'ready');
		const files = version?.families.flatMap((family) => family.files) ?? [];
		const middle = files.filter((file) => file.width >= 300).sort((a, b) => a.width - b.width)[0] ?? files[0];
		return middle?.url ?? null;
	});

	/** Set right after the popup opens. */
	async start(fileId: string): Promise<void> {
		try {
			const details = await lastValueFrom(this.gateway.details(fileId));
			this.details.set(details);
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
		return url.split('/').pop() ?? url;
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
