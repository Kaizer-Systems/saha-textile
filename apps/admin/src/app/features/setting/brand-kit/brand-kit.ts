import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { Component, inject, type OnDestroy, signal, type WritableSignal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { BrandGateway } from '@core/brand/brand.gateway';
import { applyThemeColor } from '@core/brand/theme-color';
import { MediaGateway } from '@core/media/media.gateway';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload, type PickedAttachment, ImageUploadValue, onePicture } from '@shared/ui/image-upload/image-upload';

import type { BrandAppStore, BrandLogoSet, BrandSettings, BrandSocialNetwork } from '@saha-textile/contracts';

/** The image slots of one logo set. */
type SetSlot = Exclude<keyof BrandLogoSet, 'sealAsFavicon'>;
const SET_SLOTS: readonly SetSlot[] = [
	'logoAssetId',
	'logoDarkAssetId',
	'sealAssetId',
	'sealDarkAssetId',
	'faviconAssetId',
];
/** Which logo set a slot belongs to: the shop's, or the admin's own. */
export type LogoSetName = 'shop' | 'admin';

/** The profile boxes, in order, with their label keys (YouTube comes from Storefront settings › YouTube). */
const NETWORKS: readonly { key: BrandSocialNetwork; label: string }[] = [
	{ key: 'facebook', label: 'facebook' },
	{ key: 'instagram', label: 'instagram' },
	{ key: 'x', label: 'share_app_x' },
	{ key: 'pinterest', label: 'pinterest' },
	{ key: 'linkedin', label: 'share_app_linkedin' },
	{ key: 'threads', label: 'social_threads' },
];

/** Where a store link stands: unchanged since load, being asked, found, not found, or the store was away. */
export type AppLinkState = 'saved' | 'checking' | 'found' | 'missing' | 'unknown' | 'unchecked';

/** The app store rows, with their label keys. */
const STORES: readonly { key: BrandAppStore; label: string }[] = [
	{ key: 'android', label: 'android_app' },
	{ key: 'ios', label: 'ios_app' },
];

/**
 * The Brand Kit. A new owner of this codebase uploads their own logos here after deployment, and
 * every screen, icon and search result follows. No brand sits in the code.
 *
 * Owner briefs, 2026-11-10: one picture per slot (the "+" hides while one is set); each logo has
 * an optional dark version; the phone logo makes the browser icon unless unticked; the admin may
 * carry its own logos, each empty slot falling back to the shop's; plus the link preview picture,
 * the shop's profiles (X is also shown in Sharing: one stored value) and the browser bar colour.
 * Saved pictures load from the media library when the page opens.
 */
@Component({
	selector: 'app-brand-kit',
	templateUrl: './brand-kit.html',
	imports: [PageWrapper, ReactiveFormsModule, NgTemplateOutlet, TranslocoModule, FormFields, Button, ImageUpload],
})
export class BrandKit implements OnDestroy {
	private readonly gateway = inject(BrandGateway);
	private readonly media = inject(MediaGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);
	private readonly fb = inject(FormBuilder).nonNullable;
	private readonly page = inject(DOCUMENT);

	readonly networks = NETWORKS;
	readonly stores = STORES;

	readonly form = this.fb.group({
		shopName: [''],
		...this.logoSetControls(),
		adminOwnLogos: [false],
		admin: this.fb.group(this.logoSetControls()),
		shareImageAssetId: this.nullableId(),
		/** The version each chosen picture shows (R4-1), by photo id. */
		imageVersions: inject(FormBuilder).nonNullable.control<Record<string, string>>({}),
		socials: this.fb.group(
			Object.fromEntries(NETWORKS.map((network) => [network.key, ['']])) as Record<BrandSocialNetwork, [string]>,
		),
		apps: this.fb.group({ android: [''], ios: [''] }),
		modeSwitch: [true],
		themeColor: ['#417394'],
		adminThemeColor: ['#0da487'],
	});
	/** Each store link's check: a changed link must be found in its store before Save. */
	readonly appState = { android: signal<AppLinkState>('saved'), ios: signal<AppLinkState>('saved') };
	readonly appName = { android: signal<string | null>(null), ios: signal<string | null>(null) };

	/** Previews by set and slot, loaded from the media library. */
	readonly previews: Record<LogoSetName, Record<SetSlot, WritableSignal<IAttachment | null>>> = {
		shop: this.previewSignals(),
		admin: this.previewSignals(),
	};
	readonly shareImage = signal<IAttachment | null>(null);
	/** Ticked: that set's phone logo is its browser icon, and the Browser icon slot stays hidden. */
	readonly sealAsFavicon = { shop: signal(true), admin: signal(true) };
	readonly adminOwnLogos = signal(false);

	constructor() {
		this.gateway.settings().subscribe((value) => {
			this.form.patchValue(value);
			const versions = value.imageVersions ?? {};
			for (const slot of SET_SLOTS) {
				this.preview(value[slot], this.previews.shop[slot], versions);
				this.preview(value.admin?.[slot], this.previews.admin[slot], versions);
			}
			this.preview(value.shareImageAssetId, this.shareImage, versions);
			this.sealAsFavicon.shop.set(value.sealAsFavicon);
			this.sealAsFavicon.admin.set(value.admin?.sealAsFavicon ?? true);
			this.adminOwnLogos.set(value.adminOwnLogos);
			this.savedAdminColour = value.adminThemeColor;
		});
	}

	private logoSetControls() {
		return {
			logoAssetId: this.nullableId(),
			logoDarkAssetId: this.nullableId(),
			sealAssetId: this.nullableId(),
			sealDarkAssetId: this.nullableId(),
			sealAsFavicon: [true],
			faviconAssetId: this.nullableId(),
		};
	}

	private previewSignals(): Record<SetSlot, WritableSignal<IAttachment | null>> {
		return Object.fromEntries(SET_SLOTS.map((slot) => [slot, signal<IAttachment | null>(null)])) as Record<
			SetSlot,
			WritableSignal<IAttachment | null>
		>;
	}

	private nullableId() {
		return inject(FormBuilder).control<string | null>(null);
	}

	/** A tile's picture, with the version it shows so the tile can name it (E04). */
	private preview(
		assetId: string | null | undefined,
		target: { set(value: IAttachment | null): void },
		versions: Readonly<Record<string, string>> = {},
	) {
		if (assetId)
			this.media
				.get(assetId)
				.subscribe((image) =>
					target.set(versions[assetId] ? ({ ...image, versionId: versions[assetId] } as IAttachment) : image),
				);
	}

	/** Keeps the version a picture was chosen with (media step 4d). */
	private keepVersion(image: IAttachment | null | undefined) {
		const id = image ? String(image.id) : null;
		const versionId = (image as PickedAttachment | null | undefined)?.versionId;
		if (!id || !versionId) return;
		const control = this.form.controls.imageVersions;
		control.setValue({ ...control.value, [id]: versionId });
	}

	/** Sets or clears one logo slot of the shop's or the admin's set. */
	select(set: LogoSetName, slot: SetSlot, value: ImageUploadValue) {
		const image = onePicture(value);
		const control = set === 'shop' ? this.form.controls[slot] : this.form.controls.admin.controls[slot];
		control.setValue(image ? String(image.id) : null);
		this.keepVersion(image);
	}

	selectShareImage(value: ImageUploadValue) {
		const image = onePicture(value);
		this.form.controls.shareImageAssetId.setValue(image ? String(image.id) : null);
		this.keepVersion(image);
	}

	useSealAsFavicon(set: LogoSetName, ticked: boolean) {
		const control =
			set === 'shop' ? this.form.controls.sealAsFavicon : this.form.controls.admin.controls.sealAsFavicon;
		control.setValue(ticked);
		this.sealAsFavicon[set].set(ticked);
	}

	useAdminLogos(on: boolean) {
		this.form.controls.adminOwnLogos.setValue(on);
		this.adminOwnLogos.set(on);
	}

	/** The admin colour as saved; a colour only tried here is put back when the page closes. */
	private savedAdminColour = '#0da487';

	/** The whole admin takes a picked colour at once, before Save. */
	previewAdminColour(colour: string) {
		applyThemeColor(this.page, colour);
	}

	ngOnDestroy() {
		applyThemeColor(this.page, this.savedAdminColour);
	}

	/** Typing in a store link means it must be checked again before Save. */
	editAppLink(store: BrandAppStore) {
		const empty = !this.form.controls.apps.controls[store].value.trim();
		this.appState[store].set(empty ? 'saved' : 'unchecked');
		this.appName[store].set(null);
	}

	validateAppLink(store: BrandAppStore) {
		const url = this.form.controls.apps.controls[store].value.trim();
		if (!url) return;
		this.appState[store].set('checking');
		this.gateway.checkAppLink(store, url).subscribe({
			next: (result) => {
				this.appState[store].set(result.found ? 'found' : 'missing');
				this.appName[store].set(result.name);
			},
			error: () => this.appState[store].set('unknown'),
		});
	}

	/** Save waits until every changed store link has been found in its store. */
	appLinksReady(): boolean {
		return this.stores.every((store) => ['saved', 'found'].includes(this.appState[store.key]()));
	}

	save() {
		if (!this.appLinksReady()) {
			this.notifier.showError(this.transloco.translate('app_link_check_first'));
			return;
		}
		this.gateway.save(this.form.getRawValue() as BrandSettings).subscribe({
			next: () => {
				this.savedAdminColour = this.form.controls.adminThemeColor.value;
				void this.queryClient.invalidateQueries({ queryKey: ['brand'] });
				this.notifier.showSuccess(this.transloco.translate('brand_saved'));
			},
			error: () => this.notifier.showError(this.transloco.translate('brand_rejected')),
		});
	}
}
