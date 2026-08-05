/**
 * @file attendanceController.js
 * @description 연구실 내부 IP 검증 및 시각 비교 연산을 통한 출퇴근 비즈니스 로직 제어 레이어입니다.
 */

const AttendanceModel = require('../models/attendanceModel');
const { success, fail } = require('../utils/response'); // 팀 표준 공통 응답 유틸 (success/fail)

// 연구실의 보안 화이트리스트 공인 IP 주소를 환경 변수에서 로드합니다.
const LAB_IP = process.env.LAB_WHITE_LIST_IP || '123.45.67.89';

// attendance_status ENUM 전체 값. 목록 status 필터 및 관리자 수정 시 화이트리스트 검증에 사용합니다.
const VALID_ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'leave', 'half_leave'];

const AttendanceController = {
  /**
   * @function checkIn
   * @description [인증 유저 전용] 연구실 IP 및 당일 중복 여부를 확인하고, 오전 09:00 기준으로 지각 여부를 판별해 출근을 기록합니다.
   */
  checkIn: async (req, res) => {
    try {
      const userId = req.user.id; // authMiddleware가 주입해준 토큰 디코딩 정보 활용

      // [알고리즘 1단계] 리버스 프록시 환경을 고려하여 사용자의 실제 공인 IP를 정밀하게 추출합니다.
      const clientIp = req.headers['x-forwarded-for']
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : req.ip;

      // 대리 출석 우회를 막기 위해 IP 화이트리스트 대조 검증을 수행합니다.
      // Node/Express가 로컬 접속 시 반환할 수 있는 표기(::1, 127.0.0.1, IPv4-mapped IPv6 ::ffff:127.x.x.x)를 모두 허용합니다.
      const isLocalhost =
        clientIp === '::1' ||
        clientIp === '127.0.0.1' ||
        clientIp === '::ffff:127.0.0.1' ||
        (typeof clientIp === 'string' && clientIp.startsWith('::ffff:127.'));

      if (clientIp !== LAB_IP && !isLocalhost) {
        return fail(res, 403, '연구실 외부 네트워크에서는 출근 체크가 불가능합니다.');
      }

      // [알고리즘 2단계] 복합 무결성(UNIQUE) 충돌을 방지하기 위해 오늘 이미 출근했는지 선제 체크합니다.
      const alreadyCheckedIn = await AttendanceModel.findTodayRecord(userId);
      if (alreadyCheckedIn) {
        return fail(res, 409, '오늘 이미 출근 체크를 완료하셨습니다.');
      }

      // [알고리즘 3단계] 타임스탬프 시각 비교 연산을 통한 지각(late) 여부 판별 알고리즘
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();

      // 연구실 출근 데드라인 기준 규정 지정 (오전 09시 00분)
      let attendanceStatus = 'present';
      if (currentHour > 9 || (currentHour === 9 && currentMinute > 0)) {
        attendanceStatus = 'late'; // 09:01 부터는 지각(late) 상태 매핑 적용
      }

      // [알고리즘 4단계] Model 레이어를 호출하여 DB 원자적 삽입 단행
      const record = await AttendanceModel.createCheckIn(userId, attendanceStatus);

      const successMessage = attendanceStatus === 'late'
        ? '지각으로 출근 처리되었습니다. 열공하세요!'
        : '정상적으로 출근 체크 완료되었습니다. 좋은 하루 되세요!';

      return success(res, { attendance: record }, successMessage, 201);

    } catch (error) {
      console.error('출근 체크인 비즈니스 로직 예외 에러:', error);
      return fail(res, 500, '서버 오류로 출근 처리에 실패했습니다.');
    }
  },

  /**
   * @function checkOut
   * @description [인증 유저 전용] 당일 출근한 레코드를 찾아 퇴근 시각(check_out)을 마운트합니다.
   */
  checkOut: async (req, res) => {
    try {
      const userId = req.user.id;

      // [알고리즘 1단계] 오늘 날짜로 생성된 출근 마스터 레코드가 존재하는지 검증합니다.
      const todayRecord = await AttendanceModel.findTodayRecord(userId);
      if (!todayRecord) {
        return fail(res, 404, '오늘 출근한 기록이 존재하지 않아 퇴근 처리가 불가능합니다.');
      }

      // [알고리즘 2단계] 이미 퇴근 도장이 찍혀있는지 정합성을 검사합니다.
      if (todayRecord.check_out) {
        return fail(res, 400, '오늘 이미 퇴근 처리가 완료된 상태입니다.');
      }

      // [알고리즘 3단계] 대상 레코드의 PK를 던져서 퇴근 시간을 실시간 업데이트(TIMESTAMP) 합니다.
      const updatedRecord = await AttendanceModel.updateCheckOut(todayRecord.id);

      return success(res, { attendance: updatedRecord }, '정상적으로 퇴근 체크 완료되었습니다. 고생하셨습니다!');

    } catch (error) {
      console.error('퇴근 체크아웃 비즈니스 로직 예외 에러:', error);
      return fail(res, 500, '서버 오류로 퇴근 처리에 실패했습니다.');
    }
  },

  /**
   * @function listRecords
   * @description [인증 유저 전체] 출결 기록 목록을 신청자 이름(user_name)과 함께 조회합니다. 연구실 공용 출결 현황판이므로 role 구분 없이 열람 가능합니다.
   *
   * Query (모두 선택):
   *   - userId : 특정 유저의 기록만
   *   - date   : 특정 일자(YYYY-MM-DD)만
   *   - status : present/late/absent/leave/half_leave 중 하나
   */
  listRecords: async (req, res) => {
    try {
      const { userId, date, status } = req.query;

      // status가 주어진 경우에만 화이트리스트 검증. 비정상 값이면 400.
      if (status !== undefined && !VALID_ATTENDANCE_STATUSES.includes(status)) {
        return fail(res, 400, `유효하지 않은 상태 필터입니다. 허용 값: ${VALID_ATTENDANCE_STATUSES.join(', ')}.`);
      }

      const records = await AttendanceModel.findRecords({
        userId: userId || null,
        date: date || null,
        status: status || null,
      });
      return success(res, records);

    } catch (error) {
      console.error('출결 기록 목록 조회 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 출결 기록 조회에 실패했습니다.');
    }
  },

  /**
   * @function adminUpdateRecord
   * @description [관리자 전용] 특정 출결 기록의 status/check_in/check_out을 수정합니다. (라우터에서 requireRole 가드)
   *              전달된 필드만 반영하며, check_in/check_out에 빈 문자열/null을 주면 해당 시각을 NULL로 초기화합니다(예: 결석 처리).
   *
   * Body (모두 선택, 최소 1개 필요):
   *   - status    : attendance_status ENUM
   *   - checkIn   : ISO 타임스탬프 문자열 또는 null/"" (초기화)
   *   - checkOut  : ISO 타임스탬프 문자열 또는 null/"" (초기화)
   */
  adminUpdateRecord: async (req, res) => {
    try {
      const { id } = req.params;
      const { status, checkIn, checkOut } = req.body || {};

      // [1] 최소 1개 이상의 수정 대상 필드가 있어야 합니다.
      const hasStatus = status !== undefined;
      const hasCheckIn = checkIn !== undefined;
      const hasCheckOut = checkOut !== undefined;
      if (!hasStatus && !hasCheckIn && !hasCheckOut) {
        return fail(res, 400, '수정할 필드(status, checkIn, checkOut) 중 최소 하나는 전달해야 합니다.');
      }

      // [2] status 화이트리스트 검증
      if (hasStatus && !VALID_ATTENDANCE_STATUSES.includes(status)) {
        return fail(res, 400, `유효하지 않은 상태값입니다. 허용 값: ${VALID_ATTENDANCE_STATUSES.join(', ')}.`);
      }

      // [3] 대상 레코드 실존 확인
      const existing = await AttendanceModel.findRecordById(id);
      if (!existing) {
        return fail(res, 404, '존재하지 않는 출결 기록입니다.');
      }

      // [4] 전달된 필드만 정규화하여 부분 수정 객체 구성 (빈 문자열은 NULL로 취급하여 시각 초기화 허용)
      const fields = {};
      if (hasStatus) fields.status = status;
      if (hasCheckIn) fields.check_in = checkIn === '' ? null : checkIn;
      if (hasCheckOut) fields.check_out = checkOut === '' ? null : checkOut;

      const updated = await AttendanceModel.adminUpdateRecord(id, fields);
      return success(res, updated, '출결 기록이 수정되었습니다.');

    } catch (error) {
      console.error('출결 기록 관리자 수정 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 출결 기록 수정에 실패했습니다.');
    }
  }
};

module.exports = AttendanceController;
