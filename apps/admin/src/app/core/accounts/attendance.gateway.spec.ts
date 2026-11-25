import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { runtimeConfig } from '@core/config/runtime-config';

import { ATTENDANCE_KEYS, AttendanceGateway } from './attendance.gateway';

/** Attendance day by day (brief 26 AT1-AT3): a person's own days, a store's month, changes and the lock. */

const setUp = () => {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
	return { gateway: TestBed.inject(AttendanceGateway), http: TestBed.inject(HttpTestingController) };
};
const api = `${runtimeConfig.apiUrl}/admin/attendance`;

describe('the attendance gateway', () => {
	it('keys everything under attendance: the person’s own, their month, the stores, a store’s month, the waiting', () => {
		expect(ATTENDANCE_KEYS.all).toEqual(['attendance']);
		expect(ATTENDANCE_KEYS.me).toEqual(['attendance', 'me']);
		expect(ATTENDANCE_KEYS.myMonth('2026-11')).toEqual(['attendance', 'me', '2026-11']);
		expect(ATTENDANCE_KEYS.stores).toEqual(['attendance', 'stores']);
		expect(ATTENDANCE_KEYS.grid('2026-11', 'loc_b')).toEqual(['attendance', 'grid', '2026-11', 'loc_b']);
		expect(ATTENDANCE_KEYS.pending).toEqual(['attendance', 'pending']);
	});

	it('reads the person’s own day and month, marks them in and out, and asks for leave', () => {
		const { gateway, http } = setUp();
		gateway.me().subscribe();
		http.expectOne((req) => req.method === 'GET' && req.urlWithParams === `${api}/me`).flush({});
		gateway.markIn().subscribe();
		const markIn = http.expectOne((req) => req.method === 'POST' && req.urlWithParams === `${api}/me/in`);
		expect(markIn.request.body).toEqual({});
		markIn.flush({});
		gateway.markOut().subscribe();
		const markOut = http.expectOne((req) => req.method === 'POST' && req.urlWithParams === `${api}/me/out`);
		expect(markOut.request.body).toEqual({});
		markOut.flush({});
		gateway.myMonth('2026-11').subscribe();
		http.expectOne((req) => req.method === 'GET' && req.urlWithParams === `${api}/me/2026-11`).flush([]);
		const ask = { leaveKey: 'CL', from: '2026-12-01', to: '2026-12-02', half: false, reason: 'Wedding' };
		gateway.askLeave(ask).subscribe();
		const leave = http.expectOne((req) => req.method === 'POST' && req.urlWithParams === `${api}/me/leave`);
		expect(leave.request.body).toEqual(ask);
		leave.flush([]);
		http.verify();
	});

	it('reads the stores in charge and a store’s month', () => {
		const { gateway, http } = setUp();
		gateway.stores().subscribe();
		http.expectOne((req) => req.method === 'GET' && req.urlWithParams === `${api}/stores`).flush([]);
		gateway.grid('2026-11', 'loc b').subscribe();
		http.expectOne(
			(req) => req.method === 'GET' && req.urlWithParams === `${api}/grid?month=2026-11&locationId=loc%20b`,
		).flush({});
		http.verify();
	});

	it('changes a day, lists and decides the waiting changes, and locks a month', () => {
		const { gateway, http } = setUp();
		const change = {
			status: 'present' as const,
			leaveKey: null,
			inAt: '2026-11-25T04:35:00.000Z',
			outAt: null,
			reason: 'Forgot to mark in',
		};
		gateway.change('emp/1', '2026-11-25', change).subscribe();
		const put = http.expectOne(
			(req) => req.method === 'PUT' && req.urlWithParams === `${api}/days/emp%2F1/2026-11-25`,
		);
		expect(put.request.body).toEqual(change);
		put.flush({});
		gateway.pending().subscribe();
		http.expectOne((req) => req.method === 'GET' && req.urlWithParams === `${api}/pending`).flush([]);
		gateway.decide('emp_1', '2026-11-25', true).subscribe();
		const yes = http.expectOne(
			(req) => req.method === 'POST' && req.urlWithParams === `${api}/days/emp_1/2026-11-25/approve`,
		);
		expect(yes.request.body).toEqual({});
		yes.flush({});
		gateway.decide('emp_1', '2026-11-25', false).subscribe();
		http.expectOne(
			(req) => req.method === 'POST' && req.urlWithParams === `${api}/days/emp_1/2026-11-25/reject`,
		).flush({});
		gateway.lock('2026-11').subscribe();
		const lock = http.expectOne((req) => req.method === 'POST' && req.urlWithParams === `${api}/lock/2026-11`);
		expect(lock.request.body).toEqual({});
		lock.flush({});
		http.verify();
	});
});
