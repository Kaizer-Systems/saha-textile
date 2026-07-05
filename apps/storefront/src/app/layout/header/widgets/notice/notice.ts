import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, PLATFORM_ID, viewChild, inject, input } from '@angular/core';

import SwiperCore from 'swiper';
import { Autoplay, Navigation, Pagination } from 'swiper/modules';
import { SwiperOptions } from 'swiper/types';

import { ITopBarContent } from '@data-access/interfaces/theme-option.interface';

SwiperCore.use([Navigation, Pagination, Autoplay]);

@Component({
  selector: 'app-notice',
  imports: [],
  templateUrl: './notice.html',
  styleUrls: ['./notice.scss'],
})
export class Notice {
  private platformId = inject<Object>(PLATFORM_ID);

  readonly content = input<ITopBarContent[]>();

  readonly swiperContainer = viewChild.required<ElementRef>('swiperContainer');

  public swiperConfig: SwiperOptions = {
    loop: true,
    direction: 'vertical',
    autoHeight: true,
    allowTouchMove: true,
    autoplay: { delay: 2000, disableOnInteraction: false },
    pagination: false,
    navigation: false,
  };

  ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      setTimeout(() => {
        const swiperContainer = this.swiperContainer();
        if (swiperContainer) {
          new SwiperCore(swiperContainer.nativeElement, this.swiperConfig);
        }
      }, 2000);
    }
  }
}
