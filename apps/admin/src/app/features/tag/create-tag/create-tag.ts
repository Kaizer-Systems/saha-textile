import { Component, input } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormTag } from '../form-tag/form-tag';

@Component({
	selector: 'app-create-tag',
	templateUrl: './create-tag.html',
	styleUrls: ['./create-tag.scss'],
	imports: [PageWrapper, FormTag],
})
export class CreateTag {
	readonly tagType = input<string | null>('product');
}
