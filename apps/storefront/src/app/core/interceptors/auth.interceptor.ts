import {
  HttpRequest,
  HttpHandler,
  HttpInterceptor,
  HttpErrorResponse,
  HttpEvent,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { Store } from '@ngxs/store';
import { catchError, Observable, throwError } from 'rxjs';

import { AuthClearAction } from '@data-access/actions/auth.action';
import { GetSettingOptionAction } from '@data-access/actions/setting.action';
import { GetThemeOptionAction } from '@data-access/actions/theme-option.action';
import { IValues } from '@data-access/interfaces/setting.interface';
import { NotificationService } from '@data-access/services/notification.service';
import { SettingState } from '@data-access/states/setting.state';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private store = inject(Store);
  private router = inject(Router);
  private notificationService = inject(NotificationService);

  setting$: Observable<IValues> = inject(Store).select(SettingState.setting) as Observable<IValues>;

  public isMaintenanceModeOn: boolean = false;

  constructor() {
    // Countries + states now load on-demand via TanStack queries in the
    // address-modal; no app-start prefetch needed.
    this.store.dispatch(new GetSettingOptionAction());
    this.store.dispatch(new GetThemeOptionAction());
    this.setting$.subscribe(setting => {
      this.isMaintenanceModeOn = setting?.maintenance?.maintenance_mode!;
    });
  }

  intercept<T>(req: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
    // If Maintainance Mode On
    if (this.isMaintenanceModeOn) {
      void this.router.navigate(['/maintenance']);
    }

    const token = this.store.selectSnapshot(state => state.auth.access_token);
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
          this.store.dispatch(new AuthClearAction());
        }
        return throwError(() => error);
      }),
    );
  }
}
