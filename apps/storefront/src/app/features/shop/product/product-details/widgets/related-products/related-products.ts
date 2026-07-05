import { Component, inject, input } from '@angular/core';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { ProductBox } from '@shared/ui/product-box/product-box';
import { Title } from '@shared/ui/title/title';
import { IProduct } from '@data-access/interfaces/product.interface';
import { ProductState } from '@data-access/states/product.state';

@Component({
  selector: 'app-related-products',
  templateUrl: './related-products.html',
  styleUrls: ['./related-products.scss'],
  imports: [Title, ProductBox],
})
export class RelatedProducts {
  relatedProduct$: Observable<IProduct[]> = inject(Store).select(ProductState.relatedProducts);

  readonly product = input<IProduct | null>();

  public relatedproducts: IProduct[] = [];

  ngOnChanges() {
    const productValue = this.product();
    if (productValue?.related_products && Array.isArray(productValue?.related_products)) {
      this.relatedProduct$.subscribe(products => {
        this.relatedproducts = products.filter(product =>
          this.product()?.related_products?.includes(product?.id),
        );
      });
    }
  }
}
