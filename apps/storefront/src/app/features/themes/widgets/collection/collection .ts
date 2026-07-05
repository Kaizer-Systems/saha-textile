import { Component, input } from '@angular/core';

import { CarouselModule } from 'ngx-owl-carousel-o';

import { ImageLink } from '@shared/ui/image-link/image-link';
import * as data from '../../../../shared/data/owl-carousel';
import { IBundles } from '@data-access/interfaces/theme.interface';

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
