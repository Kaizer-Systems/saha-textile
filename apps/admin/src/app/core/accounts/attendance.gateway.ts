import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { runtimeConfig } from '@core/config/runtime-config';

import type {
	Attendance,
	AttendanceDay,
	AttendanceMonthGrid,
	DayChange,
	LeaveAsk,
	MyAttendance,
} from '@saha-textile/contracts';
import type { Observable } from 'rxjs';

export const ATTENDANCE_KEYS = {
	all: ['attendance'] as const,
	me: ['attendance', 'me'] as const,
	myMonth: (month: string) => ['attendance', 'me', month] as const,
	stores: ['attendance', 'stores'] as const,
	grid: (month: string, locationId: string) => ['attendance', 'grid', month, locationId] as const,
	pending: ['attendance', 'pending'] as const,
};

/** Attendance day by day (brief 26 AT1-AT3). */
@Injectable({ providedIn: 'root' })
export class AttendanceGateway {
	private readonly http = inject(HttpClient);
	private readonly api = (path: string) => `${runtimeConfig.apiUrl}/admin/attendance/${path}`;
	private readonly dayPath = (employeeId: string, day: string) =>
		`days/${encodeURIComponent(employeeId)}/${encodeURIComponent(day)}`;

	me(): Observable<MyAttendance> {
		return this.http.get<MyAttendance>(this.api('me'));
	}

	markIn(): Observable<AttendanceDay> {
		return this.http.post<AttendanceDay>(this.api('me/in'), {});
	}

	markOut(): Observable<AttendanceDay> {
		return this.http.post<AttendanceDay>(this.api('me/out'), {});
	}

	myMonth(month: string): Observable<AttendanceDay[]> {
		return this.http.get<AttendanceDay[]>(this.api(`me/${month}`));
	}

	askLeave(ask: LeaveAsk): Observable<AttendanceDay[]> {
		return this.http.post<AttendanceDay[]>(this.api('me/leave'), ask);
	}

	stores(): Observable<{ id: string; name: string }[]> {
		return this.http.get<{ id: string; name: string }[]>(this.api('stores'));
	}

	grid(month: string, locationId: string): Observable<AttendanceMonthGrid> {
		return this.http.get<AttendanceMonthGrid>(this.api('grid'), { params: { month, locationId } });
	}

	change(employeeId: string, day: string, change: DayChange): Observable<AttendanceDay> {
		return this.http.put<AttendanceDay>(this.api(this.dayPath(employeeId, day)), change);
	}

	pending(): Observable<AttendanceDay[]> {
		return this.http.get<AttendanceDay[]>(this.api('pending'));
	}

	decide(employeeId: string, day: string, approve: boolean): Observable<AttendanceDay> {
		return this.http.post<AttendanceDay>(
			this.api(`${this.dayPath(employeeId, day)}/${approve ? 'approve' : 'reject'}`),
			{},
		);
	}

	lock(month: string): Observable<Attendance> {
		return this.http.post<Attendance>(this.api(`lock/${month}`), {});
	}
}
