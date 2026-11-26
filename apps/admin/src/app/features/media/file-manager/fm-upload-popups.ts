import { CurrencyPipe, NgTemplateOutlet } from '@angular/common';
import { Component, type TemplateRef, computed, inject, viewChild } from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { NgbDropdown, NgbDropdownMenu, NgbDropdownToggle } from '@ng-bootstrap/ng-bootstrap';

import { injectMediaStorageQuery } from '@data-access/queries/media-library.queries';
import { FileSizePipe, PluralPipe } from '@shared/pipes/language.pipes';

import { fileKind, fileTypeLabel } from './file-kinds';
import { FmPhone } from './fm-phone';
import { FmUploadFlow, type FmUploadPopups as FmUploadPopupRefs } from './fm-upload-flow';
import { type FmPhotoNote, type FmPick, type FmUploadRow, PHOTO_MAX_BYTES, photoShapeLabel } from './fm-upload-plan';
import { fillKey, isIconProfile, profileNameKey } from '../../setting/image-profiles/profile-words';

/**
 * The upload popups (B03–B21: review with profiles and fills, over-25 MB list, notes, duplicates, Upload anyway with
 * Keep both or Replace, the replace-in-use list, on-demand storage and its refusal). One copy serves the Media page
 * and the Media picker (D10); each provides its own FmUploadFlow, which this reads.
 */
@Component({
	selector: 'app-fm-upload-popups',
	templateUrl: './fm-upload-popups.html',
	imports: [
		CurrencyPipe,
		FileSizePipe,
		NgbDropdown,
		NgbDropdownMenu,
		NgbDropdownToggle,
		NgTemplateOutlet,
		PluralPipe,
		TranslocoModule,
	],
})
export class FmUploadPopups {
	readonly flow = inject(FmUploadFlow);
	/** G03: on a phone the review lists each file as a card instead of the wide table. */
	readonly phone = inject(FmPhone).is;
	private readonly transloco = inject(TranslocoService);

	readonly reviewTemplate = viewChild<TemplateRef<unknown>>('fmUploadReview');
	readonly duplicateTemplate = viewChild<TemplateRef<unknown>>('fmDuplicate');
	readonly anywayTemplate = viewChild<TemplateRef<unknown>>('fmUploadAnyway');
	readonly replaceInUseTemplate = viewChild<TemplateRef<unknown>>('fmReplaceInUse');
	readonly onDemandTemplate = viewChild<TemplateRef<unknown>>('fmOnDemand');
	readonly refusedTemplate = viewChild<TemplateRef<unknown>>('fmStorageRefused');
	readonly overLimitTemplate = viewChild<TemplateRef<unknown>>('fmOverLimit');
	readonly notesTemplate = viewChild<TemplateRef<unknown>>('fmNotes');

	readonly photoMax = PHOTO_MAX_BYTES;
	readonly typeOf = fileTypeLabel;
	/** The storage box's numbers, for the on-demand popups (B18, B19). */
	readonly storage = injectMediaStorageQuery();
	/** Where the files go: the folder the upload was started in. */
	readonly uploadPlace = computed(() => this.flow.review()?.place || this.transloco.translate('fm_my_files'));

	/** Every popup the flow opens, once they are drawn. */
	popups(): FmUploadPopupRefs | null {
		const review = this.reviewTemplate();
		const duplicate = this.duplicateTemplate();
		const onDemand = this.onDemandTemplate();
		const refused = this.refusedTemplate();
		const overLimit = this.overLimitTemplate();
		const notes = this.notesTemplate();
		const anyway = this.anywayTemplate();
		const replaceInUse = this.replaceInUseTemplate();
		return review && duplicate && onDemand && refused && overLimit && notes
			? {
					review,
					duplicate,
					onDemand,
					refused,
					overLimit,
					notes,
					...(anyway ? { anyway } : {}),
					...(replaceInUse ? { replaceInUse } : {}),
				}
			: null;
	}

	startUpload(close: () => void): void {
		const popups = this.popups();
		if (popups) void this.flow.start(close, popups);
	}

	rowKind(row: FmUploadRow) {
		return fileKind({
			name: row.name,
			category: row.waits ? 'images' : 'other',
			kind: row.waits ? 'image' : 'file',
		});
	}

	/** A profile's name: a built-in one by its translation, an added one as typed. */
	profileName(key: string): string {
		const profile = this.flow.profiles().find((entry) => entry.key === key);
		if (!profile) return key;
		return profile.builtIn ? this.transloco.translate(profileNameKey(profile)) : profile.name;
	}

	/** A picked profile as its chip says it: “Product 3:4”, or “Product 3:4 · White padding” per fill. */
	pickLabels(pick: FmPick): string[] {
		const name = this.profileName(pick.profileKey);
		const profile = this.flow.profiles().find((entry) => entry.key === pick.profileKey);
		const icon = !!profile && isIconProfile(profile);
		return pick.fills.map((fill) =>
			fill === 'as_is' ? name : `${name} · ${this.transloco.translate(fillKey(fill, icon))}`,
		);
	}

	/** The fills a picked profile offers this photo when its shape differs (B21). */
	fillChoices(row: FmUploadRow, key: string): { fill: Exclude<FmPick['fills'][number], 'as_is'>; label: string }[] {
		const profile = this.flow.profiles().find((entry) => entry.key === key);
		if (!profile || !row.size || !profile.shape) return [];
		const fits =
			Math.abs(row.size.width / row.size.height - profile.shape.width / profile.shape.height) /
				(profile.shape.width / profile.shape.height) <=
			0.05;
		if (fits) return [];
		const icon = isIconProfile(profile);
		return profile.fills.map((fill) => ({ fill, label: this.transloco.translate(fillKey(fill, icon)) }));
	}

	noteText(note: FmPhotoNote): string {
		return this.transloco.translate(`fm_note_${note.kind}`, {
			profile: this.profileName(note.profileKey),
			px: note.px,
			has: note.has,
		});
	}

	shapeOf(row: FmUploadRow): string {
		return row.size ? photoShapeLabel(row.size) : '';
	}
}
