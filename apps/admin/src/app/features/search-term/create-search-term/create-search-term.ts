import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormSearchTerm } from '../form-search-term/form-search-term';

@Component({
	selector: 'app-create-search-term',
	template: `
		<app-page-wrapper [title]="'add_search_word'"><app-form-search-term /></app-page-wrapper>
	`,
	imports: [PageWrapper, FormSearchTerm],
})
export class CreateSearchTerm {}
