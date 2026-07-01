/**
 * @file procurementModel.js
 * @description 연구실 물품 및 비품 구매 신청 테이블에 접근하여 SQL 질의를 수행하는 데이터 액세스 모델 레이어입니다.
 */

const db = require('../config/db'); // 데이터베이스 커넥션 풀 로드

const ProcurementModel = {
  /**
   * @function createRequest
   * @description 연구원이 기안한 물품 구매 신청서 레코드를 최초 생성(INSERT)합니다.
   * @param {Object} requestData - 물품명, 규격, 수량, 예상 금액, 신청 사유 등을 포함한 DTO 객체
   * @returns {Promise<Object>} 등록 완료된 구매 신청서 레코드
   */
  createRequest: async (requestData) => {
    const { userId, itemPlainName, specification, quantity, estimatedPrice, purpose } = requestData;
    
    // 명세서 규격에 따라 초기 결재 상태(status)는 'pending'으로 고정 적재됩니다.
    // reviewed_by, reviewed_at, reject_reason은 결재 전이므로 초기값 NULL 상태를 유지합니다.
    const queryText = `
      INSERT INTO procurement_requests (
        user_id, item_plain_name, specification, quantity, estimated_price, purpose, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', now(), now())
      RETURNING id, user_id, item_plain_name, quantity, estimated_price, status, created_at;
    `;
    
    const values = [userId, itemPlainName, specification, quantity, estimatedPrice, purpose];
    const { rows } = await db.query(queryText, values);
    return rows[0]; // 컨트롤러 레이어로 생성 완료된 레코드 데이터를 반환합니다.
  },

  /**
   * @function findRequestById
   * @description 결재 무결성 검증을 위해 특정 구매 신청 서류를 단건 조회합니다.
   * @param {number} id - 구매 신청 고유 식별 번호 (PK)
   */
  findRequestById: async (id) => {
    const queryText = `
      SELECT id, user_id, item_plain_name, quantity, estimated_price, status 
      FROM procurement_requests 
      WHERE id = $1;
    `;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function updateRequestStatus
   * @description [관리자] 특정 물품 구매 신청서의 결재 상태를 최종 승인(approved) 또는 반려(rejected) 상태로 판정 업데이트합니다.
   * @param {number} requestId - 구매 신청 문서 고유 ID
   * @param {string} status - 변경될 결재 상태 ENUM ('approved', 'rejected')
   * @param {string|null} rejectReason - 반려 시 기입하는 사유 설명서
   * @param {number} reviewerId - 결재를 단행한 관리자 ID (users.id)
   * @returns {Promise<Object>} 업데이트가 완료된 결재 서류 레코드 객체
   */
  updateRequestStatus: async (requestId, status, rejectReason, reviewerId) => {
    // 결재 완료 시각(reviewed_at)에 실시간 타임스탬프인 now()를 바인딩합니다.
    const queryText = `
      UPDATE procurement_requests
      SET status = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now()
      WHERE id = $1
      RETURNING id, item_plain_name, status, reviewed_by, reviewed_at;
    `;
    const values = [requestId, status, rejectReason, reviewerId];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  }
};

module.exports = ProcurementModel; // 컨트롤러 비즈니스 로직 레이어에서 쿼리를 호출할 수 있도록 모듈을 내보냅니다.