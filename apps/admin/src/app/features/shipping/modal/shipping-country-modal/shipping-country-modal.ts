import { AsyncPipe } from '@angular/common';
import { Component, TemplateRef, computed, inject, viewChild } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Select2Data, Select2Module } from 'ng-select2-component';
import { Observable } from 'rxjs';

import { toObservable } from '@angular/core/rxjs-interop';
import { injectCountriesQuery } from '@data-access/queries/country.queries';
import { Button } from '@shared/ui/button/button';
import { IShipping } from '@data-access/interfaces/shipping.interface';

@Component({
  selector: 'app-shipping-country-modal',
  templateUrl: './shipping-country-modal.html',
  styleUrls: ['./shipping-country-modal.scss'],
  imports: [ReactiveFormsModule, Select2Module, Button, TranslateModule, AsyncPipe],
})
export class ShippingCountryModal {
  private modalService = inject(NgbModal);
  private formBuilder = inject(FormBuilder);

  private readonly countriesQuery = injectCountriesQuery();
  countries$: Observable<Select2Data> = toObservable(
    computed(() => this.countriesQuery.data()?.map((country) => ({ label: country.name, value: country.id })) ?? []),
  );

  public closeResult: string;
  public modalOpen: boolean = false;
  public form: FormGroup;
  public data: IShipping | null;

  readonly CountryShippingModal = viewChild<TemplateRef<string>>('countryShippingModal');

  constructor() {
    this.form = this.formBuilder.group({
      country_id: new FormControl('', [Validators.required]),
      status: new FormControl(1),
    });
  }

  async openModal(data?: IShipping) {
    this.modalOpen = true;
    this.data = null;
    if (data) {
      this.data = data;
      this.form.patchValue({ country_id: data?.country_id, status: data?.status });
    }
    this.modalService
      .open(this.CountryShippingModal(), {
        ariaLabelledBy: 'Shipping-country-Modal',
        centered: true,
        windowClass: 'theme-modal',
      })
      .result.then(
        result => {
          `Result ${result}`;
        },
        reason => {
          this.closeResult = `Dismissed ${this.getDismissReason(reason)}`;
        },
      );
  }

  private getDismissReason(reason: ModalDismissReasons): string {
    if (reason === ModalDismissReasons.ESC) {
      return 'by pressing ESC';
    } else if (reason === ModalDismissReasons.BACKDROP_CLICK) {
      return 'by clicking on a backdrop';
    } else {
      return `with: ${reason}`;
    }
  }

  submit() {
    this.form.markAllAsTouched();

    if (this.form.valid) {
      // Create/update have no backend yet — just close the modal.
      this.form.controls['country_id'].reset();
      this.modalService.dismissAll();
    }
  }

  ngOnDestroy() {
    if (this.modalOpen) {
      this.modalService.dismissAll();
    }
  }
}
