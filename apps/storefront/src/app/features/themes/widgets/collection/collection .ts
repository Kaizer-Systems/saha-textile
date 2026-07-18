import { Component, input } from '@angular/core';

import { CarouselModule } from 'ngx-owl-carousel-o';

import { IBundles } from '@data-access/interfaces/theme.interface';
import { ImageLink } from '@shared/ui/image-link/image-link';

import * as data from '../../../../shared/data/owl-carousel';

@Component({
	selector: 'app-theme-collection ',
	templateUrl: './collection .html',
	styleUrls: ['./collection .scss'],
	imports: [CarouselModule, ImageLink],
})
export class Collection {
	readonly data = input<IBundles[]>();

	public bannerSlider = data.bannerSlider;
}
