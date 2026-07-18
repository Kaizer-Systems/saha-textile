import { Component, inject } from '@angular/core';

import { NotificationService } from '@data-access/services/notification.service';

export interface IAlert {
	type: string | null;
	message: string | null;
}

@Component({
	selector: 'app-alert',
	templateUrl: './alert.html',
	styleUrls: ['./alert.scss'],
	imports: [],
})
export class Alert {
	private notificationService = inject(NotificationService);

	public alert: IAlert = {
		type: null,
		message: null,
	};

	constructor() {
		this.notificationService.alertSubject.subscribe((alert) => {
			this.alert = <IAlert>alert;
		});
	}

	ngOnDestroy() {
		this.notificationService.notification = true;
	}
}
