import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormPage } from '../form-page/form-page';

@Component({
	selector: 'app-create-page',
	templateUrl: './create-page.html',
	styleUrls: ['./create-page.scss'],
	imports: [PageWrapper, FormPage],
})
export class CreatePage {}
