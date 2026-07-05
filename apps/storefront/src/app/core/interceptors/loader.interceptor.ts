import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import {
  HideButtonSpinnerAction,
  HideLoaderAction,
  ShowButtonSpinnerAction,
  ShowLoaderAction,
} from '@data-access/actions/loader.action';

@Injectable()
export class LoaderInterceptor implements HttpInterceptor {
  private store = inject(Store);

  intercept<T>(req: HttpRequest<T>, next: HttpHandler): Observable<HttpEvent<T>> {
    void Promise.resolve(null).then(() => {
      this.store.dispatch(new ShowLoaderAction(req.method == 'GET' ? true : false));
      this.store.dispatch(new ShowButtonSpinnerAction(req.method != 'GET' ? true : false));
    });

    return next.handle(req).pipe(
      tap({
        error: _err => {
          this.store.dispatch(new HideLoaderAction());
          this.store.dispatch(new HideButtonSpinnerAction());
        },
        complete: () => {
          this.store.dispatch(new HideLoaderAction());
          this.store.dispatch(new HideButtonSpinnerAction());
        },
      }),
    );
  }
}
