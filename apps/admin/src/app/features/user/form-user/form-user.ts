import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2Module } from 'ng-select2-component';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AdminUsersGateway, type AdminUserRoleSummary } from '@core/admin-users/admin-users.gateway';
import { AdminAuthGateway } from '@core/auth/auth-gateway';
import {
	injectAdminUsersQuery,
	injectAdminUserAuthorityQuery,
	injectRolesForInviteQuery,
} from '@data-access/queries/admin-users.queries';
import { HasPermissionDirective } from '@shared/directives/has-permission.directive';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';

@Component({
	selector: 'app-form-user',
	templateUrl: './form-user.html',
	styleUrls: ['./form-user.scss'],
	imports: [ReactiveFormsModule, FormFields, Select2Module, Button, TranslocoModule, HasPermissionDirective],
})
export class FormAdminUser {
	private readonly route = inject(ActivatedRoute);
	private readonly router = inject(Router);
	private readonly formBuilder = inject(FormBuilder);
	private readonly gateway = inject(AdminUsersGateway);
	private readonly authGateway = inject(AdminAuthGateway);
	private readonly queryClient = injectQueryClient();

	readonly type = input<string>(undefined);

	private readonly userId = signal<string | null>(null);
	private readonly authorityQuery = injectAdminUserAuthorityQuery(() => this.userId());
	private readonly usersQuery = injectAdminUsersQuery(() => ({}));
	private readonly rolesQuery = injectRolesForInviteQuery();

	readonly coarseRoles = [
		{ label: 'Staff', value: 'staff' },
		{ label: 'Admin', value: 'admin' },
	];

	readonly assignedRoles = computed<AdminUserRoleSummary[]>(() => this.authorityQuery.data()?.roles ?? []);

	readonly assignableRoleOptions = computed(() => {
		const assigned = new Set(this.assignedRoles().map((role) => role.roleId));
		return (this.rolesQuery.data()?.items ?? [])
			.filter((role) => !assigned.has(role.id))
			.map((role) => ({ label: role.label, value: role.id }));
	});

	public form: FormGroup;
	public roleAssignForm: FormGroup;
	public isBrowser: boolean;

	private readonly inviteMutation = injectMutation(() => ({
		mutationFn: (vars: { email: string; role: 'staff' | 'admin' }) =>
			lastValueFrom(this.authGateway.createInvite(vars)),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-users'] });
			void this.router.navigateByUrl('/admin-user');
		},
	}));

	private readonly statusMutation = injectMutation(() => ({
		mutationFn: (vars: { userId: string; status: 'active' | 'disabled' }) =>
			lastValueFrom(this.gateway.setStatus(vars.userId, { status: vars.status })),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-users'] });
			void this.queryClient.invalidateQueries({ queryKey: ['admin-user-authority', this.userId()] });
		},
	}));

	private readonly assignRoleMutation = injectMutation(() => ({
		mutationFn: (vars: { userId: string; roleId: string }) =>
			lastValueFrom(this.gateway.assignRole(vars.userId, vars.roleId)),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-user-authority', this.userId()] });
			this.roleAssignForm.reset({ roleId: null });
		},
	}));

	private readonly revokeRoleMutation = injectMutation(() => ({
		mutationFn: (vars: { userId: string; roleId: string }) =>
			lastValueFrom(this.gateway.revokeRole(vars.userId, vars.roleId)),
		onSuccess: () => {
			void this.queryClient.invalidateQueries({ queryKey: ['admin-user-authority', this.userId()] });
		},
	}));

	constructor() {
		const platformId = inject(PLATFORM_ID);
		this.isBrowser = isPlatformBrowser(platformId);

		this.form = this.formBuilder.group({
			email: new FormControl('', [Validators.required, Validators.email]),
			role: new FormControl('staff', [Validators.required]),
			status: new FormControl(true),
		});

		this.roleAssignForm = this.formBuilder.group({
			roleId: new FormControl(null, [Validators.required]),
		});

		effect(
			() => {
				const id = this.route.snapshot.paramMap.get('id');
				if (id) {
					this.userId.set(id);
				}
			},
			{ allowSignalWrites: true },
		);

		effect(() => {
			if (this.type() === 'edit') {
				const authority = this.authorityQuery.data();
				const users = this.usersQuery.data();
				const user = users?.items.find((u) => u.id === this.userId());

				if (authority && user) {
					this.form.patchValue({
						email: user.email,
						role: user.role,
						status: user.status === 'active',
					});
					this.form.get('email')?.disable();
					this.form.get('role')?.disable();
				}
			}
		});
	}

	submit() {
		this.form.markAllAsTouched();

		if (!this.form.valid) return;

		if (this.type() === 'create') {
			const email = this.form.get('email')?.value as string;
			const role = this.form.get('role')?.value as 'staff' | 'admin';
			this.inviteMutation.mutate({ email, role });
		} else if (this.type() === 'edit') {
			const id = this.userId();
			if (!id) return;
			const status: 'active' | 'disabled' = this.form.get('status')?.value ? 'active' : 'disabled';
			this.statusMutation.mutate({ userId: id, status });
		}
	}

	assignRole() {
		this.roleAssignForm.markAllAsTouched();
		if (!this.roleAssignForm.valid) return;
		const id = this.userId();
		const roleId = this.roleAssignForm.get('roleId')?.value as string | null;
		if (!id || !roleId) return;
		this.assignRoleMutation.mutate({ userId: id, roleId });
	}

	revokeRole(roleId: string) {
		const id = this.userId();
		if (!id) return;
		this.revokeRoleMutation.mutate({ userId: id, roleId });
	}
}
