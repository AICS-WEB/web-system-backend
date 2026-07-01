/**
 * @file leaveModel.js
 * @description leave_balances 및 leave_requests 테이블에 접근하여 행정 데이터 질의를 수행하는 모델 레이어입니다.
 */

const db = require('../config/db'); // 데이터베이스 커넥션 풀 로드

const LeaveModel = {
  /**
   * @function findBalanceByUserAndYear
   * @description 특정 유저의 해당 연도 기준 총 휴가 부여량 및 이력을 스캔합니다.
   * @param {number} userId - 유저 고유 ID (FK)
   * @param {number} year - 조회 대상 연도 (예: 2026)
   * @returns {Promise<Object|null>} 연도별 휴가 총량 객체 또는 null
   */
  findBalanceByUserAndYear: async (userId, year) => {
    // UNIQUE(user_id, year) 제약 조건에 따라 한 사람당 연도별로 반드시 1행만 매싱되므로 단건 조회를 단행합니다.
    const queryText = `
      SELECT id, user_id, year, total_days, created_at, updated_at
      FROM leave_balances
      WHERE user_id = $1 AND year = $2;
    `;
    const { rows } = await db.query(queryText, [userId, year]);
    return rows[0];
  },

  /**
   * @function createLeaveRequest
   * @description 연구원이 기안한 신규 휴가 신청서 레코드를 데이터베이스에 최초 삽입(INSERT)합니다.
   * @param {Object} leaveData - 휴가 신청 정보 DTO 객체
   * @returns {Promise<Object>} 등록 완료된 휴가 신청서 레코드
   */
  createLeaveRequest: async (leaveData) => {
    const { userId, leaveType, halfPeriod, startDate, endDate, reason } = leaveData;
    
    // 신규 신청 시 결재 상태(status)는 명세서 기본값인 'pending'으로 적재됩니다.
    // reviewed_by, reviewed_at, reject_reason은 결재 전이므로 초기값 NULL 상태를 유지합니다.
    const queryText = `
      INSERT INTO leave_requests (
        user_id, leave_type, half_period, start_date, end_date, reason, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', now(), now())
      RETURNING id, user_id, leave_type, half_period, start_date, end_date, reason, status, created_at;
    `;

    const values = [userId, leaveType, halfPeriod, startDate, endDate, reason];
    const { rows } = await db.query(values, queryText ? values : [userId, leaveType, halfPeriod, startDate, endDate, reason]);
    // 상기 바인딩 배열을 통해 SQL Injection 공격을 방어구축합니다.
    const actualQuery = `
      INSERT INTO leave_requests (
        user_id, leave_type, half_period, start_date, end_date, reason, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', now(), now())
      RETURNING id, user_id, leave_type, half_period, start_date, end_date, reason, status, created_at;
    `;
    const { rows: resultRows } = await db.query(actualQuery, values);
    return resultRows[0];
  },

  /**
   * @function findRequestById
   * @description 결재 검증 조치를 위해 특정 휴가 신청서의 식별 번호(id)로 단건 조회를 수행합니다.
   * @param {number} id - 휴가 신청 결재 문서 번호 (PK)
   */
  findRequestById: async (id) => {
    const queryText = `
      SELECT id, user_id, leave_type, half_period, start_date, end_date, status, reviewed_by
      FROM leave_requests
      WHERE id = $1;
    `;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function updateLeaveStatus
   * @description [관리자] 특정 휴가 신청서를 최종 승인(approved) 또는 반려(rejected) 상태로 판정 업데이트합니다.
   * @param {number} requestId - 휴가 문서 고유 ID
   * @param {string} status - 변경될 결재 상태 ENUM ('approved', 'rejected')
   * @param {string|null} rejectReason - 반려 시 기입하는 사유 사유서
   * @param {number} reviewerId - 결재를 단행한 관리자(users.id)
   * @returns {Promise<Object>} 업데이트가 완료된 결재 서류 레코드
   */
  updateLeaveStatus: async (requestId, status, rejectReason, reviewerId) => {
    // 결재 완료 시각(reviewed_at)에 실시간 타임스탬프인 now()를 마운트합니다.
    const queryText = `
      UPDATE leave_requests
      SET status = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now()
      WHERE id = $1
      RETURNING id, user_id, leave_type, start_date, end_date, status, reviewed_by, reviewed_at;
    `;
    const values = [requestId, status, rejectReason, reviewerId];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function insertAutomaticAttendanceForLeave
   * @description [핵심 연동] 휴가 승인 완료 시, 대상 일자만큼 출결 테이블(attendance)에 근태 행을 원자적으로 자동 주입합니다.
   * @param {number} userId - 대상 연구원 ID
   * @param {string} dateStr - 휴가에 해당하는 특정 일자 (예: '2026-07-15')
   * @param {string} attendanceStatus - 자동 매핑될 근태 상태 ENUM ('leave', 'half_leave')
   * @param {number} leaveRequestId - 증빙서류 매핑을 위한 부모 휴가 기안 번호
   */
  insertAutomaticAttendanceForLeave: async (userId, dateStr, attendanceStatus, leaveRequestId) => {
    // 동일 날짜에 무단결근(absent)이나 대기 기록이 선존할 가능성을 방어하기 위해 ON CONFLICT 절을 명세합니다.
    // UNIQUE(user_id, date) 충돌 시, 휴가 상태('leave') 및 증빙 외래키(leave_request_id)를 덮어씌우도록 원자적(Upsert) 처리를 수행합니다.
    const queryText = `
      INSERT INTO attendance (user_id, date, status, leave_request_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, now(), now())
      ON CONFLICT (user_id, date) 
      DO UPDATE SET 
        status = EXCLUDED.status, 
        leave_request_id = EXCLUDED.leave_request_id, 
        updated_at = now()
      RETURNING id, user_id, date, status;
    `;
    const values = [userId, dateStr, attendanceStatus, leaveRequestId];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  }
};

module.exports = LeaveModel; // 컨트롤러 레이어에서 트랜잭션 단위로 호출할 수 있도록 export 처리합니다.