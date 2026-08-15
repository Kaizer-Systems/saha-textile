import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2Module } from 'ng-select2-component';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AdminRolesGateway } from '@core/admin-roles/admin-roles.gateway';
import { injectRoleQuery } from '@data-access/queries/role.queries';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';

import { Permissions } from '../permissions/permissions';

/** Stable machine key from a display label (`Catalog Editor` → `catalog-editor`). */
function slugifyRoleKey(label: string): string {
	const slug = label
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (!slug) return 'role';
	return /^[a-z]/.test(slug) ? slug : `r-${slug}`;
}

function asPermissionCodes(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => {
			if (typeof entry === 'string') return entry;
			if (entry && typeof entry === 'object' && 'code' in entry && typeof entry.code === 'string') {
				return entry.code;
			}
			if (entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string') {
				return entry.name;
			}
			return null;
		})
		.filter((code): code is string => !!code);
}

@Component({
	selector: 'app-form-role',
	templateUrl: './form-role.html',
	styleUrls: ['./form-role.scss'],
	imports: [ReactiveFormsModule, FormFields, Permissions, Button, TranslocoModule, Select2Module],
})
export class FormRole {
	private readonly gateway = inject(AdminRolesGateway);
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly formBuilder = inject(FormBuilder);
	private readonly queryClient = injectQueryClient();
	readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

	readonly type = input<string | undefined>(undefined);

	private readonly roleId = signal<string | null>(null);
	private readonly roleQuery = injectRoleQuery(() => this.roleId());

	public form: FormGroup;
	public permissions: string[] = [];
	public id: string | null = null;

	readonly baseRoleOptions = [
		{ label: 'Staff', value: 'staff' },
		{ label: 'Admin', value: 'admin' },
	];

	private readonly createMutation = injectMutation(() => ({
		mutationFn: (vars: {
			key: string;
			label: string;
			baseRole: 'staff' | 'admin';
			permissions: string[];
			description?: string | null;
		}) => lastValueFrom(this.gateway.create(vars)),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
			void this.router.navigateByUrl('/role');
		},
	}));

	private readonly updateMutation = injectMutation(() => ({
		mutationFn: (vars: { roleId: string; label: string; permissions: string[]; description?: string | null }) =>
			lastValueFrom(
				this.gateway.update(vars.roleId, {
					label: vars.label,
					permissions: vars.permissions,
					description: vars.description,
				}),
			),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-roles'] });
			void this.router.navigateByUrl('/role');
		},
	}));

	constructor() {
		this.form = this.formBuilder.group({
			name: new FormControl('', [Validators.required]),
			key: new FormControl('', [Validators.required, Validators.pattern(/^[a-z][a-z0-9-]*$/)]),
			baseRole: new FormControl<'staff' | 'admin'>('staff', [Validators.required]),
			description: new FormControl<string | null>(null),
			permissions: new FormControl<string[]>([], [Validators.required]),
		});

		effect(
			() => {
				const id = this.route.snapshot.paramMap.get('id');
				this.roleId.set(this.type() === 'edit' ? id : null);
			},
			{ allowSignalWrites: true },
		);

		effect(() => {
			const role = this.roleQuery.data();
			if (!role || this.type() !== 'edit') return;

			if (role.isSystem || role.system_reserve === '1') {
				void this.router.navigateByUrl('/role');
				return;
			}

			this.id = String(role.id);
			const codes = asPermissionCodes(role.permissions);
			this.permissions = codes;
			this.form.patchValue({
				name: role.name,
				key: role.key ?? '',
				baseRole: role.baseRole ?? 'staff',
				description: role.description ?? null,
				permissions: codes,
			});
			this.form.controls['key'].disable();
			this.form.controls['baseRole'].disable();
		});
	}

	setPermissions(permissions: string[]) {
		if (Array.isArray(permissions)) {
			this.permissions = permissions;
			this.form.controls['permissions'].setValue(permissions);
			this.form.controls['permissions'].markAsTouched();
		}
	}

	onNameBlur() {
		if (this.type() === 'edit') return;
		const keyControl = this.form.controls['key'];
		if (keyControl.dirty && keyControl.value) return;
		const name = String(this.form.controls['name'].value ?? '');
		keyControl.setValue(slugifyRoleKey(name));
	}

	submit() {
		this.form.markAllAsTouched();
		if (!this.form.valid) return;

		const raw = this.form.getRawValue() as {
			name: string;
			key: string;
			baseRole: 'staff' | 'admin';
			description: string | null;
			permissions: string[];
		};
		const permissions = asPermissionCodes(raw.permissions);
		if (!permissions.length) {
			this.form.controls['permissions'].setErrors({ required: true });
			return;
		}

		if (this.type() === 'edit' && this.id) {
			this.updateMutation.mutate({
				roleId: this.id,
				label: raw.name,
				permissions,
				description: raw.description || null,
			});
			return;
		}

		this.createMutation.mutate({
			key: raw.key || slugifyRoleKey(raw.name),
			label: raw.name,
			baseRole: raw.baseRole,
			permissions,
			description: raw.description || null,
		});
	}
}
