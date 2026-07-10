import { AsyncPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { IProduct } from '@data-access/interfaces/product.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { ThemeOptionStore } from '@core/state/theme-option.store';
import { ProductBanner } from '../widgets/product-banner/product-banner';
import { StoreInformation } from '../widgets/store-information/store-information';
import { TrendingProducts } from '../widgets/trending-products/trending-products';

@Component({
  selector: 'app-product-details-sidebar',
  templateUrl: './sidebar.html',
  styleUrls: ['./sidebar.scss'],
  imports: [StoreInformation, TrendingProducts, ProductBanner, AsyncPipe],
})
export class ProductSidebar {
  themeOptions$: Observable<IOption> = toObservable(inject(ThemeOptionStore).themeOptions) as Observable<IOption>;

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly product = input<IProduct>();
}
