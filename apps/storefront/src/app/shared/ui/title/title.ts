import { Component, input } from '@angular/core';

@Component({
	selector: 'app-title',
	templateUrl: './title.html',
	styleUrls: ['./title.scss'],
	imports: [],
})
export class Title {
	readonly class = input<string>('title');
	readonly svg = input<string>('leaf');
	readonly style = input<string>();
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly title = input<string>();
	// TODO: Skipped for migration because:
	//  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
	//  and migrating would break narrowing currently.
	readonly description = input<string>();
}
