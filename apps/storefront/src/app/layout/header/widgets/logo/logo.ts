
import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { ThemeOptionState } from '@data-access/states/theme-option.state';
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

  themeOption$: Observable<IOption> = inject(Store).select(
    ThemeOptionState.themeOptions,
  ) as Observable<IOption>;
}
