import { DatePipe, NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { IBlog, IBlogModel } from '@data-access/interfaces/blog.interface';
import { IMenu } from '@data-access/interfaces/menu.interface';
import { IProduct } from '@data-access/interfaces/product.interface';
import { injectBlogsQuery } from '@data-access/queries/blog.queries';
import { injectDealProductsQuery } from '@data-access/queries/product.queries';
import * as data from '@shared/data/menu';

import { ProductBox } from '../product-box/product-box';

@Component({
	selector: 'app-menu',
	templateUrl: './menu.html',
	styleUrls: ['./menu.scss'],
	imports: [NgTemplateOutlet, NgClass, RouterLink, ProductBox, DatePipe, TranslocoModule],
})
export class Menu {
	private readonly dealQuery = injectDealProductsQuery(() => ({ status: 1, paginate: 2 }));
	product$: Observable<IProduct[]> = toObservable(computed(() => this.dealQuery.data() ?? []));
	private readonly blogsQuery = injectBlogsQuery(() => ({ status: 1, paginate: 10 }));
	blog$: Observable<IBlogModel | undefined> = toObservable(computed(() => this.blogsQuery.data()));

	public menu: IMenu[] = data.menu;
	public products: IProduct[];
	public blogs: IBlog[];

	constructor() {
		this.product$.subscribe((product) => {
			if (product) {
				this.products = product.slice(0, 2);
			}
		});

		this.blog$.subscribe((blog) => {
			if (blog && blog.data) {
				this.blogs = blog.data.slice(0, 2);
			}
		});
	}

	toggle(menu: IMenu) {
		if (!menu.active) {
			this.menu.forEach((item) => {
				if (this.menu.includes(menu)) {
					item.active = false;
				}
			});
		}
		menu.active = !menu.active;
	}
}
