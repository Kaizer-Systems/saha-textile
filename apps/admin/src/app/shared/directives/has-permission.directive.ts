import { Directive, effect, inject, input, TemplateRef, ViewContainerRef } from '@angular/core';

import { AccountStore } from '@core/state/account.store';

@Directive({
	selector: '[hasPermission]',
	standalone: true,
})
export class HasPermissionDirective {
	private templateRef = inject<TemplateRef<string>>(TemplateRef);
	private viewContainerRef = inject(ViewContainerRef);
	private accountStore = inject(AccountStore);

	readonly permission = input<string | string[]>(undefined, { alias: 'hasPermission' });

	public permissions: string[] = [];

	private isViewCreated = false;

	constructor() {
		effect(() => {
			this.permissions = this.accountStore.permissions()?.map((value) => value?.name);
			this.checkPermissions();
		});
	}

	private checkPermissions() {
		const permission = this.permission();
		if ((!Array.isArray(permission) && this.permissions?.includes(permission)) || !permission) {
			if (!this.isViewCreated) {
				this.viewContainerRef.createEmbeddedView(this.templateRef);
				this.isViewCreated = true;
			}
		} else if (
			Array.isArray(permission) &&
			permission?.length &&
			permission.every((action) => this.permissions?.includes(action))
		) {
			if (!this.isViewCreated) {
				this.viewContainerRef.createEmbeddedView(this.templateRef);
				this.isViewCreated = true;
			}
		} else {
			if (this.isViewCreated) {
				this.viewContainerRef.clear();
				this.isViewCreated = false;
			}
		}
	}
}
