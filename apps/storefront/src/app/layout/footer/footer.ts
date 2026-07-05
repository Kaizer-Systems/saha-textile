import { AsyncPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { BasicFooter } from './basic-footer/basic-footer';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { IFooter } from '@data-access/interfaces/theme.interface';
import { ThemeOptionState } from '@data-access/states/theme-option.state';

@Component({
  selector: 'app-footer',
  templateUrl: './footer.html',
  styleUrls: ['./footer.scss'],
  imports: [BasicFooter, AsyncPipe],
})
export class Footer {
  readonly footer = input<IFooter>();

  themeOption$: Observable<IOption> = inject(Store).select(
    ThemeOptionState.themeOptions,
  ) as Observable<IOption>;
}
