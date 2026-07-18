import { isPlatformBrowser, AsyncPipe } from '@angular/common';
import { Component, PLATFORM_ID, computed, inject, input } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';
import { Select2Data, Select2Module } from 'ng-select2-component';
import { Subject, of } from 'rxjs';
import { map, switchMap, takeUntil } from 'rxjs/operators';

import { injectRolesQuery } from '@data-access/queries/role.queries';
import { UserService } from '@data-access/services/user.service';
import * as data from '@shared/data/country-code';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { CustomValidators } from '@shared/validators/password-match';

@Component({
	selector: 'app-form-user',
	templateUrl: './form-user.html',
	styleUrls: ['./form-user.scss'],
	imports: [ReactiveFormsModule, FormFields, Select2Module, Button, TranslocoModule, AsyncPipe],
})
export class FormUser {
	private route = inject(ActivatedRoute);
	private router = inject(Router);
	private formBuilder = inject(FormBuilder);
	private userService = inject(UserService);

	readonly type = input<string>(undefined);

	private readonly rolesQuery = injectRolesQuery(() => ({}));
	readonly roles = computed(
		() =>
			this.rolesQuery
				.data()
				?.data.map((role) => ({ label: role.name, value: role.id }))
				.filter((v) => v.label !== 'admin' && v.label !== 'vendor') ?? [],
	);

	public form: FormGroup;
	public id: number;
	public codes = data.countryCodes;

	private destroy$ = new Subject<void>();
	public isBrowser: boolean;

	constructor() {
		const platformId = inject(PLATFORM_ID);

		this.isBrowser = isPlatformBrowser(platformId);
		this.form = this.formBuilder.group(
			{
				name: new FormControl('', [Validators.required]),
				email: new FormControl('', [Validators.required, Validators.email]),
				phone: new FormControl('', [Validators.required, Validators.pattern(/^[0-9]*$/)]),
				country_code: new FormControl('91', [Validators.required]),
				role_id: new FormControl('', [Validators.required]),
				password: new FormControl('', [Validators.required]),
				password_confirmation: new FormControl('', [Validators.required]),
				status: new FormControl(1),
			},
			{
				validator: CustomValidators.MatchValidator('password', 'password_confirmation'),
			},
		);
	}

	get passwordMatchError() {
		return this.form.getError('mismatch') && this.form.get('password_confirmation')?.touched;
	}

	ngOnInit() {
		this.route.params
			.pipe(
				switchMap((params) => {
					if (!params['id']) return of();
					return this.userService
						.getUsers()
						.pipe(map((res) => res.data.find((user) => user.id == params['id']) ?? null));
				}),
				takeUntil(this.destroy$),
			)
			.subscribe((user) => {
				this.id = user?.id!;
				this.form.patchValue({
					name: user?.name,
					email: user?.email,
					phone: user?.phone,
					country_code: user?.country_code,
					role_id: user?.role ? user?.role.id : null,
					status: user?.status,
				});
			});
	}

	submit() {
		this.form.markAllAsTouched();

		if (this.type() == 'edit' && this.id) {
			this.form.removeControl('password');
			this.form.removeControl('password_confirmation');
		}

		if (this.form.valid) {
			// Create/update have no backend yet — just navigate back to the list.
			void this.router.navigateByUrl('/user');
		}
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}
}
