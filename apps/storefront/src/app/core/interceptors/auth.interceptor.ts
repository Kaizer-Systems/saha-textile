import {
  HttpRequest,
  HttpHandler,
  HttpInterceptor,
  HttpErrorResponse,
  HttpEvent,
} from '@angular/common/http';
import { effect, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { Store } from '@ngxs/store';
import { catchError, Observable, throwError } from 'rxjs';

import { AuthClearAction } from '@data-access/actions/auth.action';
import { GetThemeOptionAction } from '@data-access/actions/theme-option.action';
import { NotificationService } from '@data-access/services/notification.service';
import { SettingStore } from '@core/state/setting.store';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private store = inject(Store);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private settingStore = inject(SettingStore);

  public isMaintenanceModeOn: boolean = false;

  constructor() {
    // Countries + states now load on-demand via TanStack queries in the
    // address-modal; no app-start prefetch needed. Settings move to SettingStore
    // (SignalStore); theme options stay on NGXS until that state is migrated.
    this.settingStore.loadSettings();
    this.store.dispatch(new GetThemeOptionAction());
    effect(() => {
      this.isMaintenanceModeOn = this.settingStore.setting()?.maintenance?.maintenance_mode!;
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
