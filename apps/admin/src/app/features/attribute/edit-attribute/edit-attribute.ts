import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormAttribute } from '../form-attribute/form-attribute';

@Component({
	selector: 'app-edit-attribute',
	templateUrl: './edit-attribute.html',
	styleUrls: ['./edit-attribute.scss'],
	imports: [PageWrapper, FormAttribute],
})
export class EditAttribute {}
