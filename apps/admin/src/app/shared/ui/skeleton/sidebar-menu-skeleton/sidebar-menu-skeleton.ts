import { Component, input } from '@angular/core';

import { TranslateModule } from '@ngx-translate/core';

@Component({
	selector: 'app-sidebar-menu-skeleton',
	templateUrl: './sidebar-menu-skeleton.html',
	styleUrls: ['./sidebar-menu-skeleton.scss'],
	imports: [TranslateModule],
})
export class SidebarMenuSkeleton {
	readonly loading = input<boolean>(false);

	public skeletonItems = Array.from({ length: 20 }, (_, index) => index);
}
