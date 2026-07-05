import { Component, inject } from '@angular/core';

import { NotificationService } from '@data-access/services/notification.service';

export interface Alert {
	type: string;
	message: string;
}

@Component({
	selector: 'app-alert',
	templateUrl: './alert.html',
	styleUrls: ['./alert.scss'],
	imports: [],
})
export class Alert {
	private notificationService = inject(NotificationService);

	public alert: Alert;

	constructor() {
		this.notificationService.alertSubject.subscribe((alert) => {
			this.alert = <Alert>alert;
		});
	}

	ngOnDestroy() {
		this.notificationService.notification = true;
	}
}
