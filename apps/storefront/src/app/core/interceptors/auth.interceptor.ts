import { HttpRequest, HttpHandler, HttpInterceptor, HttpErrorResponse, HttpEvent } from '@angular/common/http';
import { effect, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { catchError, Observable, throwError } from 'rxjs';

import { AuthStore } from '@core/state/auth.store';
import { SettingStore } from '@core/state/setting.store';
import { NotificationService } from '@data-access/services/notification.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
	private router = inject(Router);
	private notificationService = inject(NotificationService);
	private authStore = inject(AuthStore);
	private settingStore = inject(SettingStore);

	public isMaintenanceModeOn: boolean = false;

	constructor() {
		// Only READ settings here (for maintenance mode). App-init data loads live
		// in App: firing an HTTP request from an interceptor constructor triggers a
		// circular HTTP_INTERCEPTORS dependency (the SignalStore rxMethod fires the
		// request synchronously, unlike the old async NGXS dispatch).
		effect(() => {
			this.isMaintenanceModeOn = this.settingStore.setting()?.maintenance?.maintenance_mode!;
		});
	}

	intercept<T>(req: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
		// If Maintainance Mode On
		if (this.isMaintenanceModeOn) {
			void this.router.navigate(['/maintenance']);
		}

		const token = this.authStore.access_token();
		if (token) {
			req = req.clone({
				setHeaders: {
					Authorization: `Bearer ${token}`,
				},
			});
		}

		return next.handle(req).pipe(
			catchError((error: HttpErrorResponse) => {
				if (error.status === 401) {
					this.notificationService.notification = false;
					this.authStore.authClear();
				}
				return throwError(() => error);
			}),
		);
	}
}
