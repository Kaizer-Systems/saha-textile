import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { map } from 'rxjs';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormSearchTerm } from '../form-search-term/form-search-term';

@Component({
	selector: 'app-edit-search-term',
	template: `
		<app-page-wrapper [title]="'edit_search_word'"><app-form-search-term [id]="id()" /></app-page-wrapper>
	`,
	imports: [PageWrapper, FormSearchTerm],
})
export class EditSearchTerm {
	readonly id = toSignal(inject(ActivatedRoute).params.pipe(map((params) => String(params['id']))));
}
