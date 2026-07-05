import { Directive, ElementRef, HostListener, inject } from '@angular/core';

@Directive({
	selector: 'input[numbersOnly]',
	standalone: true,
})
export class NumberDirective {
	private _el = inject(ElementRef);

	@HostListener('input', ['$event']) onInputChange(event: Event) {
		const initalValue = this._el.nativeElement.value;
		this._el.nativeElement.value = initalValue.replace(/[^0-9]*/g, '');
		if (initalValue !== this._el.nativeElement.value) {
			event.stopPropagation();
		}
	}
}
