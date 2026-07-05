import { Component, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

import { IProduct } from '@data-access/interfaces/product.interface';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';

@Component({
  selector: 'app-product-information',
  templateUrl: './product-information.html',
  styleUrls: ['./product-information.scss'],
  imports: [TitleCasePipe, TranslateModule],
})
export class ProductInformation {
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly product = input<IProduct | null>();
}
