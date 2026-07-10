import { AsyncPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { BasicFooter } from './basic-footer/basic-footer';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { IFooter } from '@data-access/interfaces/theme.interface';
import { ThemeOptionStore } from '@core/state/theme-option.store';

@Component({
  selector: 'app-footer',
  templateUrl: './footer.html',
  styleUrls: ['./footer.scss'],
  imports: [BasicFooter, AsyncPipe],
})
export class Footer {
  readonly footer = input<IFooter>();

  themeOption$: Observable<IOption> = toObservable(inject(ThemeOptionStore).themeOptions) as Observable<IOption>;
}
