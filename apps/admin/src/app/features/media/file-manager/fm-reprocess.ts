import { Component, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { formatList } from '@saha-textile/core-domain/languages';
import {
	cropKeeps,
	estimateVersionBytes,
	fitsShape,
	minSizeCheck,
	photoFills,
	type PhotoShape,
} from '@saha-textile/core-domain/media-files';

import { injectBrandQuery } from '@core/brand/brand.gateway';
import { injectMediaProfilesQuery } from '@data-access/queries/media-profiles.queries';
import { FileSizePipe, PluralPipe, translateCount } from '@shared/pipes/language.pipes';

import { choosable, photoShapeLabel } from './fm-upload-plan';
import { FILL_SAMPLE } from '../../setting/image-profiles/image-profile-form/image-profile-form';
import {
	fillKey,
	isIconProfile,
	profileNameKey,
	shapeBox,
	shapeLabel,
} from '../../setting/image-profiles/profile-words';

import type { MediaFill, MediaProfile } from '@saha-textile/contracts';

/** One photo Reprocess works on: what the list or the details popup already knows. */
export interface FmReprocessPhoto {
	id: string;
	name: string;
	width: number | null;
	height: number | null;
	bytes: number;
	contentType: string;
	thumbnailUrl: string | null;
}

/** What the popup answers: the versions to add (a profile and a fill each), and how to name them in the tray. */
export interface FmReprocessChoice {
	versions: { profileKey: string; fill: MediaFill }[];
	/** “Hero 21:9 · Crop and Product 3:4 · White padding”. */
	label: string;
}

/** One profile line (C01): what the photo already has, what is ticked, and what it would say. */
interface Line {
	profile: MediaProfile;
	/** The fills this photo may get here: “As is” alone when it already fits or the profile keeps its shape. */
	fills: MediaFill[];
	fits: boolean;
	/** Fills made or being made: ticked and locked. */
	made: ReadonlyMap<MediaFill, 'ready' | 'making'>;
	ticked: ReadonlySet<MediaFill>;
	/** A red refusal: the profile can't take this photo. */
	refusal: string | null;
	/** Yellow notes for what is ticked (C02 asks about these once). */
	notes: string[];
}

/** A crop keeping less than this share of the photo gets a note (the brief's 38% example). */
const CROP_NOTE_BELOW = 0.6;

/**
 * Reprocess (media step 3a; brief C01, C02, C07): add versions to one photo, or the same ones to many. Each profile is
 * a line; a profile of another shape opens its fill cards, and every fill ticked becomes its own version. Versions
 * already made are ticked and locked: they never change, so nothing on the website moves. The popup only answers
 * what to make; the Media page runs the storage check and asks the API.
 */
@Component({
	selector: 'app-fm-reprocess',
	templateUrl: './fm-reprocess.html',
	imports: [TranslocoModule, FileSizePipe, PluralPipe],
})
export class FmReprocess {
	readonly modal = inject(NgbActiveModal);
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);
	private readonly profilesQuery = injectMediaProfilesQuery();
	private readonly brand = injectBrandQuery();

	readonly photos = signal<readonly FmReprocessPhoto[]>([]);
	/** For one photo: the versions it has, by id, with their state. */
	private readonly existing = signal<ReadonlyMap<string, string>>(new Map());
	/** New picks: profile key → fills ticked. */
	private readonly picks = signal<ReadonlyMap<string, ReadonlySet<MediaFill>>>(new Map());
	readonly confirm = viewChild<TemplateRef<unknown>>('fmReprocessNotes');
	readonly sample = FILL_SAMPLE;

	readonly many = computed(() => this.photos().length > 1);
	readonly photo = computed(() => this.photos()[0] ?? null);
	readonly brandColour = computed(() => this.brand.data()?.themeColor ?? '#417394');
	/** The fill cards show the photo itself when one is chosen, else the profile form's sample picture. */
	readonly picture = computed(() => (this.many() ? null : this.photo()?.thumbnailUrl) ?? this.sample);

	private readonly size = computed<PhotoShape | null>(() => {
		const photo = this.photo();
		return !this.many() && photo?.width && photo.height ? { width: photo.width, height: photo.height } : null;
	});

	readonly lines = computed<Line[]>(() => {
		const size = this.size();
		const many = this.many();
		const photo = this.photo();
		const existing = this.existing();
		const picks = this.picks();
		return choosable((this.profilesQuery.data() ?? []).map((item) => item.profile))
			.filter((profile) => many || !photo || profile.accepts.includes(photo.contentType))
			.map((profile) => {
				// The browser build's types read the shape as optional; the contract always sends it (null to keep).
				const fills = (
					size
						? photoFills(profile as Parameters<typeof photoFills>[0], size)
						: profile.shape
							? profile.fills
							: ['as_is']
				) as MediaFill[];
				const made = new Map<MediaFill, 'ready' | 'making'>();
				for (const fill of fills) {
					const state = existing.get(`${profile.key}.${fill}`);
					if (state === 'ready' || state === 'making') made.set(fill, state);
				}
				const ticked = picks.get(profile.key) ?? new Set<MediaFill>();
				return {
					profile,
					fills,
					fits: fills.length === 1 && fills[0] === 'as_is',
					made,
					ticked,
					refusal: size && photo ? this.refusalFor(profile, size, photo.bytes) : null,
					notes: size ? this.notesFor(profile, size, ticked) : [],
				};
			});
	});

	/** New versions ticked across every line. */
	readonly count = computed(() => this.lines().reduce((sum, line) => sum + line.ticked.size, 0));
	readonly noted = computed(() => this.lines().filter((line) => line.ticked.size && line.notes.length));
	readonly bytes = computed(() =>
		estimateVersionBytes(
			this.photos().reduce((sum, photo) => sum + photo.bytes, 0),
			this.count(),
		),
	);

	/** Set right after the popup opens: one photo with its versions, or many photos. */
	start(input: { photos: readonly FmReprocessPhoto[]; versions?: readonly { id: string; state: string }[] }): void {
		this.photos.set(input.photos);
		this.existing.set(new Map((input.versions ?? []).map((version) => [version.id, version.state])));
	}

	name(profile: MediaProfile): string {
		return profile.builtIn ? this.transloco.translate(profileNameKey(profile)) : profile.name;
	}

	shape(profile: MediaProfile): { width: number; height: number } {
		return shapeBox(profile.shape);
	}

	ratio(profile: MediaProfile): string {
		const shape = profile.shape;
		const size = this.size();
		if (shape) return `${shape.width} / ${shape.height}`;
		return size ? `${size.width} / ${size.height}` : '1 / 1';
	}

	fillName(profile: MediaProfile, fill: MediaFill): string {
		return this.transloco.translate(fillKey(fill, isIconProfile(profile)));
	}

	photoShape(): string {
		const size = this.size();
		return size ? photoShapeLabel(size) : '';
	}

	/** The grey line under a profile's name (C01). */
	lineNote(line: Line): string {
		if (this.many()) {
			return this.transloco.translate(line.fits ? 'fm_rp_keeps_shape' : 'fm_rp_many_shapes');
		}
		if (!line.profile.shape) return this.transloco.translate('fm_rp_keeps_shape');
		if (line.fits) return this.transloco.translate('fm_rp_same_shape');
		if (!line.ticked.size && !line.made.size) return this.transloco.translate('fm_rp_tick_for_fills');
		return this.transloco.translate('fm_rp_other_shape', {
			photo: this.photoShape(),
			box: shapeLabel(line.profile.shape) ?? '',
		});
	}

	/** A profile line ticked or unticked: “As is” when the photo fits, else its first fill not made yet. */
	toggleLine(line: Line): void {
		const next = new Map(this.picks());
		if (next.has(line.profile.key)) next.delete(line.profile.key);
		else {
			const first = line.fills.find((fill) => !line.made.has(fill));
			if (!first) return;
			next.set(line.profile.key, new Set([first]));
		}
		this.picks.set(next);
	}

	toggleFill(line: Line, fill: MediaFill): void {
		if (line.made.has(fill)) return;
		const next = new Map(this.picks());
		const fills = new Set(next.get(line.profile.key) ?? []);
		if (fills.has(fill)) fills.delete(fill);
		else fills.add(fill);
		if (fills.size) next.set(line.profile.key, fills);
		else next.delete(line.profile.key);
		this.picks.set(next);
	}

	/** Whether the line's own tick shows: made already, or ticked now. */
	lineChecked(line: Line): boolean {
		return line.ticked.size > 0 || line.made.size > 0;
	}

	/**
	 * A profile the photo already has stays ticked and locked (C01's “Done”); more fills for it are ticked on its
	 * cards. A refused profile can't be ticked.
	 */
	lineLocked(line: Line): boolean {
		return !!line.refusal || line.made.size > 0;
	}

	/** Make: notes are confirmed once (C02), then the popup answers with the versions. */
	async make(): Promise<void> {
		if (!this.count()) return;
		const template = this.confirm();
		if (this.noted().length && template) {
			const yes = await this.modals
				.open(template, {
					centered: true,
					windowClass: 'theme-modal text-center',
					ariaLabelledBy: 'fm_rp_notes_title',
				})
				.result.then(
					() => true,
					() => false,
				);
			if (!yes) return;
		}
		const ticked = this.lines().flatMap((line) => [...line.ticked].map((fill) => ({ line, fill })));
		const versions = ticked.map(({ line, fill }) => ({ profileKey: line.profile.key, fill }));
		const label = formatList(
			ticked.map(({ line, fill }) => `${this.name(line.profile)} · ${this.fillName(line.profile, fill)}`),
			this.transloco.getActiveLang(),
		);
		this.modal.close({ versions, label } satisfies FmReprocessChoice);
	}

	footer(): string {
		const many = this.many();
		const notes = this.noted().length;
		const words = translateCount(this.transloco, many ? 'fm_rp_footer_many' : 'fm_rp_footer', this.count(), {
			photos: this.photos().length,
		});
		return notes ? `${words} · ${translateCount(this.transloco, 'fm_rp_footer_notes', notes)}` : words;
	}

	private refusalFor(profile: MediaProfile, size: PhotoShape, bytes: number): string | null {
		const check = minSizeCheck(profile.minSize, size);
		if (check.result === 'refuse')
			return this.transloco.translate('fm_rp_too_small', { px: check.px, has: check.has });
		if (bytes > profile.maxBytes) return this.transloco.translate('fm_rp_too_large');
		return null;
	}

	private notesFor(profile: MediaProfile, size: PhotoShape, ticked: ReadonlySet<MediaFill>): string[] {
		const notes: string[] = [];
		if (!ticked.size) return notes;
		if (ticked.has('crop') && profile.shape && !fitsShape(size, profile.shape)) {
			const keeps = cropKeeps(size, profile.shape);
			if (keeps.share < CROP_NOTE_BELOW)
				notes.push(
					this.transloco.translate(keeps.side === 'width' ? 'fm_rp_crop_width' : 'fm_rp_crop_height', {
						pct: Math.round(keeps.share * 100),
					}),
				);
		}
		const check = minSizeCheck(profile.minSize, size);
		if (check.result === 'warn')
			notes.push(this.transloco.translate('fm_rp_smaller', { px: check.px, has: check.has }));
		return notes;
	}
}
