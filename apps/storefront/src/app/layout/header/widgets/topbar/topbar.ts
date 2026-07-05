import { Component, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { IOption } from '@data-access/interfaces/theme-option.interface';
import { Currency } from '../currency/currency';
import { Language } from '../language/language';
import { Notice } from '../notice/notice';

@Component({
  selector: 'app-topbar',
  templateUrl: './topbar.html',
  styleUrls: ['./topbar.scss'],
  imports: [Notice, Language, Currency, TranslateModule],
})
export class Topbar {
  readonly data = input<IOption | null>();
}
