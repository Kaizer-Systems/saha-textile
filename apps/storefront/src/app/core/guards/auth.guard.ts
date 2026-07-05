import { Injectable, inject } from '@angular/core';
import { UrlTree, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { GetUserDetailsAction } from '@data-access/actions/account.action';
import { AuthService } from '@data-access/services/auth.service';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard {
  private store = inject(Store);
  private router = inject(Router);
  private authService = inject(AuthService);

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    // Store the attempted URL for redirecting after login
    this.authService.redirectUrl = state.url;

    // Redirect to the login page
    if (!this.store.selectSnapshot(state => state.auth && state.auth.access_token)) {
      return this.router.createUrlTree(['/auth/login']);
    }

    this.store.dispatch(new GetUserDetailsAction()).subscribe({
      complete: () => {
        return true;
      },
    });
    return true;
  }

  canActivateChild(_route: ActivatedRouteSnapshot, _state: RouterStateSnapshot): boolean | UrlTree {
    if (!!this.store.selectSnapshot(state => state.auth && state.auth.access_token)) {
      if (
        this.router.url.startsWith('/account') ||
        this.router.url == '/checkout' ||
        this.router.url == '/compare'
      )
        void this.router.navigate(['/theme/paris']);
      return false;
    }
    return true;
  }
}
