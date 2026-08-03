import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable, catchError, throwError } from 'rxjs';

import { ErrorService } from '@data-access/services/error.service';
import { LoggingService } from '@data-access/services/logging.service';
import { NotificationService } from '@data-access/services/notification.service';

@Injectable()
export class GlobalErrorHandlerInterceptor implements HttpInterceptor {
	private errorService = inject(ErrorService);
	private logger = inject(LoggingService);
	private notifier = inject(NotificationService);

	intercept<T>(request: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
		return next.handle(request).pipe(
			catchError((error: HttpErrorResponse) => {
				// A 401 is an authentication OUTCOME, not a user-facing error, and it belongs
				// to `AuthInterceptor` alone. Two reasons this must not fall through here:
				//
				// 1. The anonymous `/me` probe at startup answers 401 by design. Logging and
				//    toasting it made every first page load look broken.
				// 2. Since pass 3c a 401 is frequently RECOVERED — rotated and replayed
				//    transparently. This interceptor sits downstream of the auth one, so it
				//    sees that failure before the recovery happens; shouting here would put
				//    an error toast on screen during a refresh that then succeeds.
				//
				// An unrecoverable 401 is not silent: the auth interceptor clears the session
				// and the app returns the user to login.
				if (error.status === 401) return throwError(() => error);

				// Handle HTTP errors here
				console.error('HTTP Error:', error.error);

				// You can perform additional error handling tasks here,
				// such as logging the error, displaying a notification, etc.
				const errorMessage = this.errorService.getClientErrorMessage(error.error);
				this.logger.logError(errorMessage);
				this.notifier.showError(errorMessage);

				// Rethrow the error to propagate it down the error handling chain
				return throwError(() => error);
			}),
		);
	}
}
