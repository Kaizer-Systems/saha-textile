import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormFaq } from '../form-faq/form-faq';

@Component({
	selector: 'app-edit-faq',
	templateUrl: './edit-faq.html',
	styleUrls: ['./edit-faq.scss'],
	imports: [PageWrapper, FormFaq],
})
export class EditFaq {}
