import { Component, input } from '@angular/core';

import { CarouselModule } from 'ngx-owl-carousel-o';

import { ImageLink } from '@shared/ui/image-link/image-link';
import * as data from '../../../../shared/data/owl-carousel';

@Component({
  selector: 'app-theme-banner',
  templateUrl: './banner.html',
  styleUrls: ['./banner.scss'],
  imports: [CarouselModule, ImageLink],
})
export class Banner {
  readonly style = input<string>('horizontal');
  readonly class = input<string | null>();
  readonly contentClass = input<string>();
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly banners = input<any>();

  public bannerSlider = data.bannerSlider;
}
