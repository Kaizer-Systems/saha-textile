import { Component, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { IOption } from '@data-access/interfaces/theme-option.interface';

@Component({
  selector: 'app-call',
  templateUrl: './call.html',
  styleUrls: ['./call.scss'],
  imports: [TranslateModule],
})
export class Call {
  readonly data = input<IOption | null>();
  readonly style = input<string>('basic');
}
