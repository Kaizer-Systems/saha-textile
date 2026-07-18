import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { SettingStore } from '@core/state/setting.store';
import { Params } from '@data-access/interfaces/core.interface';
import { IPoint } from '@data-access/interfaces/point.interface';
import { IValues } from '@data-access/interfaces/setting.interface';
import { injectPointTransactionsQuery } from '@data-access/queries/point.queries';
import { CurrencySymbolPipe } from '@shared/pipes/currency-symbol.pipe';
import { TitleCasePipe } from '@shared/pipes/title-case.pipe';
import { NoData } from '@shared/ui/no-data/no-data';
import { Pagination } from '@shared/ui/pagination/pagination';

@Component({
	selector: 'app-point',
	templateUrl: './point.html',
	styleUrls: ['./point.scss'],
	providers: [CurrencySymbolPipe],
	imports: [Pagination, NoData, AsyncPipe, DatePipe, TitleCasePipe, CurrencySymbolPipe, TranslocoModule],
})
export class Point {
	private settingStore = inject(SettingStore);
	setting$: Observable<IValues> = toObservable(this.settingStore.setting) as Observable<IValues>;

	public filter = signal<Params>({
		page: 1, // Current page number
		paginate: 10, // Display per page,
	});

	private readonly pointQuery = injectPointTransactionsQuery(() => this.filter());
	// Template reads via optional chaining, so emit the raw query data (undefined
	// until loaded) rather than a partial IPoint placeholder.
	point$: Observable<IPoint | undefined> = toObservable(computed(() => this.pointQuery.data()));

	setPaginate(page: number) {
		this.filter.update((f) => ({ ...f, page }));
	}
}
