import { Component, computed, inject, signal } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { formatList } from '@saha-textile/core-domain/languages';
import { type PhotoShape, fitsShape, minSizeCheck, photoFills } from '@saha-textile/core-domain/media-files';

import { injectMediaProfilesQuery } from '@data-access/queries/media-profiles.queries';
import { FileSizePipe } from '@shared/pipes/language.pipes';

import { photoShapeLabel } from './fm-upload-plan';
import { fillKey, isIconProfile, profileNameKey } from '../../setting/image-profiles/profile-words';

import type { MediaFileDetails } from '@core/media-library/media-library.gateway';
import type { MediaFill, MediaProfile } from '@saha-textile/contracts';

/** The new photo as the browser read it, and the one it replaces. */
export interface FmReplaceInput {
	name: string;
	folder: string;
	bytes: number;
	width: number | null;
	height: number | null;
	preview: string | null;
	versions: MediaFileDetails['versions'];
	usedOn: string[];
	next: { name: string; bytes: number; width: number; height: number; contentType: string; preview: string };
}

/** One version the new photo can't make the same way, in the admin's words. */
interface Refused {
	version: string;
	reason: string;
}

/**
 * Replace photo (media step 3b; brief S7, C05): the photo now and the new one side by side, whether the new one can
 * make every version the same way (green), or which it can't and why (red; Replace waits), what stays the same,
 * where it is used, and how long the old files are kept. The popup only answers yes; the Media page uploads.
 */
@Component({
	selector: 'app-fm-replace',
	templateUrl: './fm-replace.html',
	imports: [TranslocoModule, FileSizePipe],
})
export class FmReplace {
	readonly modal = inject(NgbActiveModal);
	private readonly transloco = inject(TranslocoService);
	private readonly profilesQuery = injectMediaProfilesQuery();

	readonly input = signal<FmReplaceInput | null>(null);
	private readonly profiles = computed(
		() => new Map((this.profilesQuery.data() ?? []).map((item) => [item.profile.key, item.profile])),
	);

	/** Each version checked against the new photo the way the server will (C05's red lines). */
	readonly refused = computed<Refused[]>(() => {
		const input = this.input();
		if (!input) return [];
		const size = { width: input.next.width, height: input.next.height };
		return input.versions.flatMap((version) => {
			const profile = this.profiles().get(version.profileKey);
			const name = this.versionName(version.profileKey, version.fill);
			const reason = profile
				? this.reason(profile, version.fill as MediaFill, size, input.next)
				: 'fm_rpl_no_profile';
			return reason
				? [{ version: name, reason: this.transloco.translate(reason, this.reasonParams(profile, size)) }]
				: [];
		});
	});

	/** C05's green line: same shape as before, or at least every version can be made the same way. */
	readonly good = computed(() => {
		const input = this.input();
		if (!input || this.refused().length) return null;
		const names = formatList(
			[...new Set(input.versions.map((version) => this.profileName(version.profileKey)))],
			this.transloco.getActiveLang(),
		);
		const before = input.width && input.height ? { width: input.width, height: input.height } : null;
		const same = before && fitsShape(before, { width: input.next.width, height: input.next.height });
		return this.transloco.translate(same ? 'fm_rpl_same_shape' : 'fm_rpl_fits', { profiles: names });
	});

	readonly profileList = computed(() => {
		const input = this.input();
		return input
			? formatList(
					[...new Set(input.versions.map((version) => this.profileName(version.profileKey)))],
					this.transloco.getActiveLang(),
				)
			: '';
	});

	readonly usedOn = computed(() => formatList(this.input()?.usedOn ?? [], this.transloco.getActiveLang()));

	start(input: FmReplaceInput): void {
		this.input.set(input);
	}

	shape(width: number | null, height: number | null): string {
		return width && height ? photoShapeLabel({ width, height }) : '';
	}

	replace(): void {
		if (this.refused().length) return;
		this.modal.close('replace');
	}

	private profileName(key: string): string {
		const profile = this.profiles().get(key);
		if (profile && !profile.builtIn) return profile.name;
		const nameKey = profileNameKey({ key });
		const name = this.transloco.translate(nameKey);
		return name === nameKey ? key : name;
	}

	private versionName(key: string, fill: string): string {
		const profile = this.profiles().get(key);
		const fillName = this.transloco.translate(fillKey(fill as MediaFill, profile ? isIconProfile(profile) : false));
		return `${this.profileName(key)} · ${fillName}`;
	}

	/** Why a version can't be made the same way from the new photo; null when it can. */
	private reason(
		profile: MediaProfile,
		fill: MediaFill,
		size: PhotoShape,
		next: FmReplaceInput['next'],
	): string | null {
		if (!profile.accepts.includes(next.contentType)) return 'fm_rpl_type';
		if (next.bytes > profile.maxBytes) return 'fm_rpl_too_large';
		// The browser build's types read the shape as optional; the contract always sends it (null to keep).
		if (!photoFills(profile as Parameters<typeof photoFills>[0], size).includes(fill)) return 'fm_rpl_shape';
		if (minSizeCheck(profile.minSize, size).result === 'refuse') return 'fm_rpl_too_small';
		return null;
	}

	private reasonParams(profile: MediaProfile | undefined, size: PhotoShape): Record<string, unknown> {
		const check = profile ? minSizeCheck(profile.minSize, size) : null;
		return check && check.result !== 'ok' ? { px: check.px, has: check.has } : {};
	}
}
