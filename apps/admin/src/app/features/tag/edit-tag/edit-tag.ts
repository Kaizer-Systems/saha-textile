import { Component, input } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormTag } from '../form-tag/form-tag';

@Component({
	selector: 'app-edit-tag',
	templateUrl: './edit-tag.html',
	styleUrls: ['./edit-tag.scss'],
	imports: [PageWrapper, FormTag],
})
export class EditTag {
	readonly tagType = input<string | null>('product');
}
