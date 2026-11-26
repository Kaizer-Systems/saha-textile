import { Component } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

/**
 * The page shown while the shop is switched to maintenance. Its photograph ships with the code
 * (`.coming-soon-section` in `pages/_coming-soon.scss`), so the page shows the right picture even
 * before settings load. The maintenance-mode flag is read separately by the auth interceptor.
 */
@Component({
	selector: 'app-maintenance',
	templateUrl: './maintenance.html',
	styleUrls: ['./maintenance.scss'],
	imports: [TranslocoModule],
})
export class Maintenance {}
