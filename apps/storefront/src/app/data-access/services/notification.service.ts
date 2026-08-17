import { HttpClient } from '@angular/common/http';
import { Injectable, NgZone, inject } from '@angular/core';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import { Observable, Subject } from 'rxjs';

import { Params } from '@data-access/interfaces/core.interface';
import { INotificationModel } from '@data-access/interfaces/notification.interface';

import { environment } from '../../../../public/environments/environment';

@Injectable({
	providedIn: 'root',
})
export class NotificationService {
	private zone = inject(NgZone);
	private http = inject(HttpClient);
	private modalService = inject(NgbModal);
	private toastr = inject(ToastrService);

	public alertSubject = new Subject();

	public notification: boolean = true;

	/**
	 * A toast with nothing in it is worse than no toast.
	 *
	 * ngx-toastr happily builds its container for an empty string, so a blank message rendered as
	 * an empty outlined box — and several failing requests produced several of them. Refusing here
	 * means a caller that has genuinely nothing to say stays quiet, and the box only ever appears
	 * around real words.
	 */
	private hasSomethingToSay(message: string): boolean {
		return typeof message === 'string' && message.trim().length > 0;
	}

	showSuccess(message: string): void {
		this.alertSubject.next({ type: 'success', message: message });
		this.zone.run(() => {
			this.modalService.dismissAll();
			if (this.notification && this.hasSomethingToSay(message)) {
				this.toastr.success(message);
			}
		});
	}

	showError(message: string): void {
		this.alertSubject.next({ type: 'error', message: message });
		this.zone.run(() => {
			if (this.notification && this.hasSomethingToSay(message)) {
				this.toastr.error(message);
			}
		});
	}

	getNotifications(payload?: Params): Observable<INotificationModel> {
		return this.http.get<INotificationModel>(`${environment.URL}/notification.json`, {
			params: payload,
		});
	}
}
