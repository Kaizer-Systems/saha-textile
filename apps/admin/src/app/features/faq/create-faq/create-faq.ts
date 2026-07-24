import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';

import { FormFaq } from '../form-faq/form-faq';

@Component({
	selector: 'app-create-faq',
	templateUrl: './create-faq.html',
	styleUrls: ['./create-faq.scss'],
	imports: [PageWrapper, FormFaq],
})
export class CreateFaq {}
