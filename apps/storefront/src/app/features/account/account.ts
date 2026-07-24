import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { LoaderStore } from '@core/state/loader.store';
import { Breadcrumb } from '@shared/ui/breadcrumb/breadcrumb';
import { Button } from '@shared/ui/button/button';
import { Loader } from '@shared/ui/loader/loader';
import { translatedBreadcrumb } from '@shared/util/breadcrumb-i18n';

import { Sidebar } from './sidebar/sidebar';

@Component({
	selector: 'app-account',
	templateUrl: './account.html',
	styleUrls: ['./account.scss'],
	imports: [Breadcrumb, Sidebar, Loader, Button, RouterOutlet, AsyncPipe, TranslocoModule],
})
export class Account {
	private loaderStore = inject(LoaderStore);

	loadingStatus$: Observable<boolean> = toObservable(this.loaderStore.status);

	public open: boolean = false;
	public breadcrumb = translatedBreadcrumb('dashboard');

	openMenu(value: boolean) {
		this.open = value;
	}
}
