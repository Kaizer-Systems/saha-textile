import { Component, computed, input } from '@angular/core';

import { Blog } from '@features/themes/widgets/blog/blog';
import { blogSliderNav } from '@shared/data/owl-carousel';
import { Title } from '@shared/ui/title/title';

import { type ResolvedPageSectionView, sectionContainer } from '../page-builder.types';

/** Blog posts (today's featured blog row): the chosen posts, or the newest live ones with sticky posts first. */
@Component({
	selector: 'app-pb-blog-posts',
	imports: [Blog, Title],
	template: `
		<div [class]="container()">
			<app-title
				[title]="section().title ?? ''"
				[description]="section().description ?? ''"
			/>
			<app-blog
				[blogIds]="section().sourceIds"
				[sliderOption]="slider"
			/>
		</div>
	`,
})
export class PbBlogPosts {
	readonly section = input.required<ResolvedPageSectionView>();
	readonly slider = blogSliderNav;
	readonly container = computed(() => sectionContainer(this.section()));
}
