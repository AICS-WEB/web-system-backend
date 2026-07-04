/**
 * @file notificationModel.js
 * @description 사용자별 시스템 알림(notifications) 적재·조회·읽음 처리 SQL 질의를 담당하는 데이터 액세스 레이어입니다.
 *
 * 스키마 정합성 (schema.sql 기준):
 *  - 테이블: notifications
 *  - 컬럼: id, user_id (FK CASCADE), type (notification_type ENUM), title, message,
 *          related_type (선택), related_id (선택), is_read, created_at
 *  - ENUM(notification_type): leave_requested, leave_approved, leave_rejected,
 *      purchase_requested, purchase_approved, purchase_rejected, purchase_delivered,
 *      notice_created, recruit_received, signup_requested, signup_approved, general
 *
 * 사용 흐름:
 *  - 시스템 내부 이벤트(휴가 승인, 지출 승인 등) 발생 시 각 도메인 컨트롤러가 createNotification을 직접 호출합니다.
 *  - HTTP API를 통한 생성은 admin/manager 브로드캐스트 용도로만 열어두고, 그 외 도메인 이벤트 알림은 서버 내부 호출로 처리합니다.
 */

const db = require('../config/db'); // 데이터베이스 커넥션 풀 로드

const NotificationModel = {
  /**
   * @function findByUserId
   * @description 특정 사용자에게 도래한 알림을 최신 등록순으로 스캔합니다.
   * @param {number} userId - 수신자 유저 ID
   * @param {Object} [filters]
   * @param {boolean} [filters.isRead] - true/false로 읽음 상태 필터, 미지정 시 전체
   * @returns {Promise<Array>} notifications 레코드 배열
   */
  findByUserId: async (userId, { isRead } = {}) => {
    const conditions = ['user_id = $1'];
    const values = [userId];

    if (typeof isRead === 'boolean') {
      values.push(isRead);
      conditions.push(`is_read = $${values.length}`);
    }

    const queryText = `
      SELECT id, user_id, type, title, message, related_type, related_id, is_read, created_at
        FROM notifications
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC, id DESC;
    `;
    const { rows } = await db.query(queryText, values);
    return rows;
  },

  /**
   * @function countUnread
   * @description 특정 사용자의 미읽음 알림 개수를 반환합니다.
   *              뱃지 카운터 등 UX 목적으로 목록을 다 로드하지 않고 개수만 필요할 때 사용합니다.
   */
  countUnread: async (userId) => {
    const queryText = `
      SELECT COUNT(*)::int AS unread_count
        FROM notifications
       WHERE user_id = $1 AND is_read = false;
    `;
    const { rows } = await db.query(queryText, [userId]);
    return rows[0].unread_count;
  },

  /**
   * @function findById
   * @description 알림 단건 조회. 소유권 검증은 컨트롤러에서 별도로 수행합니다.
   */
  findById: async (id) => {
    const queryText = `SELECT * FROM notifications WHERE id = $1;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function createNotification
   * @description 시스템 이벤트(휴가 승인, 물품 구매 확정 등)에 대응해 대상 유저에게 신규 알림을 적재합니다.
   *              is_read는 항상 false로 초기화되며, related_type/related_id는 관련 리소스를 링크할 때 사용합니다.
   * @param {Object} data
   * @param {number} data.userId
   * @param {string} data.type - notification_type ENUM 값
   * @param {string} data.title
   * @param {string} data.message
   * @param {string} [data.relatedType] - 예: 'leave_request', 'purchase_request'
   * @param {number} [data.relatedId]
   */
  createNotification: async ({ userId, type, title, message, relatedType, relatedId }) => {
    const queryText = `
      INSERT INTO notifications (
        user_id, type, title, message, related_type, related_id, is_read
      ) VALUES (
        $1, $2::notification_type, $3, $4, $5, $6, false
      )
      RETURNING id, user_id, type, title, message, related_type, related_id, is_read, created_at;
    `;
    const values = [
      userId,
      type,
      title,
      message,
      relatedType || null,
      relatedId === undefined || relatedId === null ? null : relatedId,
    ];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function markAsRead
   * @description 알림 단건을 읽음으로 원자적 갱신합니다.
   *              WHERE 절에 user_id를 함께 걸어 타인의 알림을 임의로 읽음 처리할 수 없게 방어합니다.
   *              이미 읽음 상태였거나 소유자가 아니면 undefined를 반환합니다.
   */
  markAsRead: async (notiId, userId) => {
    const queryText = `
      UPDATE notifications
         SET is_read = true
       WHERE id = $1 AND user_id = $2 AND is_read = false
      RETURNING id, user_id, is_read;
    `;
    const { rows } = await db.query(queryText, [notiId, userId]);
    return rows[0];
  },

  /**
   * @function markAllAsRead
   * @description 특정 사용자의 미읽음 알림을 모두 읽음으로 일괄 갱신하고 갱신된 개수를 반환합니다.
   */
  markAllAsRead: async (userId) => {
    const queryText = `
      UPDATE notifications
         SET is_read = true
       WHERE user_id = $1 AND is_read = false
      RETURNING id;
    `;
    const { rows } = await db.query(queryText, [userId]);
    return rows.length;
  },
};

module.exports = NotificationModel; // 다른 도메인 컨트롤러가 시스템 이벤트 시점에 직접 호출할 수 있도록 export합니다.
