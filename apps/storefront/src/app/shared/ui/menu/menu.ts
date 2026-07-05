import { DatePipe, NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';

import * as data from '@shared/data/menu';
import { IBlog, IBlogModel } from '@data-access/interfaces/blog.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { BlogState } from '@data-access/states/blog.state';
import { ProductState } from '@data-access/states/product.state';
import { IMenu } from '@data-access/interfaces/menu.interface';
import { ProductBox } from '../product-box/product-box';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.html',
  styleUrls: ['./menu.scss'],
  imports: [NgTemplateOutlet, NgClass, RouterLink, ProductBox, DatePipe, TranslateModule],
})
export class Menu {
  product$: Observable<IProduct[]> = inject(Store).select(ProductState.dealProducts);
  blog$: Observable<IBlogModel> = inject(Store).select(BlogState.blog);

  public menu: IMenu[] = data.menu;
  public products: IProduct[];
  public blogs: IBlog[];

  constructor() {
    this.product$.subscribe(product => {
      if (product) {
        this.products = product.slice(0, 2);
      }
    });

    this.blog$.subscribe(blog => {
      if (blog && blog.data) {
        this.blogs = blog.data.slice(0, 2);
      }
    });
  }

  toggle(menu: IMenu) {
    if (!menu.active) {
      this.menu.forEach(item => {
        if (this.menu.includes(menu)) {
          item.active = false;
        }
      });
    }
    menu.active = !menu.active;
  }
}
