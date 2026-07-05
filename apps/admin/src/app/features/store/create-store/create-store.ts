import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormStore } from '../form-store/form-store';

@Component({
	selector: 'app-create-store',
	templateUrl: './create-store.html',
	styleUrls: ['./create-store.scss'],
	imports: [PageWrapper, FormStore],
})
export class CreateStore {}
