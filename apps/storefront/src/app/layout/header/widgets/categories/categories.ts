import { Component, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { IOption } from '@data-access/interfaces/theme-option.interface';
import { Button } from '@shared/ui/button/button';
import { Categories } from '@shared/ui/categories/categories';

@Component({
  selector: 'app-header-categories',
  templateUrl: './categories.html',
  styleUrls: ['./categories.scss'],
  imports: [Button, Categories, TranslateModule],
})
export class CategoriesBlock {
  readonly data = input<IOption | null>();
}
