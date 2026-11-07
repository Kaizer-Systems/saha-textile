import { Component, OnChanges, inject, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { Params } from '@data-access/interfaces/core.interface';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';

@Component({
	selector: 'app-collection-filter',
	templateUrl: './collection-filter.html',
	styleUrls: ['./collection-filter.scss'],
	imports: [TitleCasePipe, TranslocoModule],
})
export class CollectionFilter implements OnChanges {
	private route = inject(ActivatedRoute);
	private router = inject(Router);

	readonly filter = input<Params>();
	public filters: string[];

	public filtersObj: { [key: string]: string[] } = {
		category: [],
		tag: [],
		rating: [],
		price: [],
		attribute: [],
	};

	ngOnChanges() {
		this.filtersObj = {
			category: this.splitFilter('category'),
			tag: this.splitFilter('tag'),
			rating: this.splitFilter('rating'),
			price: this.splitFilter('price'),
			attribute: this.attributeTicks(),
		};

		this.filters = this.mergeFilters();
	}

	remove(tag: string) {
		Object.keys(this.filtersObj).forEach((key) => {
			this.filtersObj[key] = this.filtersObj[key].filter((val: string) => {
				if (key === 'rating') {
					return val !== tag.replace(/^rating /, '');
				}
				if (key === 'attribute') return val.split(':')[1] !== tag;
				return val !== tag;
			});
		});

		this.filters = this.mergeFilters();

		const params: Params = {};
		Object.keys(this.filtersObj).forEach((key) => {
			params[key] = this.filtersObj[key].length ? this.filtersObj[key].join(',') : null;
		});
		params['attribute'] = this.serializeAttributes();

		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: params,
			queryParamsHandling: 'merge',
			skipLocationChange: false,
		});
	}

	clear() {
		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: null,
			skipLocationChange: false,
		});
	}

	/** `fabric:silk,cotton|color:red` as one `code:term` entry per tick. */
	private attributeTicks(): string[] {
		const raw = String(this.filter()?.['attribute'] ?? '');
		return raw
			.split('|')
			.filter(Boolean)
			.flatMap((group) => {
				const [code, terms = ''] = group.split(':');
				return terms.split(',').map((term) => `${code}:${term}`);
			});
	}

	private serializeAttributes(): string | null {
		const groups = new Map<string, string[]>();
		for (const tick of this.filtersObj['attribute']) {
			const [code = '', term = ''] = tick.split(':');
			groups.set(code, [...(groups.get(code) ?? []), term]);
		}
		const parts = [...groups].map(([code, terms]) => `${code}:${terms.join(',')}`);
		return parts.length ? parts.join('|') : null;
	}

	private splitFilter(filterKey: keyof Params): string[] {
		const filter = this.filter();
		return filter && filter[filterKey] ? filter[filterKey].split(',') : [];
	}

	private mergeFilters(): string[] {
		return [
			...this.filtersObj['category'],
			...this.filtersObj['tag'],
			...this.filtersObj['rating'].map((val) => (val.startsWith('rating ') ? val : `rating ${val}`)),
			...this.filtersObj['price'],
			...this.filtersObj['attribute'].map((val) => val.split(':')[1]!),
		];
	}
}
