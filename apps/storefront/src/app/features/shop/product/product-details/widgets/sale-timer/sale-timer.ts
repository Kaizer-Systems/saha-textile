import { Component, Input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

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
  imports: [TranslateModule],
})
export class SaleTimer {
  @Input() startDate: string | null;
  @Input() endDate: string | null;

  remainingTime: IRemainingTime | null = null;

  ngOnChanges() {
    const startDate = this.startDate;
    const endDate = this.endDate;
    if (startDate && endDate) {
      const startDateTime = new Date(startDate).getTime();
      const endDateTime = new Date(endDate).getTime();
      const now = new Date().getTime();
      this.remainingTime = null;

      if (now > startDateTime && endDateTime > now) {
        this.updateTimer(); // Initial call to display the remaining time immediately.

        // Update the timer every second
        setInterval(() => {
          this.updateTimer();
        }, 1000);
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

  ngDestroy() {
    this.startDate = null;
    this.endDate = null;
  }
}
