import { Component, afterNextRender, ElementRef, inject, Injector, input, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { Button } from '@shared/ui/button/button';
import { SearchSuggest } from '@shared/ui/search-suggest/search-suggest';

@Component({
	selector: 'app-search',
	templateUrl: './search.html',
	styleUrls: ['./search.scss'],
	imports: [ReactiveFormsModule, Button, TranslocoModule, SearchSuggest],
})
export class Search {
	private router = inject(Router);
	private injector = inject(Injector);

	readonly style = input<string>('basic');
	private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

	public term = new FormControl<string | null>('');
	public show: boolean = false;

	/** Opens the results page for these words, or for what is typed. */
	redirectToSearch(words?: string) {
		const search = (words ?? this.term.value ?? '').trim();
		this.show = false;
		void this.router.navigate(['/search'], { queryParams: { search: search || null } });
	}

	toggleSearchBox() {
		this.show = !this.show;
		// The bar opens ready to type.
		if (this.show) afterNextRender(() => this.field()?.nativeElement.focus(), { injector: this.injector });
	}
}
