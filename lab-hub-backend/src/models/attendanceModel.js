/**
 * @file attendanceModel.js
 * @description attendance 테이블에 접근하여 출퇴근 기록의 삽입, 수정, 조회를 담당하는 모델 레이어입니다.
 */

const db = require('../config/db'); // 데이터베이스 커넥션 풀 로드

const AttendanceModel = {
  /**
   * @function findTodayRecord
   * @description 특정 유저의 당일 날짜(DATE) 출결 레코드가 존재하는지 스캔합니다.
   * @param {number} userId - 유저 고유 ID (PK)
   * @returns {Promise<Object|null>} 당일 출결 레코드 객체 또는 null
   */
  findTodayRecord: async (userId) => {
    // CURRENT_DATE 함수를 활용해 데이터베이스 서버 시간 기준으로 오늘 레코드를 정확히 스캔합니다.
    const queryText = `
      SELECT * FROM attendance 
      WHERE user_id = $1 AND date = CURRENT_DATE;
    `;
    const { rows } = await db.query(queryText, [userId]);
    return rows[0];
  },

  /**
   * @function createCheckIn
   * @description 신규 출근 체크인 레코드를 원자적으로 삽입합니다.
   * @param {number} userId - 유저 고유 ID
   * @param {string} status - 판별된 근태 상태 ENUM ('present', 'late')
   * @returns {Promise<Object>} 생성된 출결 레코드 결과물
   */
  createCheckIn: async (userId, status) => {
    // date 컬럼에는 CURRENT_DATE, check_in에는 현재 TIMESTAMP(now())를 주입합니다.
    const queryText = `
      INSERT INTO attendance (user_id, date, check_in, status, created_at, updated_at)
      VALUES ($1, CURRENT_DATE, now(), $2, now(), now())
      RETURNING id, user_id, date, check_in, status;
    `;
    const { rows } = await db.query(queryText, [userId, status]);
    return rows[0];
  },

  /**
   * @function updateCheckOut
   * @description 당일 출근 레코드에 퇴근 시간(check_out)을 주입하고 상태를 최종 업데이트합니다.
   * @param {number} id - attendance 레코드의 고유 식별자 (PK)
   * @returns {Promise<Object>} 수정이 완료된 출결 레코드 결과물
   */
  updateCheckOut: async (id) => {
    // check_out 컬럼에 현재 TIMESTAMP를 기록하고 updated_at을 갱신합니다.
    const queryText = `
      UPDATE attendance 
      SET check_out = now(), updated_at = now()
      WHERE id = $1
      RETURNING id, user_id, date, check_in, check_out, status;
    `;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function findRecords
   * @description 출결 기록 목록을 신청자 이름(user_name)과 함께 조회합니다. 선택적 필터(userId/date/status)를 동적으로 결합합니다.
   *              users 테이블과 JOIN하여 u.name을 user_name으로 노출하며, 최신 일자·이름 순으로 정렬합니다.
   * @param {Object} filters - { userId?, date?, status? } 각 항목은 선택이며, 주어진 것만 WHERE 조건에 결합됩니다.
   * @returns {Promise<Array>} 출결 기록 배열
   */
  findRecords: async ({ userId, date, status } = {}) => {
    // 동적 WHERE 절: 전달된 필터만 파라미터화하여 안전하게 결합합니다.
    const conditions = [];
    const values = [];
    if (userId) { values.push(userId); conditions.push(`a.user_id = $${values.length}`); }
    if (date)   { values.push(date);   conditions.push(`a.date = $${values.length}`); }
    if (status) { values.push(status); conditions.push(`a.status = $${values.length}`); }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const queryText = `
      SELECT a.id, a.user_id, u.name AS user_name, a.date,
             a.check_in, a.check_out, a.status, a.leave_request_id, a.created_at, a.updated_at
        FROM attendance a
        JOIN users u ON u.id = a.user_id
        ${whereClause}
       ORDER BY a.date DESC, u.name ASC;
    `;
    const { rows } = await db.query(queryText, values);
    return rows;
  },

  /**
   * @function findRecordById
   * @description 출결 기록 단건을 user_name JOIN과 함께 조회합니다. (관리자 수정 전 실존 검증 및 응답용)
   * @param {number} id - attendance 레코드 PK
   * @returns {Promise<Object|undefined>} 출결 기록 또는 미존재 시 undefined
   */
  findRecordById: async (id) => {
    const queryText = `
      SELECT a.id, a.user_id, u.name AS user_name, a.date,
             a.check_in, a.check_out, a.status, a.leave_request_id, a.created_at, a.updated_at
        FROM attendance a
        JOIN users u ON u.id = a.user_id
       WHERE a.id = $1;
    `;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function adminUpdateRecord
   * @description [관리자] 출결 기록의 status/check_in/check_out을 부분 수정합니다.
   *              전달된 필드만 동적으로 SET 하며(미전달 필드는 보존), 값이 명시적으로 null이면 해당 컬럼을 NULL로 비웁니다(예: 결석 처리 시 시각 초기화).
   * @param {number} id - attendance 레코드 PK
   * @param {Object} fields - { status?, check_in?, check_out? } 중 수정할 항목만 포함
   * @returns {Promise<Object|undefined>} 수정된 레코드 또는 미존재 시 undefined
   */
  adminUpdateRecord: async (id, fields) => {
    // 화이트리스트 컬럼만 동적 SET 절로 구성합니다. (호출부 컨트롤러에서 값 검증을 마친 상태)
    const allowed = ['status', 'check_in', 'check_out'];
    const setClauses = [];
    const values = [];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        values.push(fields[key]);
        setClauses.push(`${key} = $${values.length}`);
      }
    }

    // 수정할 필드가 하나도 없으면 상위(컨트롤러)에서 차단하지만, 방어적으로 현재 레코드를 그대로 반환합니다.
    if (setClauses.length === 0) {
      return AttendanceModel.findRecordById(id);
    }

    setClauses.push(`updated_at = now()`);
    values.push(id); // 마지막 파라미터는 WHERE의 id

    const queryText = `
      UPDATE attendance
         SET ${setClauses.join(', ')}
       WHERE id = $${values.length}
      RETURNING id, user_id, date, check_in, check_out, status, leave_request_id, updated_at;
    `;
    const { rows } = await db.query(queryText, values);
    return rows[0];
  }
};

module.exports = AttendanceModel;