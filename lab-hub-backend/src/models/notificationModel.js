/**
 * @file notificationModel.js
 * @description 사용자별 시스템 알림 적재, 읽음 처리 및 실시간 조회 SQL 질의를 전담하는 데이터 액세스 모델 레이어입니다.
 */

const db = require('../config/db'); // 데이터베이스 커넥션 풀 로드

const NotificationModel = {
  /**
   * @function findByUserId
   * @description 특정 연구원에게 수신된 알림 목록 전체를 최신 등록순(인덱스 역순)으로 스캔합니다.
   * @param {number} userId - 수신 대상 연구원 ID (FK)
   * @returns {Promise<Array>} 알림 레코드 객체 배열
   */
  findByUserId: async (userId) => {
    const queryText = `
      SELECT id, user_id, title, content, category, is_read, created_at
      FROM system_notifications
      WHERE user_id = $1
      ORDER BY created_at DESC;
    `;
    const { rows } = await db.query(queryText, [userId]);
    return rows;
  },

  /**
   * @function createNotification
   * @description 시스템 내부 이벤트(출결, 휴가, 회계 등) 발생 시 대상 유저에게 전송할 알림 행을 최초 삽입(INSERT)합니다.
   * @param {Object} notiData - 수신자 ID, 제목, 본문, 카테고리 등을 내포한 DTO 객체
   * @returns {Promise<Object>} 생성 완료된 알림 레코드
   */
  createNotification: async (notiData) => {
    const { userId, title, content, category } = notiData;
    
    // 명세서 제약에 따라 신규 알림 적재 시 읽음 상태(is_read)는 기본값인 FALSE(미읽음)로 빌드됩니다.
    const queryText = `
      INSERT INTO system_notifications (
        user_id, title, content, category, is_read, created_at
      ) VALUES ($1, $2, $3, $4, false, now())
      RETURNING id, user_id, title, content, category, is_read, created_at;
    `;
    const values = [userId, title, content, category];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function markAsRead
   * @description 연구원이 특정 알림을 클릭했거나 읽음 확정 조치를 취했을 때 is_read 상태를 TRUE로 원자적 업데이트합니다.
   * @param {number} notiId - 알림 고유 식별 번호 (PK)
   * @param {number} userId - 소유권 검증을 위한 유저 ID (FK)
   * @returns {Promise<Object>} 수정 완료된 알림 레코드
   */
  markAsRead: async (notiId, userId) => {
    // 본인에게 도래한 알림만 제어할 수 있도록 WHERE 조건절에 user_id 검증 장치를 마운트합니다.
    const queryText = `
      UPDATE system_notifications
      SET is_read = true
      WHERE id = $1 AND user_id = $2
      RETURNING id, user_id, is_read;
    `;
    const { rows } = await db.query(queryText, [notiId, userId]);
    return rows[0];
  },

  /**
   * @function markAllAsRead
   * @description [일괄 처리] 사용자가 '모두 읽음' 버튼을 트리거했을 때 미읽음 상태의 모든 알림을 일괄 업데이트합니다.
   */
  markAllAsRead: async (userId) => {
    const queryText = `
      UPDATE system_notifications
      SET is_read = true
      WHERE user_id = $1 AND is_read = false
      RETURNING user_id;
    `;
    const { rows } = await db.query(queryText, [userId]);
    return rows;
  }
};

module.exports = NotificationModel; // 비즈니스 컨트롤러 레이어에서 원자적 호출이 가능하도록 export 처리합니다.