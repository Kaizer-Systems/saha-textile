import { TitleCasePipe, AsyncPipe } from '@angular/common';
import { Component, Input, SimpleChanges, output } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { IModule } from '@data-access/interfaces/role.interface';
import { injectRoleModulesQuery } from '@data-access/queries/role.queries';

@Component({
	selector: 'app-permissions',
	templateUrl: './permissions.html',
	styleUrls: ['./permissions.scss'],
	imports: [TitleCasePipe, AsyncPipe],
})
export class Permissions {
	private roleModulesQuery = injectRoleModulesQuery();

	modules$: Observable<IModule[] | undefined> = toObservable(this.roleModulesQuery.data);

	// TODO: Skipped for migration because:
	//  Your application code writes to the input. This prevents migration.
	@Input() selectedPermission: string[] = [];

	readonly setPermissions = output<string[]>();

	ngOnChanges(changes: SimpleChanges) {
		const ids = changes['selectedPermission']?.currentValue as string[] | undefined;
		if (!ids) return;
		this.modules$.subscribe((modules) => {
			modules?.forEach((item) => {
				item.module_permissions.forEach((permission) => {
					const code = String(permission.permission_id);
					permission.isChecked = ids.includes(code);
				});
				this.updateCheckBoxStatus(item);
			});
		});
	}

	checkUncheckAll(event: Event, module: IModule) {
		const checked = (<HTMLInputElement>event.target).checked;
		module.module_permissions.forEach((item) => {
			item.isChecked = checked;
			this.addPermission(checked, String(item.permission_id), module);
		});
	}

	checkIndex(_event: Event, module: IModule) {
		module.module_permissions.forEach((item) => {
			item.isChecked = false;
			this.addPermission(false, String(item.permission_id), module);
		});
	}

	onPermissionChecked(event: Event, module: IModule) {
		const target = <HTMLInputElement>event.target;
		const code = String(target.value);
		const checked = target.checked;

		// Selecting a non-index action still requires the resource's `index` grant.
		if (checked) {
			module.module_permissions.forEach((item) => {
				if (item.name === 'index') {
					item.isChecked = true;
					this.addPermission(true, String(item.permission_id), module);
				}
			});
		}

		this.addPermission(checked, code, module);
	}

	addPermission(checked: boolean, value: string, module: IModule) {
		const index = this.selectedPermission.indexOf(value);
		if (checked) {
			if (index === -1) this.selectedPermission.push(value);
		} else {
			this.selectedPermission = this.selectedPermission.filter((id) => id !== value);
		}
		this.setPermissions.emit(this.selectedPermission);
		this.updateCheckBoxStatus(module);
	}

	updateCheckBoxStatus(module: IModule) {
		let count = 0;
		module.module_permissions.forEach((permission) => {
			if (this.selectedPermission.includes(String(permission.permission_id))) {
				count++;
			}
		});
		module.isChecked = module.module_permissions.length > 0 && module.module_permissions.length <= count;
	}
}
