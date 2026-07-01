/**
 * @file procurementModel.js
 * @description 물품 구매 신청 테이블(purchase_requests)에 접근하여 SQL 질의를 수행하는 데이터 액세스 모델 레이어입니다.
 *
 * 실제 스키마 매핑:
 *  - 테이블   : purchase_requests
 *  - 컬럼    : user_id, item_name, quantity, estimated_price, purchase_url, reason,
 *              status (purchase_status ENUM: pending/approved/rejected/purchased/delivered),
 *              reject_reason, reviewed_by, reviewed_at, purchased_by, purchased_at, delivered_at, expense_id
 */

const db = require('../config/db'); // 데이터베이스 커넥션 풀 로드

const ProcurementModel = {
  /**
   * @function createRequest
   * @description 물품 구매 신청서 레코드를 최초 생성합니다. status는 DB 기본값 'pending'.
   * @param {Object} params - { userId, itemName, quantity, estimatedPrice, purchaseUrl, reason }
   */
  createRequest: async ({ userId, itemName, quantity, estimatedPrice, purchaseUrl, reason }) => {
    const queryText = `
      INSERT INTO purchase_requests (
        user_id, item_name, quantity, estimated_price, purchase_url, reason
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, user_id, item_name, quantity, estimated_price, purchase_url, reason, status, created_at;
    `;
    const values = [userId, itemName, quantity, estimatedPrice, purchaseUrl || null, reason];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function findRequestById
   * @description 결재 무결성 검증을 위해 구매 신청 서류를 단건 조회합니다.
   */
  findRequestById: async (id) => {
    const queryText = `
      SELECT id, user_id, item_name, quantity, estimated_price, purchase_url, reason,
             status, reject_reason, reviewed_by, reviewed_at, purchased_by, purchased_at, delivered_at, expense_id
        FROM purchase_requests
       WHERE id = $1;
    `;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function updateRequestStatus
   * @description [관리자] 구매 신청서 결재 상태를 최종 승인/반려로 확정합니다.
   *              구매 완료(purchased)/납품 완료(delivered) 상태 전이는 별도 엔드포인트에서 처리하는 것을 권장.
   */
  updateRequestStatus: async (requestId, status, rejectReason, reviewerId) => {
    const queryText = `
      UPDATE purchase_requests
         SET status        = $2,
             reject_reason = $3,
             reviewed_by   = $4,
             reviewed_at   = now(),
             updated_at    = now()
       WHERE id = $1
      RETURNING id, item_name, quantity, status, reviewed_by, reviewed_at;
    `;
    const values = [requestId, status, rejectReason, reviewerId];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },
};

module.exports = ProcurementModel;
