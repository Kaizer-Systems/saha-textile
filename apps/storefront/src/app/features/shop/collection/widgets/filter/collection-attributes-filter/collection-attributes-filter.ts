import { Component, inject, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { IFacetValue } from '@data-access/interfaces/catalog.interface';
import { Params } from '@data-access/interfaces/core.interface';

/**
 * One facet section (e.g. Fabric) driven by the Nitro route's disjunctive facet
 * block. Renders each value + its live count and toggles it in the grouped
 * `attribute` query param — `fabric:Silk,Cotton|color:Red` — which `toCatalogParams`
 * expands back into per-facet route params. Server-side filtering: a tick just
 * changes the URL and re-queries; it never filters the on-hand cards.
 */
@Component({
	selector: 'app-collection-attributes-filter',
	imports: [],
	templateUrl: './collection-attributes-filter.html',
	styleUrls: ['./collection-attributes-filter.scss'],
})
export class CollectionAttributes {
	private route = inject(ActivatedRoute);
	private router = inject(Router);

	readonly facetKey = input<string>();
	readonly values = input<IFacetValue[]>([]);
	readonly filter = input<Params>();

	/** Parse the grouped `attribute` param into { facetKey: [values] }. */
	private parse(): Record<string, string[]> {
		const raw = this.filter()?.['attribute'];
		const out: Record<string, string[]> = {};
		if (raw) {
			for (const grp of String(raw).split('|')) {
				const [k, vals] = grp.split(':');
				if (k && vals) out[k] = vals.split(',');
			}
		}
		return out;
	}

	private serialize(map: Record<string, string[]>): string | null {
		const parts = Object.entries(map)
			.filter(([, v]) => v.length)
			.map(([k, v]) => `${k}:${v.join(',')}`);
		return parts.length ? parts.join('|') : null;
	}

	checked(value: string): boolean {
		return (this.parse()[this.facetKey()!] ?? []).includes(value);
	}

	applyFilter(event: Event) {
		const target = event.target as HTMLInputElement;
		const val = target.value;
		const key = this.facetKey()!;
		const map = this.parse();
		const arr = map[key] ?? [];
		if (target.checked) {
			if (!arr.includes(val)) arr.push(val);
		} else {
			const i = arr.indexOf(val);
			if (i > -1) arr.splice(i, 1);
		}
		map[key] = arr;

		void this.router.navigate([], {
			relativeTo: this.route,
			queryParams: { attribute: this.serialize(map), page: 1 }, // reset to page 1 on any filter change
			queryParamsHandling: 'merge',
			skipLocationChange: false,
		});
	}
}
