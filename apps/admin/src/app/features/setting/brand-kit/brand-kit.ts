import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { BrandGateway } from '@core/brand/brand.gateway';
import { MediaGateway } from '@core/media/media.gateway';
import { IAttachment } from '@data-access/interfaces/attachment.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { ImageUpload } from '@shared/ui/image-upload/image-upload';

type Slot = 'logoAssetId' | 'sealAssetId';

/**
 * The Brand Kit. A new owner of this codebase uploads their own logo here after deployment, and
 * every screen, icon and search result follows. No brand sits in the code.
 */
@Component({
	selector: 'app-brand-kit',
	templateUrl: './brand-kit.html',
	imports: [PageWrapper, ReactiveFormsModule, TranslocoModule, FormFields, Button, ImageUpload],
})
export class BrandKit {
	private readonly gateway = inject(BrandGateway);
	private readonly media = inject(MediaGateway);
	private readonly queryClient = inject(QueryClient);
	private readonly notifier = inject(NotificationService);
	private readonly transloco = inject(TranslocoService);

	readonly form = inject(FormBuilder).nonNullable.group({
		shopName: [''],
		logoAssetId: this.nullableId(),
		sealAssetId: this.nullableId(),
	});
	readonly logo = signal<IAttachment | null>(null);
	readonly seal = signal<IAttachment | null>(null);

	constructor() {
		this.gateway.settings().subscribe((value) => {
			this.form.patchValue(value);
			this.preview(value.logoAssetId, this.logo);
			this.preview(value.sealAssetId, this.seal);
		});
	}

	private nullableId() {
		return inject(FormBuilder).control<string | null>(null);
	}

	private preview(assetId: string | null, target: { set(value: IAttachment | null): void }) {
		if (assetId) this.media.get(assetId).subscribe((image) => target.set(image));
	}

	select(slot: Slot, image: IAttachment | null | undefined) {
		this.form.controls[slot].setValue(image ? String(image.id) : null);
	}

	save() {
		this.gateway.save(this.form.getRawValue()).subscribe(() => {
			void this.queryClient.invalidateQueries({ queryKey: ['brand'] });
			this.notifier.showSuccess(this.transloco.translate('brand_saved'));
		});
	}
}
