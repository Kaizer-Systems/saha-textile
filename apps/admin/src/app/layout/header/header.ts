import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { injectBrandQuery } from '@core/brand/brand.gateway';
import { NavService } from '@data-access/services/nav.service';
import { LocationChipComponent } from '@shared/components/location-chip/location-chip';
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
		LocationChipComponent,
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
	navServices = inject(NavService);

	readonly brand = injectBrandQuery();

	public active: boolean = false;
	public profileOpen: boolean = false;
	public open: boolean = false;

	sidebarToggle() {
		this.navServices.collapseSidebar = !this.navServices.collapseSidebar;
	}

	clickHeaderOnMobile() {
		this.navServices.search = true;
	}
}
