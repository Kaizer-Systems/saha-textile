import { isPlatformBrowser } from '@angular/common';
import { Component, Input, PLATFORM_ID, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

interface IRemainingTime {
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
}

@Component({
	selector: 'app-sale-timer',
	templateUrl: './sale-timer.html',
	styleUrls: ['./sale-timer.scss'],
	imports: [TranslocoModule],
})
export class SaleTimer {
	@Input() startDate: string | null;
	@Input() endDate: string | null;

	remainingTime: IRemainingTime | null = null;

	private platformId = inject(PLATFORM_ID);
	private intervalId?: ReturnType<typeof setInterval>;

	ngOnChanges() {
		const startDate = this.startDate;
		const endDate = this.endDate;
		if (startDate && endDate) {
			const startDateTime = new Date(startDate).getTime();
			const endDateTime = new Date(endDate).getTime();
			const now = new Date().getTime();
			this.remainingTime = null;

			if (now > startDateTime && endDateTime > now) {
				this.updateTimer(); // Initial (synchronous) render — safe on the server.

				// The ticking interval must NEVER run on the server: it keeps Node's event
				// loop alive and hangs SSR. Browser only, and cleared on re-init/destroy.
				if (isPlatformBrowser(this.platformId)) {
					clearInterval(this.intervalId);
					this.intervalId = setInterval(() => this.updateTimer(), 1000);
				}
			}
		}
	}

	private updateTimer() {
		const startDate = this.startDate;
		const endDate = this.endDate;
		if (startDate && endDate) {
			// Input dates and times (Change these to your desired input dates and times)
			const startDateTime = new Date(startDate).getTime();
			const endDateTime = new Date(endDate).getTime();
			const now = new Date().getTime();

			let targetDate = endDateTime; // Assume the target date is the end date

			if (now < startDateTime) {
				// Sale has not started yet, so the target date is the start date
				targetDate = startDateTime;
			} else if (now >= endDateTime) {
				// Sale has ended, set remaining time to zero
				this.remainingTime = {
					days: 0,
					hours: 0,
					minutes: 0,
					seconds: 0,
				};
				return;
			}

			this.calculateTimeDifference(targetDate);
		}
	}

	private calculateTimeDifference(targetDate: number) {
		const now = new Date().getTime();
		const timeDiff = targetDate - now;

		this.remainingTime = {
			days: Math.floor(timeDiff / (1000 * 60 * 60 * 24)),
			hours: Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
			minutes: Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60)),
			seconds: Math.floor((timeDiff % (1000 * 60)) / 1000),
		};
	}

	ngOnDestroy() {
		if (this.intervalId) clearInterval(this.intervalId);
	}
}
