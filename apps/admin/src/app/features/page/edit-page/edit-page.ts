import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormPage } from '../form-page/form-page';

@Component({
	selector: 'app-edit-page',
	templateUrl: './edit-page.html',
	styleUrls: ['./edit-page.scss'],
	imports: [PageWrapper, FormPage],
})
export class EditPage {}
