import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { Action, Selector, State, StateContext } from '@ngxs/store';
import { tap } from 'rxjs';

import { GetHomePageAction } from '@data-access/actions/theme.action';
import { ThemeService } from '../services/theme.service';

export class ThemesStateModel {
  homePage: object | null;
}

@State<ThemesStateModel>({
  name: 'theme',
  defaults: {
    homePage: null,
  },
})
@Injectable()
export class ThemeState {
  private router = inject(Router);
  private themeService = inject(ThemeService);

  @Selector()
  static homePage(state: ThemesStateModel) {
    return state.homePage;
  }

  @Action(GetHomePageAction)
  getHomePage(ctx: StateContext<ThemesStateModel>, action: GetHomePageAction) {
    return this.themeService.getHomePage(action.slug).pipe(
      tap({
        next: result => {
          ctx.patchState({
            homePage: result,
          });
        },
        error: err => {
          void this.router.navigate(['/404']);
          throw new Error(err?.error?.message);
        },
      }),
    );
  }
}
