import { Directive, effect, inject, input, TemplateRef, ViewContainerRef } from '@angular/core';

import { AuthStore } from '@core/state/auth.store';

@Directive({
	selector: '[hasPermission]',
	standalone: true,
})
export class HasPermissionDirective {
	private templateRef = inject<TemplateRef<string>>(TemplateRef);
	private viewContainerRef = inject(ViewContainerRef);
	private authStore = inject(AuthStore);

	readonly permission = input<string | string[]>(undefined, { alias: 'hasPermission' });

	private isViewCreated = false;

	constructor() {
		effect(() => {
			// Re-run when live permissions change (login / resume / clear).
			void this.authStore.permissions();
			this.checkPermissions();
		});
	}

	private checkPermissions() {
		const permissions = this.authStore.permissions();
		const permission = this.permission();
		const allowed =
			!permission ||
			(!Array.isArray(permission) && permissions.includes(permission)) ||
			(Array.isArray(permission) &&
				permission.length > 0 &&
				permission.every((action) => permissions.includes(action)));

		if (allowed) {
			if (!this.isViewCreated) {
				this.viewContainerRef.createEmbeddedView(this.templateRef);
				this.isViewCreated = true;
			}
		} else if (this.isViewCreated) {
			this.viewContainerRef.clear();
			this.isViewCreated = false;
		}
	}
}
