import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormEvent } from './form-event/form-event';

/** New launch, new sale, or an existing event: one page around the one form. */
@Component({
	selector: 'app-edit-event',
	template: `
		<app-page-wrapper [title]="title()"><app-form-event /></app-page-wrapper>
	`,
	imports: [PageWrapper, FormEvent],
})
export class EditEvent {
	private readonly params = toSignal(inject(ActivatedRoute).params, { initialValue: {} as Record<string, string> });
	readonly title = () => {
		const params = this.params();
		if (params['id']) return 'edit_event';
		return params['type'] === 'launch' ? 'new_launch' : 'new_sale';
	};
}
