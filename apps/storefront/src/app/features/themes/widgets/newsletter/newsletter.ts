
import { Component, input } from '@angular/core';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';

import { TranslateModule } from '@ngx-translate/core';

import { Button } from '@shared/ui/button/button';
import { INewsLetter } from '@data-access/interfaces/theme.interface';

@Component({
  selector: 'app-newsletter',
  templateUrl: './newsletter.html',
  styleUrls: ['./newsletter.scss'],
  imports: [ReactiveFormsModule, FormsModule, Button, TranslateModule],
})
export class Newsletter {
  readonly data = input<INewsLetter | null>();
  readonly style = input<string>('basic');
}
