import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormAttribute } from '../form-attribute/form-attribute';

@Component({
	selector: 'app-create-attribute',
	templateUrl: './create-attribute.html',
	styleUrls: ['./create-attribute.scss'],
	imports: [PageWrapper, FormAttribute],
})
export class CreateAttribute {}
