import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, NgZone, PLATFORM_ID, effect, inject, input, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import SwiperCore from 'swiper';
import { Autoplay, Navigation, Pagination } from 'swiper/modules';
import { SwiperOptions } from 'swiper/types';

import { countdownKey } from '@core/events/event-popup-rules';
import { ShopEvents } from '@core/events/shop-events';
import { ITopBarContent } from '@data-access/interfaces/site-config.interface';

import type { ShopEvent } from '@core/events/shop-event.interface';

SwiperCore.use([Navigation, Pagination, Autoplay]);

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The top bar's sliding message strip, also used by the phone strip. A published event adds one
 * line with its countdown (owner brief, approved 2026-11-09); several rotate as the site's own
 * lines always have.
 */
@Component({
	selector: 'app-notice',
	imports: [RouterLink, TranslocoModule],
	templateUrl: './notice.html',
	styleUrls: ['./notice.scss'],
})
export class Notice {
	private platformId = inject<object>(PLATFORM_ID);
	private zone = inject(NgZone);
	private transloco = inject(TranslocoService);
	private clock = inject(ShopEvents);

	readonly content = input<ITopBarContent[]>();
	readonly events = input<ShopEvent[]>([]);

	readonly swiperContainer = viewChild.required<ElementRef>('swiperContainer');
	private swiper: SwiperCore | null = null;

	constructor() {
		// A line that ends, or a new event, changes the slides Swiper already counted.
		effect(() => {
			const count = this.events().length + (this.content()?.length ?? 0);
			if (this.swiper && count) this.zone.runOutsideAngular(() => setTimeout(() => this.swiper?.update()));
		});
	}

	label(event: ShopEvent): string {
		return countdownKey(event);
	}

	/** `3d 04h 12m 05s` from the server's clock; days, never months. Empty once launched. */
	countdown(event: ShopEvent): string {
		const left = this.clock.left(event.countdownTo);
		if (!left) return '';
		const unit = (key: string) => this.transloco.translate(key);
		return `${left.days}${unit('event_unit_day')} ${pad(left.hours)}${unit('event_unit_hour')} ${pad(left.minutes)}${unit('event_unit_minute')} ${pad(left.seconds)}${unit('event_unit_second')}`;
	}

	ngAfterViewInit() {
		if (!isPlatformBrowser(this.platformId)) return;
		// Outside the zone: autoplay's repeating timer would keep the app "unstable" for good, and
		// Angular replays clicks made during hydration only once it is stable, so they were lost.
		this.zone.runOutsideAngular(() => {
			setTimeout(() => {
				const container = this.swiperContainer();
				const slides = this.events().length + (this.content()?.length ?? 0);
				if (!container) return;
				const config: SwiperOptions = {
					// Loop needs more slides than are shown; one line simply stays put.
					loop: slides > 2,
					direction: 'vertical',
					autoHeight: true,
					allowTouchMove: true,
					autoplay: slides > 1 ? { delay: 2000, disableOnInteraction: false } : false,
					pagination: false,
					navigation: false,
				};
				this.swiper = new SwiperCore(container.nativeElement, config);
			}, 2000);
		});
	}

	ngOnDestroy() {
		this.swiper?.destroy(true, false);
	}
}
