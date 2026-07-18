import { Component, SimpleChanges, input } from '@angular/core';

import { ILink } from '@data-access/interfaces/theme.interface';
import { ImageLink } from '@shared/ui/image-link/image-link';

@Component({
	selector: 'app-product-banner',
	templateUrl: './product-banner.html',
	styleUrls: ['./product-banner.scss'],
	imports: [ImageLink],
})
export class ProductBanner {
	readonly image = input<string | null>();

	public banner: ILink;

	ngOnChanges(change: SimpleChanges) {
		let img = change['image'].currentValue;
		this.banner = {
			redirect_link: {
				link_type: 'collection',
				link: 'vegetables-fruits',
			},
			image_url: img,
		};
	}
}
