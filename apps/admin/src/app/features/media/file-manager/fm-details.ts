import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { MediaFill } from '@saha-textile/contracts';
import { lastValueFrom } from 'rxjs';

import {
	MediaLibraryGateway,
	type MediaActivityPage,
	type MediaFileDetails,
} from '@core/media-library/media-library.gateway';
import { NotificationService } from '@data-access/services/notification.service';
import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';

import { fillKey, profileNameKey } from '../../setting/image-profiles/profile-words';

type Tab = 'versions' | 'activity';
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
	private readonly gateway = inject(MediaLibraryGateway);
	private readonly transloco = inject(TranslocoService);
	private readonly notifications = inject(NotificationService);

	readonly details = signal<MediaFileDetails | null>(null);
	readonly activity = signal<MediaActivityPage['items']>([]);
	readonly tab = signal<Tab>('versions');
	readonly error = signal(false);
	/** Which tree nodes are open: version ids, `version|role` for families. */
	readonly open = signal<ReadonlySet<string>>(new Set());

	readonly isImage = computed(() => this.details()?.kind === 'image');
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
			const first = details.versions[0];
			if (first) this.open.set(new Set([first.id]));
			if (details.kind !== 'image') this.tab.set('activity');
			const trail = await lastValueFrom(this.gateway.itemActivity(fileId));
			this.activity.set(trail.items);
		} catch {
			this.error.set(true);
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
		const fill = MediaFill.safeParse(version.fill);
		const fillName = fill.success
			? this.transloco.translate(fillKey(fill.data, version.profileKey === 'browser_icon_1x1'))
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
			this.notifications.showSuccess(this.transloco.translate('fm_address_copied'));
		} catch {
			this.notifications.showError(this.transloco.translate('fm_action_failed'));
		}
	}

	/** One line of the item's Activity, in the admin's words where the action is known. */
	activityText(row: { action: string }): string {
		const key = `fm_activity_${row.action.replace(/^media(\.asset)?\./, '').replace(/\./g, '_')}`;
		const text = this.transloco.translate(key);
		return text === key ? row.action : text;
	}
}
