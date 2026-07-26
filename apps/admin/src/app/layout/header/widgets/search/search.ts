import { Component, ElementRef, Renderer2, inject, viewChild } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { IMenu } from '@data-access/interfaces/menu.interface';
import { NavService } from '@data-access/services/nav.service';
import * as data from '@shared/data/menu';
import { ClickOutsideDirective } from '@shared/directives/out-side-directive';

@Component({
	selector: 'app-search',
	templateUrl: './search.html',
	styleUrls: ['./search.scss'],
	imports: [ReactiveFormsModule, FormsModule, ClickOutsideDirective, RouterModule, TranslocoModule],
})
export class Search {
	navServices = inject(NavService);
	private renderer = inject(Renderer2);

	public menuItems: IMenu[];
	public items: IMenu[] = data.menu;

	public searchResult: boolean = false;
	public searchResultEmpty: boolean = false;
	public text: string;
	public open = false;

	readonly toggleButton = viewChild<ElementRef>('toggleButton');
	readonly menu = viewChild<ElementRef>('menu');
	readonly dropdownContainer = viewChild<ElementRef>('dropdownContainer');

	closeSearch() {
		this.navServices.search = false;
	}

	openDropDown(text: string) {
		text && (this.searchResult = !this.searchResult);
		var element = document.getElementsByTagName('body')[0];
		element.classList.toggle('overlay-search');
	}

	searchTerm(term?: string) {
		// if (!term) return (this.menuItems = []);
		if (term) {
			this.addFix();
			let items: IMenu[] = [];
			term = term.toLowerCase();
			this.items.filter((menuItems) => {
				if (!menuItems?.title) return false;

				if (menuItems.title.toLowerCase().includes(term!) && menuItems.type === 'link') {
					items.push(menuItems);
				}
				if (!menuItems.children) return false;
				menuItems.children.filter((subItems: IMenu) => {
					if (subItems.title?.toLowerCase().includes(term!) && subItems.type === 'link') {
						subItems.icon = menuItems.icon;
						items.push(subItems);
					}
					if (!subItems.children) return false;
					subItems.children.filter((suSubItems: IMenu) => {
						if (suSubItems.title?.toLowerCase().includes(term!)) {
							suSubItems.icon = menuItems.icon;
							items.push(suSubItems);
						}
					});
					return items;
				});
				return (this.checkSearchResultEmpty(items), (this.menuItems = items));
			});
		} else {
			this.removeFix();
			return (this.menuItems = []);
		}
		return this.menuItems;
	}

	checkSearchResultEmpty(items: IMenu[]) {
		if (!items.length) this.searchResultEmpty = true;
		else this.searchResultEmpty = false;
	}

	addFix() {
		this.searchResult = true;
		document.getElementsByTagName('body')[0].classList.add('overlay-search');
	}

	removeFix() {
		this.searchResult = false;
		this.text = '';
		document.getElementsByTagName('body')[0].classList.remove('overlay-search');
	}

	clickOutside(): void {
		this.searchResult = false;
	}
}
