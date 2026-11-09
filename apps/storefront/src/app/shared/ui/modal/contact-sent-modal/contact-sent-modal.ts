import { Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { Button } from '../../button/button';

/**
 * "Thank you" after a Contact Us message: a copy of the install-help popup under its own name
 * (stores brief), so neither has to serve the other's wording.
 */
@Component({
	selector: 'app-contact-sent-modal',
	templateUrl: './contact-sent-modal.html',
	imports: [Button, TranslocoModule],
})
export class ContactSentModal {
	readonly modal = inject(NgbActiveModal);
}
