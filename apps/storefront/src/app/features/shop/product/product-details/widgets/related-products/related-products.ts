import { Component, computed, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { ProductBox } from '@shared/ui/product-box/product-box';
import { Title } from '@shared/ui/title/title';
import { injectRelatedProductsData } from '@data-access/queries/product.queries';
import { IProduct } from '@data-access/interfaces/product.interface';

@Component({
  selector: 'app-related-products',
  templateUrl: './related-products.html',
  styleUrls: ['./related-products.scss'],
  imports: [Title, ProductBox],
})
export class RelatedProducts {
  private readonly relatedQuery = injectRelatedProductsData();
  relatedProduct$: Observable<IProduct[]> = toObservable(
    computed(() => this.relatedQuery.data() ?? []),
  );

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
