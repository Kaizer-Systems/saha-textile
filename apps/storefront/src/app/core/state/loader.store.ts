import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

/**
 * Global loading/spinner state (replaces NGXS LoaderState + its Show/Hide
 * loader/button-spinner actions). Root-provided NgRx SignalStore — the first of
 * the app-shell states moving off NGXS in phase 5c-B.
 *
 * `loadingCount` ref-counts in-flight requests so overlapping calls don't clear
 * the loader early (ported verbatim from the old reducers).
 */
type LoaderStateModel = {
  status: boolean;
  loadingCount: number;
  button_spinner: boolean;
  button_id: string | null;
};

const initialState: LoaderStateModel = {
  status: false,
  loadingCount: 0,
  button_spinner: false,
  button_id: null,
};

export const LoaderStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods(store => ({
    showLoader(loading = true): void {
      const count = store.loadingCount() ? store.loadingCount() : 0;
      patchState(store, { status: loading, loadingCount: count + 1 });
    },
    hideLoader(): void {
      const count = store.loadingCount();
      patchState(store, { status: count === 1 ? false : true, loadingCount: count - 1 });
    },
    showButtonSpinner(loading = true): void {
      patchState(store, { button_spinner: loading });
    },
    hideButtonSpinner(): void {
      patchState(store, { button_spinner: false });
    },
  })),
);
