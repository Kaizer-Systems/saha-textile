import {
  HttpRequest,
  HttpHandler,
  HttpInterceptor,
  HttpErrorResponse,
  HttpEvent,
} from '@angular/common/http';
import { effect, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { catchError, Observable, throwError } from 'rxjs';

import { NotificationService } from '@data-access/services/notification.service';
import { AuthStore } from '@core/state/auth.store';
import { SettingStore } from '@core/state/setting.store';
import { ThemeOptionStore } from '@core/state/theme-option.store';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private authStore = inject(AuthStore);
  private settingStore = inject(SettingStore);
  private themeOptionStore = inject(ThemeOptionStore);

  public isMaintenanceModeOn: boolean = false;

  constructor() {
    // Countries + states now load on-demand via TanStack queries in the
    // address-modal; no app-start prefetch needed. Settings + theme options move
    // to SignalStores; auth stays on NGXS until that state is migrated.
    this.settingStore.loadSettings();
    this.themeOptionStore.loadThemeOption();
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
