import { AsyncPipe, isPlatformBrowser } from '@angular/common';
import { Component, HostListener, inject, PLATFORM_ID } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';

import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import { ProductAccordion } from './product-details/product-accordion/product-accordion';
import { ProductImages } from './product-details/product-images/product-images';
import { ProductSlider } from './product-details/product-slider/product-slider';
import { ProductSticky } from './product-details/product-sticky/product-sticky';
import { ProductThumbnail } from './product-details/product-thumbnail/product-thumbnail';
import { RelatedProducts } from './product-details/widgets/related-products/related-products';
import { StickyCheckout } from './product-details/widgets/sticky-checkout/sticky-checkout';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { IBreadcrumb } from '@data-access/interfaces/breadcrumb';
import { IProduct } from '@data-access/interfaces/product.interface';
import { IOption } from '@data-access/interfaces/theme-option.interface';
import { ProductState } from '@data-access/states/product.state';
import { ThemeOptionState } from '@data-access/states/theme-option.state';

@Component({
  selector: 'app-product',
  templateUrl: './product.html',
  styleUrls: ['./product.scss'],
  imports: [
    Breadcrumb,
    ProductThumbnail,
    ProductImages,
    ProductSlider,
    ProductSticky,
    ProductAccordion,
    RelatedProducts,
    StickyCheckout,
    AsyncPipe,
  ],
})
export class Product {
  private route = inject(ActivatedRoute);
  private meta = inject(Meta);
  private platformId = inject<Object>(PLATFORM_ID);

  product$: Observable<IProduct> = inject(Store).select(
    ProductState.selectedProduct,
  ) as Observable<IProduct>;
  themeOptions$: Observable<IOption> = inject(Store).select(
    ThemeOptionState.themeOptions,
  ) as Observable<IOption>;

  public breadcrumb: IBreadcrumb = {
    title: 'Product',
    items: [],
  };
  public layout: string = 'product_thumbnail';
  public product: IProduct;
  public isScrollActive = false;
  public isBrowser: boolean;

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.product$.subscribe(product => {
      if (product) {
        this.breadcrumb.items = [];
        this.breadcrumb.title = product.name;
        this.breadcrumb.items.push(
          { label: 'Product', active: true },
          { label: product.name, active: false },
        );
        this.product = product;
        product?.meta_title &&
          this.meta.updateTag({ property: 'og:title', content: product?.meta_title });
        product?.meta_description &&
          this.meta.updateTag({ property: 'og:description', content: product?.meta_description });
        product?.product_meta_image &&
          this.meta.updateTag({
            property: 'og:image',
            content: product?.product_meta_image.original_url,
          });
        product?.product_meta_image &&
          this.meta.updateTag({ property: 'og:image:width', content: '500' });
        product?.product_meta_image &&
          this.meta.updateTag({ property: 'og:image:height', content: '500' });
      }
    });

    // For Demo Purpose only
    this.route.queryParams.subscribe(params => {
      if (params['layout']) {
        this.layout = params['layout'];
      } else {
        // Get Product Layout
        this.themeOptions$.subscribe(option => {
          this.layout =
            option?.product && option?.product?.product_layout
              ? option?.product?.product_layout
              : 'product_thumbnail';
        });
      }
    });
  }

  @HostListener('window:scroll')
  onScroll() {
    if (this.isBrowser) {
      const button = document.querySelector('.scroll-button');
      if (button) {
        const buttonRect = button.getBoundingClientRect();
        if (buttonRect.bottom < window.innerHeight && buttonRect.bottom < 0) {
          this.isScrollActive = true;
          document.body.classList.add('stickyCart');
        } else {
          this.isScrollActive = false;
          document.body.classList.remove('stickyCart');
        }
      }
    }
  }

  ngOnDestroy() {
    if (this.isBrowser) {
      document.body.classList.remove('stickyCart');
    }
  }
}
