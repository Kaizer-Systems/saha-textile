import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';

import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, switchMap, tap } from 'rxjs';

import { IOption } from '@data-access/interfaces/theme-option.interface';
import { ThemeOptionService } from '@data-access/services/theme-option.service';

/**
 * Theme options + session flags (replaces NGXS ThemeOptionState + its
 * GetThemeOption/UpdateSession actions). Hybrid shell state → SignalStore:
 *  - `theme_option` is server config, (re)loaded via loadThemeOption() (rxMethod).
 *  - `exit` / `cookies` / `newsletter` are one-shot session flags (cookie-consent
 *    dismissed, exit-intent/newsletter shown). Persisted to localStorage so they
 *    don't re-trigger on reload — the NGXS storage plugin persisted the whole
 *    theme_option state. SSR-guarded.
 *
 * Note: mutable UI fields like preloader/theme_color live on ThemeOptionService,
 * not here, and are untouched.
 */
type ThemeOptionStateModel = {
  themeOptions: IOption | null;
  exit: boolean;
  cookies: boolean;
  newsletter: boolean;
};

const SESSION_KEY = 'theme_option_session';

export const ThemeOptionStore = signalStore(
  { providedIn: 'root' },
  withState<ThemeOptionStateModel>({
    themeOptions: null,
    exit: true,
    cookies: true,
    newsletter: true,
  }),
  withMethods(
    (store, themeOptionService = inject(ThemeOptionService), platformId = inject(PLATFORM_ID)) => ({
      loadThemeOption: rxMethod<void>(
        pipe(
          switchMap(() =>
            themeOptionService
              .getThemeOption()
              .pipe(tap(result => patchState(store, { themeOptions: result.options }))),
          ),
        ),
      ),
      updateSession(slug: string, value: boolean): void {
        patchState(store, {
          cookies: slug == 'cookies' ? value : store.cookies(),
          exit: slug == 'exit' ? value : store.exit(),
          newsletter: slug == 'newsletter' ? value : store.newsletter(),
        });
        if (isPlatformBrowser(platformId)) {
          localStorage.setItem(
            SESSION_KEY,
            JSON.stringify({
              exit: store.exit(),
              cookies: store.cookies(),
              newsletter: store.newsletter(),
            }),
          );
        }
      },
    }),
  ),
  withHooks({
    onInit(store) {
      if (isPlatformBrowser(inject(PLATFORM_ID))) {
        const saved = localStorage.getItem(SESSION_KEY);
        if (saved) patchState(store, JSON.parse(saved));
      }
    },
  }),
);
