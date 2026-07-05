import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
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
