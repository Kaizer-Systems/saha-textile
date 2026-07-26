import { Component, input } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

@Component({
	selector: 'app-form-fields',
	templateUrl: './form-fields.html',
	styleUrls: ['./form-fields.scss'],
	imports: [TranslocoModule],
})
export class FormFields {
	readonly class = input<string>('mb-4 row align-items-center g-2');
	readonly label = input<string | undefined>();
	readonly labelClass = input<string>('form-label-title col-sm-2 mb-0');
	readonly gridClass = input<string>('col-sm-10');
	readonly for = input<string | undefined>();
	readonly required = input<boolean | undefined>();
}
