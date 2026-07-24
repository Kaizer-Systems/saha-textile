import { isPlatformBrowser, ViewportScroller } from '@angular/common';
import { Component, HostListener, PLATFORM_ID, inject } from '@angular/core';

@Component({
	selector: 'app-back-to-top',
	templateUrl: './back-to-top.html',
	styleUrls: ['./back-to-top.scss'],
	standalone: true,
})
export class BackToTop {
	private platformId = inject<Object>(PLATFORM_ID);
	private viewScroller = inject(ViewportScroller);

	public show: boolean;

	// @HostListener Decorator
	@HostListener('window:scroll', [])
	onWindowScroll() {
		if (isPlatformBrowser(this.platformId)) {
			let number = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
			if (number > 600) {
				this.show = true;
			} else {
				this.show = false;
			}
		}
	}

	tapToTop() {
		this.viewScroller.scrollToPosition([0, 0]);
	}
}
