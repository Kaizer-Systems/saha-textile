
import { Component, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { Observable } from 'rxjs';

import { ThemeOptionStore } from '@core/state/theme-option.store';
import { IOption } from '@data-access/interfaces/theme-option.interface';

@Component({
  selector: 'app-logo',
  templateUrl: './logo.html',
  styleUrls: ['./logo.scss'],
  imports: [RouterLink],
})
export class Logo {
  readonly textClass = input<string>('text-white f-w-600');
  readonly data = input<IOption | null>();
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly logo = input<string | null>();

  themeOption$: Observable<IOption> = toObservable(inject(ThemeOptionStore).themeOptions) as Observable<IOption>;
}
