/**
 * @file leaveController.js
 * @description 휴가 신청 기안 검증 및 관리자 결재 시 출결 테이블 자동 동기화를 제어하는 컨트롤러 레이어입니다.
 */

const LeaveModel = require('../models/leaveModel');
const { success, fail } = require('../utils/response'); // 팀 표준 공통 응답 유틸 (success/fail)

const LeaveController = {
  /**
   * @function requestLeave
   * @description [인증 유저] 사용자의 잔여 휴가 일수를 계산/검증한 뒤 신규 휴가 신청서를 'pending' 상태로 기안합니다.
   */
  requestLeave: async (req, res) => {
    try {
      const userId = req.user.id; // 토큰에서 디코딩된 유저 식별자
      const { leaveType, halfPeriod, startDate, endDate, reason } = req.body;

      // [알고리즘 1단계] 필수 서식 파라미터 유효성 검증
      if (!leaveType || !startDate || !endDate) {
        return fail(res, 400, '휴가 종류 및 시작/종료 일자는 필수 입력 항목입니다.');
      }

      if (leaveType === 'half' && !halfPeriod) {
        return fail(res, 400, '반차 신청 시 오전(am)/오후(pm) 구분을 명확히 지정해야 합니다.');
      }

      // [알고리즘 2단계] 신청 휴가 일수 정밀 산출 연산
      let requestedDays = 0.0;

      if (leaveType === 'half') {
        requestedDays = 0.5; // 반차는 제약조건상 무조건 0.5일 고정 매핑
        if (startDate !== endDate) {
          return fail(res, 400, '반차 신청은 당일(시작일과 종료일 일치)에만 가능합니다.');
        }
      } else {
        // 일반 연차(annual) 또는 기타(other)일 경우 날짜 차이 기반 소수점 일수 연산 (주말 제외 등 확장 가능)
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = end - start;

        if (diffTime < 0) {
          return fail(res, 400, '종료 일자가 시작 일자보다 앞설 수 없습니다.');
        }
        // 당일 연차는 1일, 1박 2일은 2일 처리를 위해 밀리초 환산 후 +1을 더해줍니다.
        requestedDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      }

      // [알고리즘 3단계] leave_balances 장부 대조를 통한 한도 검증 (올해 연도 기준)
      const currentYear = new Date().getFullYear();
      const userBalance = await LeaveModel.findBalanceByUserAndYear(userId, currentYear);

      if (!userBalance) {
        return fail(res, 403, `${currentYear}년도에 배정된 총 휴가 총량 장부가 존재하지 않습니다. 관리자에게 문의하세요.`);
      }

      // 소수점 타입인 DECIMAL(4,1) 연산을 안전하게 소화하기 위해 유동적으로 실수형 변환 처리 수행
      const totalAvailable = parseFloat(userBalance.total_days);

      // [주의]: 실제 현업에서는 이미 사용 완료된 휴가 일수의 합을 차감하는 조인 쿼리가 연동되어야 하며,
      // 현재는 배정된 최초 총량 한도를 초과하는지 우선 체크합니다.
      if (requestedDays > totalAvailable) {
        return fail(res, 400, `잔여 휴가 한도를 초과했습니다. (신청: ${requestedDays}일 / 올해 총량: ${totalAvailable}일)`);
      }

      // [알고리즘 4단계] 정제된 데이터 바인딩 객체를 구성하여 기안서 적재
      const leaveRequest = await LeaveModel.createLeaveRequest({
        userId,
        leaveType,
        halfPeriod: leaveType === 'half' ? halfPeriod : null,
        startDate,
        endDate,
        reason
      });

      return success(
        res,
        { request: leaveRequest, calculatedDays: requestedDays },
        '휴가 신청서 기안서가 관리자 결재 라인에 성공적으로 상신되었습니다.',
        201
      );

    } catch (error) {
      console.error('휴가 기안 비즈니스 로직 예외 에러:', error);
      return fail(res, 500, '서버 오류로 휴가 기안 처리에 실패했습니다.');
    }
  },

  /**
   * @function reviewLeave
   * @description [관리자 전용] 결재 서류 승인 조치 단행 시, 출결(attendance) 테이블에 근태 상태를 강제 자동 동기화 주입합니다.
   */
  reviewLeave: async (req, res) => {
    try {
      const requestId = req.params.id;
      const reviewerId = req.user.id; // 결재를 승인한 관리자 고유 ID
      const { status, rejectReason } = req.body; // 'approved' 또는 'rejected'

      if (!status || !['approved', 'rejected'].includes(status)) {
        return fail(res, 400, '올바른 결재 판정 상태값(approved/rejected)을 입력해 주세요.');
      }

      // 1. 해당 결재 문서의 실존 여부 검증
      const leaveRequest = await LeaveModel.findRequestById(requestId);
      if (!leaveRequest) {
        return fail(res, 404, '존재하지 않는 휴가 신청 결재 문서입니다.');
      }

      if (leaveRequest.status !== 'pending') {
        return fail(res, 400, '이미 최종 승인 혹은 반려 처리가 종결된 문서입니다.');
      }

      // 2. 모델 레이어를 호출하여 기안서의 결재 상태 행 변경 원자적 반영
      const reviewedRequest = await LeaveModel.updateLeaveStatus(requestId, status, rejectReason || null, reviewerId);

      // 3. [핵심 교차 도메인 동기화 알고리즘] 최종 상태가 'approved'일 경우에만 출결 테이블 자동 주입 시나리오 가동
      if (status === 'approved') {
        const targetUserId = leaveRequest.user_id;
        const start = new Date(leaveRequest.start_date);
        const end = new Date(leaveRequest.end_date);

        // 어떤 출결 코드로 매핑할지 스위칭 변수 판별
        const targetAttendanceStatus = leaveRequest.leave_type === 'half' ? 'half_leave' : 'leave';

        // 시작일부터 종료일까지 루프를 돌며 일일 단위로 attendance 테이블에 UPSERT를 처리합니다.
        let loopDate = new Date(start);
        while (loopDate <= end) {
          // PostgreSQL DATE 포맷에 적합하게 YYYY-MM-DD 문자열 포맷팅 추출
          const dateStr = loopDate.toISOString().split('T')[0];

          // 동시성 멱등성을 품은 모델 레이어의 업서트 메서드 가동
          await LeaveModel.insertAutomaticAttendanceForLeave(
            targetUserId,
            dateStr,
            targetAttendanceStatus,
            requestId
          );

          loopDate.setDate(loopDate.getDate() + 1); // 하루 증가 연산
        }
      }

      const outcomeMessage = status === 'approved'
        ? '휴가 신청을 최종 승인했으며 해당 기간의 출결 장부 동기화가 완료되었습니다.'
        : '휴가 신청 건을 반려 조치했습니다.';

      return success(res, { result: reviewedRequest }, outcomeMessage);

    } catch (error) {
      console.error('휴가 결재 심사 처리 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 결재 심사 처리에 실패했습니다.');
    }
  }
};

module.exports = LeaveController;
