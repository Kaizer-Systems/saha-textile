import { Component, inject } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { Alert } from '@shared/ui/alert/alert';
import { Button } from '@shared/ui/button/button';

/**
 * Step 2 of admin password recovery — **repurposed, not an OTP login**.
 *
 * ## What this screen is now
 *
 * It accepts the single-use recovery token from the email and hands it to the reset step.
 * Nothing more. It calls no authentication endpoint, verifies nothing itself, and cannot
 * produce a session. It exists because the recovery email's link and a manually pasted
 * token should converge on the same reset form — an operator reading mail on a phone but
 * working on a laptop needs the paste path.
 *
 * ## What it deliberately is not
 *
 * The template shipped this as an OTP verification screen: five digits, "validate", and a
 * jump to update-password on the strength of a code. Admin OTP login is `DO NOT BUILD AS
 * LOGIN` under the owner lock, so that reading is gone. Concretely:
 *
 * - the field is a free-form token, not a fixed-length numeric code, because the canonical
 *   recovery credential is a long random token — a six-digit box would invite someone to
 *   wire it to an OTP challenge later;
 * - `AuthStore` is not injected at all, so this component has no way to reach a login,
 *   OTP-verify or session method even by accident;
 * - the token is passed onward as a query parameter and never written to the store or to
 *   browser storage.
 *
 * The token is still verified server-side on submission of the next step. This screen is
 * transport, not a gate: pasting rubbish here fails at the reset endpoint, as it should.
 */
@Component({
	selector: 'app-otp',
	templateUrl: './otp.html',
	styleUrls: ['./otp.scss'],
	imports: [Alert, ReactiveFormsModule, RouterLink, Button, TranslocoModule],
})
export class Otp {
	router = inject(Router);
	formBuilder = inject(FormBuilder);

	public form: FormGroup;

	constructor() {
		this.form = this.formBuilder.group({
			token: new FormControl('', [Validators.required, Validators.minLength(8)]),
		});
	}

	async submit(): Promise<void> {
		this.form.markAllAsTouched();
		if (!this.form.valid) return;

		// Carried in the URL so this screen and the emailed link reach the reset form the
		// same way. It is a single-use token the server consumes on the next request, and it
		// is never persisted client-side.
		await this.router.navigate(['/auth/update-password'], {
			queryParams: { token: (this.form.value.token as string).trim() },
		});
	}
}
