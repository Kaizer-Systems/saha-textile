import { Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

@Component({
	selector: 'app-sidebar-menu-skeleton',
	templateUrl: './sidebar-menu-skeleton.html',
	styleUrls: ['./sidebar-menu-skeleton.scss'],
	imports: [TranslocoModule],
})
export class SidebarMenuSkeleton {
	readonly loading = input<boolean>(false);

	public skeletonItems = Array.from({ length: 20 }, (_, index) => index);
}
