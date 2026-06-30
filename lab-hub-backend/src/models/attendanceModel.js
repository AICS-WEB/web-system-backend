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
  }
};

module.exports = AttendanceModel;