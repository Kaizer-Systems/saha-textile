import { Component } from '@angular/core';

import { Tag } from '../../../tag/tag';

@Component({
	selector: 'app-blog-tag',
	templateUrl: './blog-tag.html',
	styleUrls: ['./blog-tag.scss'],
	imports: [Tag],
})
export class BlogTag {}
