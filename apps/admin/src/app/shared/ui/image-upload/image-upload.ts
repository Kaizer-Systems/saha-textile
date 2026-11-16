import { Component, Input, inject, output, input } from '@angular/core';

import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { FmPicker, type FmPicked, type FmPickRules } from '@features/media/file-manager/fm-picker';
import { fillKey, profileNameKey } from '@features/setting/image-profiles/profile-words';

import { IAttachment } from '../../../data-access/interfaces/attachment.interface';

import type { MediaPurpose } from '@core/media/media.gateway';

/**
 * The profile each kind of place needs by default (R4-2): the picker lists photos holding a ready version of it.
 * A field can name its own with `profile` (a category icon, a swatch), or `null` for any photo (share pictures,
 * which use the photo's own link preview).
 */
export const PROFILE_FOR_PURPOSE: Readonly<Record<MediaPurpose, string | null>> = {
	product: 'product_3x4',
	category: 'category_3x4',
	banner: 'banner_keep_shape',
	blog: 'blog_cover_2x1',
	store: 'store_photo_4x3',
	brand: 'logo_keep_shape',
	icon: 'browser_icon_1x1',
	avatar: null,
};
/** How many a multi-picture field takes when it doesn't say. */
const DEFAULT_MAX = 40;

/** A chosen picture as the forms read it, with the version this place shows (R4-1). */
export type PickedAttachment = IAttachment & { versionId?: string | null };

/**
 * An image field (E01–E04): its pictures as tiles, a “+” that opens the Media picker (media step 4d) with the
 * place's profile and room, and the version a tile shows named on it when it isn't “As is”. The forms keep their
 * inputs and `selectedFiles`; each chosen picture also carries its `versionId`.
 */
@Component({
	selector: 'app-image-upload',
	templateUrl: './image-upload.html',
	styleUrls: ['./image-upload.scss'],
	imports: [TranslocoPipe],
})
export class ImageUpload {
	private readonly modals = inject(NgbModal);
	private readonly transloco = inject(TranslocoService);

	// TODO: Skipped for migration because:
	//  Your application code writes to the input. This prevents migration.
	@Input() images: IAttachment[] = [];
	// TODO: Skipped for migration because:
	//  Your application code writes to the input. This prevents migration.
	@Input() image: IAttachment | null;
	readonly id = input<string>('');
	// TODO: Skipped for migration because:
	//  Your application code writes to the input. This prevents migration.
	@Input() imageUrl: string | null;
	readonly url = input<boolean>(false);
	readonly multipleImage = input<boolean>(false);
	/** What uploads made from this picker are for; passed to the media modal. */
	readonly purpose = input<MediaPurpose>('product');
	/**
	 * One picture only (Brand Kit, owner 2026-11-10): while a picture is set the "+" is hidden, so
	 * changing it means removing it first. Off, the "+" stays and picking again replaces the picture.
	 */
	readonly oneOnly = input<boolean>(false);
	/** `dark`: the preview tile is dark, so a logo made for dark screens can be seen (Brand Kit). */
	readonly tone = input<'light' | 'dark'>('light');
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	@Input() helpText: string;
	/** The profile this place needs; undefined: the purpose's (PROFILE_FOR_PURPOSE); null: any photo. */
	readonly profile = input<string | null | undefined>(undefined);
	/** How many pictures a multi-picture field holds in all. */
	readonly max = input<number | null>(null);
	/** The picker's title, a translation key. */
	readonly pickTitle = input<string | null>(null);

	readonly selectedFiles = output<any>();

	public showImages: IAttachment[] = [];
	public showImage: IAttachment | null;
	public showImageUrl: String | null;

	/** Whether the "+" tile shows. */
	get canAdd(): boolean {
		return !this.oneOnly() || (!this.showImage && !this.showImageUrl && !this.showImages?.length);
	}

	/** The profile the picker filters by, or null for any photo. */
	profileKey(): string | null {
		const named = this.profile();
		return named === undefined ? PROFILE_FOR_PURPOSE[this.purpose()] : named;
	}

	/** How many more a multi-picture field takes (E02's “N left”); null for a one-picture field. */
	get left(): number | null {
		if (!this.multipleImage()) return null;
		return Math.max(0, (this.max() ?? DEFAULT_MAX) - (this.showImages?.length ?? 0));
	}

	/** E04: a tile names its version when it isn't “As is”. */
	versionBadge(image: PickedAttachment | null | undefined): string | null {
		const fill = image?.versionId?.split('.')[1];
		return fill && fill !== 'as_is'
			? this.transloco.translate(fillKey(fill as never, image?.versionId?.startsWith('browser_icon') ?? false))
			: null;
	}

	/** The “+” tile: the Media picker with this place's rules (R4-2, D01–D17). */
	async openPicker(): Promise<void> {
		const multiple = this.multipleImage();
		const key = this.profileKey();
		const rules: FmPickRules = {
			title: this.pickTitle() ?? (multiple ? 'fm_pick_title' : 'fm_pick_title_one'),
			accept: 'image',
			max: multiple ? (this.max() ?? DEFAULT_MAX) : 1,
			already: multiple ? (this.showImages?.length ?? 0) : 0,
			profile: key
				? {
						key,
						name: this.transloco.translate(profileNameKey({ key })),
						icon: key === 'browser_icon_1x1',
					}
				: null,
		};
		const popup = this.modals.open(FmPicker, {
			size: 'xl',
			windowClass: 'theme-modal media-modal fm-picker',
			scrollable: true,
		});
		(popup.componentInstance as FmPicker).start(rules);
		const picked = (await popup.result.catch(() => null)) as FmPicked[] | null;
		if (!picked?.length) return;
		const chosen = picked.map(toAttachment);
		if (multiple) {
			const kept = (Array.isArray(this.images) ? this.images : []).filter(
				(image) => !chosen.some((row) => String(row.id) === String(image.id)),
			);
			this.selectImage([...kept, ...chosen] as never, false);
		} else this.selectImage(chosen[0] as IAttachment, this.url());
	}

	ngOnChanges() {
		this.showImage = this.image;
		this.showImages = this.images;
		this.showImageUrl = this.imageUrl;
	}

	selectImage(data: IAttachment, url: boolean) {
		if (Array.isArray(data)) {
			this.images = data;
			this.showImages = data;
		} else if (url) {
			this.imageUrl = data.original_url;
			this.showImageUrl = data.original_url;
		} else {
			this.image = data;
			this.showImage = data;
		}
		if (this.imageUrl) {
			this.selectedFiles.emit(this.imageUrl);
		} else {
			this.selectedFiles.emit(this.images.length ? this.images : this.image);
		}
	}

	remove(index: number, type: string) {
		if (type == 'multiple' && Array.isArray(this.images)) {
			this.images.splice(index, 1);
			this.showImages = this.images;
		} else if (type == 'single_image_url') {
			this.imageUrl = null;
			this.showImageUrl = null;
			this.image = null;
		} else {
			this.image = null;
			this.showImage = null;
		}
		this.selectedFiles.emit(this.images.length ? this.images : this.image);
	}
}

/** A picker's answer in the shape the forms already read. */
function toAttachment(row: FmPicked): PickedAttachment {
	return {
		id: row.assetId,
		name: row.name,
		file_name: row.name,
		original_url: row.thumbnailUrl ?? '',
		versionId: row.versionId,
		collection_name: '',
		mime_type: '',
		disk: '',
		conversions_disk: '',
		size: '',
		created_by_id: 0,
	};
}
