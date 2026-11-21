import { Component, input, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

/**
 * The measurement row (owner, 21 Nov 2026, product page brief P7, render 3): the tape, the form's name, a status chip
 * ("Needed · 5 fields", then "Added") and Add / Edit, which opens the whole form in the shop's pop-up. Used on the
 * product page when a form has more than four fields, and always in sets and from the buy bar.
 */
@Component({
	selector: 'app-measurement-row',
	templateUrl: './measurement-row.html',
	imports: [TranslocoModule],
})
export class MeasurementRow {
	readonly title = input.required<string>();
	readonly fieldCount = input(0);
	/** True once every measurement the form asks for is in and valid. */
	readonly added = input(false);
	readonly open = output<void>();
}
