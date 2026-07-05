import { Component } from '@angular/core';

import { PageWrapper } from '@layout/page-wrapper/page-wrapper';
import { FormBlog } from '../form-blog/form-blog';

@Component({
	selector: 'app-create-blog',
	templateUrl: './create-blog.html',
	styleUrls: ['./create-blog.scss'],
	imports: [PageWrapper, FormBlog],
})
export class CreateBlog {}
