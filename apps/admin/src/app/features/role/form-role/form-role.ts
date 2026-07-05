import { Component, inject, input } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators, FormArray, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';

import { TranslateModule } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import { switchMap, map, takeUntil } from 'rxjs/operators';

import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { RoleService } from '@data-access/services/role.service';
import { Permissions } from '../permissions/permissions';

@Component({
	selector: 'app-form-role',
	templateUrl: './form-role.html',
	styleUrls: ['./form-role.scss'],
	imports: [ReactiveFormsModule, FormFields, Permissions, Button, TranslateModule],
})
export class FormRole {
	private roleService = inject(RoleService);
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);

	readonly type = input<String>(undefined);

	public form: FormGroup;
	public permissions: number[] = [];
	public id: number;

	private destroy$ = new Subject<void>();

	constructor() {
		this.form = this.formBuilder.group({
			name: new FormControl('', [Validators.required]),
			permissions: new FormControl('', [Validators.required]),
		});
	}

	get permissionControl(): FormArray {
		return this.form.get('permissions') as FormArray;
	}

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => {
					if (!params['id']) return of();
					return this.roleService
						.getRoles()
						.pipe(map((res) => res.data.find((role) => role.id == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((role) => {
				this.id = role?.id!;
				let permissions = role?.permissions!.map((permission) => permission?.id);
				this.permissions = permissions!;
				this.form.patchValue({
					name: role?.name,
					permissions: permissions,
				});
			});
	}

	setPermissions(permissions: number[]) {
		if (Array.isArray(permissions)) {
			this.form.controls['permissions'].setValue(permissions);
		}
	}

	submit() {
		this.form.markAllAsTouched();

		if (this.form.valid) {
			// Create/update have no backend yet — just navigate.
			void this.router.navigateByUrl('/role');
		}
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}
