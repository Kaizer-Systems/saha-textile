import { AsyncPipe, NgClass } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { IProduct, IProductModel } from '@data-access/interfaces/product.interface';
import { ProductState } from '@data-access/states/product.state';

@Component({
  selector: 'app-image-link',
  templateUrl: './image-link.html',
  styleUrls: ['./image-link.scss'],
  imports: [NgClass, RouterLink, AsyncPipe],
})
export class ImageLink {
  product$: Observable<IProductModel> = inject(Store).select(ProductState.product);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly image = input<any>();
  readonly link = input<string>();
  readonly bgImage = input<boolean>();
  readonly class = input<string>();

  constructor() {}

  getProductSlug(id: number, products: IProduct[]) {
    let product = products.find(product => product.id === id);
    return product ? product.slug : null;
  }
}
