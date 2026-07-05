import { AsyncPipe } from '@angular/common';
import { Component, inject, input, viewChild } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { toObservable } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { Select2Data, Select2Module } from 'ng-select2-component';
import { Observable } from 'rxjs';

import { SettingStore } from '@core/state/setting.store';
import { Button } from '@shared/ui/button/button';
import { FormFields } from '@shared/ui/form-fields/form-fields';
import { DeleteModal } from '@shared/ui/modal/delete-modal/delete-modal';
import { IValues } from '@data-access/interfaces/setting.interface';
import { IShipping, IShippingRule } from '@data-access/interfaces/shipping.interface';

@Component({
  selector: 'app-form-shipping',
  templateUrl: './form-shipping.html',
  styleUrls: ['./form-shipping.scss'],
  imports: [ReactiveFormsModule, FormFields, Select2Module, Button, DeleteModal, TranslateModule, AsyncPipe],
})
export class FormShipping {
  private modalService = inject(NgbModal);
  private route = inject(ActivatedRoute);
  private formBuilder = inject(FormBuilder);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly data = input<IShippingRule>(undefined);

  readonly DeleteModal = viewChild<DeleteModal>('deleteModal');
  setting$: Observable<IValues | null> = toObservable(inject(SettingStore).setting);

  public form: FormGroup;
  public shipping_id: number;

  public ruleType: Select2Data = [
    {
      value: 'base_on_price',
      label: 'Base on Price',
    },
    {
      value: 'base_on_weight',
      label: 'Base on Weight',
    },
  ];

  public shippingType: Select2Data = [
    {
      value: 'percentage',
      label: 'Percentage',
    },
    {
      value: 'free',
      label: 'Free',
    },
    {
      value: 'fixed',
      label: 'Fixed',
    },
  ];

  constructor() {
    this.shipping_id = this.route.snapshot.params['id'];
    this.form = this.formBuilder.group({
      name: new FormControl('', [Validators.required]),
      shipping_id: new FormControl(this.shipping_id, []),
      rule_type: new FormControl('', [Validators.required]),
      min: new FormControl('', [Validators.required]),
      max: new FormControl('', [Validators.required]),
      shipping_type: new FormControl('fixed', [Validators.required]),
      amount: new FormControl('', [Validators.required]),
      status: new FormControl(1),
    });
  }

  ngOnChanges() {
    const dataValue = this.data();
    if (dataValue) {
      this.form.patchValue({
        name: dataValue?.name,
        shipping_id: dataValue?.shipping_id,
        rule_type: dataValue?.rule_type,
        min: dataValue?.min,
        max: dataValue?.max,
        shipping_type: dataValue?.shipping_type,
        amount: dataValue?.amount,
        status: dataValue?.status,
      });
    }

    this.form.controls['shipping_type'].valueChanges.subscribe(data => {
      if (data === 'free') {
        this.form.removeControl('amount');
      } else {
        const dataVal = this.data();
        this.form.setControl('amount', new FormControl(dataVal ? dataVal.amount : '', [Validators.required]));
      }
    });
  }

  selectShippingType() {
    this.form.get('amount')?.setValue('');
  }

  submit() {
    this.form.markAllAsTouched();

    if (this.form.valid) {
      // Create/update have no backend yet — just close the modal.
      this.modalService.dismissAll();
    }
  }

  delete(_actionType: string, _data: IShipping) {
    // Mock: delete has no backend yet.
  }
}
