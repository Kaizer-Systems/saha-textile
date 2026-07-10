import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { LoaderStore } from '@core/state/loader.store';

@Injectable()
export class LoaderInterceptor implements HttpInterceptor {
  private loaderStore = inject(LoaderStore);

  intercept<T>(req: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
    void Promise.resolve(null).then(() => {
      this.loaderStore.showLoader(req.method == 'GET' ? true : false);
      this.loaderStore.showButtonSpinner(req.method != 'GET' ? true : false);
    });

    return next.handle(req).pipe(
      tap({
        error: _err => {
          this.loaderStore.hideLoader();
          this.loaderStore.hideButtonSpinner();
        },
        complete: () => {
          this.loaderStore.hideLoader();
          this.loaderStore.hideButtonSpinner();
        },
      }),
    );
  }
}
