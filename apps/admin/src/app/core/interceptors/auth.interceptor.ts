import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { catchError, Observable, throwError } from 'rxjs';

import { AuthStore } from '@core/state/auth.store';
import { NotificationService } from '@data-access/services/notification.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
	private router = inject(Router);
	private authStore = inject(AuthStore);
	private notificationService = inject(NotificationService);

	intercept<T>(req: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
		// API-set httpOnly cookie sessions require cross-origin credentials.
		// CSRF header attachment belongs here when the double-submit endpoint ships.
		req = req.clone({ withCredentials: true });

		const token = this.authStore.access_token();

		if (token) {
			// TRANSITIONAL until Phase D cookie auth. The browser security model is
			// httpOnly cookies + CSRF, not a localStorage bearer token.
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
					this.authStore.clear();
					void this.router.navigate(['/auth/login']);
				}
				return throwError(() => error);
			}),
		);
	}
}
