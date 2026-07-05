import { AsyncPipe, isPlatformBrowser } from '@angular/common';
import { Component, inject, PLATFORM_ID, TemplateRef, viewChild } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { ModalDismissReasons, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { TranslateModule } from '@ngx-translate/core';
import { Store } from '@ngxs/store';
import { Select2Data, Select2Module, Select2UpdateEvent } from 'ng-select2-component';
import { map, Observable } from 'rxjs';

import { CreateAddressAction, UpdateAddressAction } from '@data-access/actions/account.action';
import * as data from '@shared/data/country-code';
import { IUserAddress } from '@data-access/interfaces/user.interface';
import { CountryState } from '@data-access/states/country.state';
import { StateState } from '@data-access/states/state.state';
import { Button } from '../../button/button';

@Component({
  selector: 'address-modal',
  templateUrl: './address-modal.html',
  styleUrls: ['./address-modal.scss'],
  imports: [Button, ReactiveFormsModule, Select2Module, AsyncPipe, TranslateModule],
})
export class AddressModal {
  private modalService = inject(NgbModal);
  private platformId = inject<Object>(PLATFORM_ID);
  private store = inject(Store);
  private formBuilder = inject(FormBuilder);

  public form: FormGroup;
  public closeResult: string;
  public modalOpen: boolean = false;

  public states$: Observable<Select2Data>;
  public address: IUserAddress | null;
  public codes = data.countryCodes;
  public isBrowser: boolean;

  readonly AddressModal = viewChild<TemplateRef<string>>('addressModal');

  countries$: Observable<Select2Data> = inject(Store).select(CountryState.countries);

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.form = this.formBuilder.group({
      title: new FormControl('', [Validators.required]),
      street: new FormControl('', [Validators.required]),
      state_id: new FormControl('', [Validators.required]),
      country_id: new FormControl('', [Validators.required]),
      city: new FormControl('', [Validators.required]),
      pincode: new FormControl('', [Validators.required]),
      country_code: new FormControl('91', [Validators.required]),
      phone: new FormControl('', [Validators.required, Validators.pattern(/^[0-9]*$/)]),
    });
  }

  countryChange(data: Select2UpdateEvent) {
    if (data && data?.value) {
      this.states$ = this.store
        .select(StateState.states)
        .pipe(map(filterFn => filterFn(+data?.value)));
      if (!this.address) this.form.controls['state_id'].setValue('');
    } else {
      this.form.controls['state_id'].setValue('');
    }
  }

  async openModal(value?: IUserAddress) {
    if (isPlatformBrowser(this.platformId)) {
      this.modalOpen = true;
      this.patchForm(value);
      this.modalService
        .open(this.AddressModal(), {
          ariaLabelledBy: 'address-add-Modal',
          centered: true,
          windowClass: 'theme-modal modal-lg',
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

  patchForm(value?: IUserAddress) {
    if (value) {
      this.address = value;
      this.form.patchValue({
        user_id: value?.user_id,
        title: value?.title,
        street: value?.street,
        country_id: value?.country_id,
        state_id: value?.state_id,
        city: value?.city,
        pincode: value?.pincode,
        country_code: value?.country_code,
        phone: value?.phone,
      });
    } else {
      this.address = null;
      this.form.reset();
      this.form?.controls?.['country_code'].setValue('91');
    }
  }

  submit() {
    this.form.markAllAsTouched();

    let action = new CreateAddressAction(this.form.value);

    if (this.address) {
      action = new UpdateAddressAction(this.form.value, this.address.id);
    }

    if (this.form.valid) {
      this.store.dispatch(action).subscribe({
        complete: () => {
          this.form.reset();
          if (!this.address) {
            this.form?.controls?.['country_code'].setValue('91');
          }
        },
      });
    }
  }

  ngOnDestroy() {
    if (this.modalOpen) {
      this.modalService.dismissAll();
    }
  }
}
