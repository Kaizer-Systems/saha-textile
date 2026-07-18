import { Component, inject, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { Button } from '@shared/ui/button/button';

@Component({
	selector: 'app-search',
	templateUrl: './search.html',
	styleUrls: ['./search.scss'],
	imports: [ReactiveFormsModule, Button, TranslocoModule],
})
export class Search {
	private route = inject(ActivatedRoute);
	private router = inject(Router);

	readonly style = input<string>('basic');

	public term = new FormControl();
	public show: boolean = false;

	redirectToSearch() {
		void this.router.navigate(['/search'], {
			relativeTo: this.route,
			queryParams: {
				category: null,
				search: this.term.value ? this.term.value : null,
			},
			queryParamsHandling: 'merge', // preserve the existing query params in the route
			skipLocationChange: false, // do trigger navigation
		});
	}

	toggleSearchBox() {
		this.show = !this.show;
	}
}
