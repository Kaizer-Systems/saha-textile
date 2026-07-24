import { AsyncPipe } from '@angular/common';
import { Component, DOCUMENT, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Observable } from 'rxjs';

import { SettingStore } from '@core/state/setting.store';
import { ILanguage, IValues } from '@data-access/interfaces/setting.interface';
import { NavService } from '@data-access/services/nav.service';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';

import { Languages } from './widgets/languages/languages';
import { Mode } from './widgets/mode/mode';
import { Notification } from './widgets/notification/notification';
import { Profile } from './widgets/profile/profile';
import { Search } from './widgets/search/search';

@Component({
	selector: 'app-header',
	templateUrl: './header.html',
	styleUrls: ['./header.scss'],
	imports: [
		RouterModule,
		Search,
		HasPermissionDirective,
		Languages,
		Notification,
		Mode,
		Profile,
		TranslocoModule,
		AsyncPipe,
	],
})
export class Header {
	private document = inject<Document>(DOCUMENT);
	navServices = inject(NavService);

	setting$: Observable<IValues | null> = toObservable(inject(SettingStore).setting);

	public active: boolean = false;
	public profileOpen: boolean = false;
	public open: boolean = false;

	public languages: ILanguage[] = [
		{
			language: 'English',
			code: 'en',
			icon: 'us',
		},
		{
			language: 'Français',
			code: 'fr',
			icon: 'fr',
		},
	];

	public selectedLanguage: ILanguage = {
		language: 'English',
		code: 'en',
		icon: 'us',
	};

	constructor() {
		const document = this.document;

		this.setting$.subscribe((setting) => {
			document.body.classList.add(setting?.general?.mode!);
		});
	}

	sidebarToggle() {
		this.navServices.collapseSidebar = !this.navServices.collapseSidebar;
	}

	clickHeaderOnMobile() {
		this.navServices.search = true;
	}
}
