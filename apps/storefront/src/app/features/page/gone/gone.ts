import { Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

@Component({
	selector: 'app-gone',
	templateUrl: './gone.html',
	styleUrls: ['./gone.scss'],
	imports: [Breadcrumb, Button, TranslocoModule, ReactiveFormsModule],
})
export class Gone {
	private router = inject(Router);

	public search = new FormControl('', { nonNullable: true });

	public breadcrumb = translatedBreadcrumb('page_gone_title');

	back() {
		void this.router.navigateByUrl('/');
	}

	searchProduct() {
		const term = this.search.value.trim();
		void this.router.navigate(['/search'], { queryParams: term ? { search: term } : {} });
	}

	collections() {
		void this.router.navigateByUrl('/collections');
	}
}
