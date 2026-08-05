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

  /**
   * @function updateToPurchased
   * @description [관리자] approved 상태의 구매 요청을 purchased(구매완료)로 전이시킵니다.
   *              purchased_by / purchased_at 을 함께 기록하며, 선택적으로 실제 지출 레코드(expense_id)와 연결합니다.
   *              구매 담당자(purchasedBy)와 결재자(reviewer)는 서로 다를 수 있으므로 별도 컬럼으로 분리 저장됩니다.
   * @param {number} requestId
   * @param {number} purchasedBy - 구매 실행자(관리자)의 user id
   * @param {number|null} expenseId - 이 구매에 연결된 expenses.id (선택)
   */
  updateToPurchased: async (requestId, purchasedBy, expenseId) => {
    const queryText = `
      UPDATE purchase_requests
         SET status       = 'purchased'::purchase_status,
             purchased_by = $2,
             purchased_at = now(),
             expense_id   = COALESCE($3, expense_id),
             updated_at   = now()
       WHERE id = $1
      RETURNING id, item_name, quantity, status,
                purchased_by, purchased_at, expense_id;
    `;
    const values = [requestId, purchasedBy, expenseId === undefined ? null : expenseId];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function updateToDelivered
   * @description [관리자] purchased 상태의 구매 요청을 delivered(납품완료)로 전이시킵니다.
   *              delivered_at 타임스탬프를 원자적으로 기록합니다.
   *              스키마상 delivered_by 컬럼이 없어 납품 확인자 정보는 별도 로그가 아닌 시각 기반으로만 관리합니다.
   */
  updateToDelivered: async (requestId) => {
    const queryText = `
      UPDATE purchase_requests
         SET status       = 'delivered'::purchase_status,
             delivered_at = now(),
             updated_at   = now()
       WHERE id = $1
      RETURNING id, item_name, quantity, status, delivered_at;
    `;
    const { rows } = await db.query(queryText, [requestId]);
    return rows[0];
  },

  /**
   * @function findAllRequests
   * @description 물품 구매 신청 전체 목록을 신청자 이름과 함께 최신순으로 조회합니다.
   *              공용 물품 구매 내역이므로 역할 구분 없이 전체 열람 가능한 자산이며, 인가 제어는 라우터/컨트롤러 상위 레이어에서 담당합니다.
   *              users 테이블과 JOIN하여 신청자 이름을 requester로, created_at을 requested_at으로 별칭 처리합니다.
   * @param {string|null} status - 결재/실물 흐름 상태 필터 (pending/approved/rejected/purchased/delivered). null이면 전체 조회.
   * @returns {Promise<Array>} 신청 목록 배열
   */
  findAllRequests: async (status = null) => {
    // status가 주어지면 WHERE 절을 동적으로 부착합니다. 파라미터화 쿼리로 SQL Injection을 방어합니다.
    const queryText = `
      SELECT pr.id, pr.item_name, pr.quantity, pr.estimated_price, pr.purchase_url, pr.reason,
             u.name AS requester, pr.status, pr.created_at AS requested_at
        FROM purchase_requests pr
        JOIN users u ON u.id = pr.user_id
       ${status ? 'WHERE pr.status = $1' : ''}
       ORDER BY pr.created_at DESC;
    `;
    const values = status ? [status] : [];
    const { rows } = await db.query(queryText, values);
    return rows;
  },

  /**
   * @function findRequestDetailById
   * @description 물품 구매 신청 단건을 신청자 이름과 함께 상세 조회합니다. (목록과 동일한 필드 구조 + JOIN)
   *              무결성 검증용 findRequestById와 달리 requester/requested_at 별칭이 포함된 외부 응답용 뷰입니다.
   * @param {number} id - 조회 대상 신청서 PK
   * @returns {Promise<Object|undefined>} 신청 상세 또는 미존재 시 undefined
   */
  findRequestDetailById: async (id) => {
    const queryText = `
      SELECT pr.id, pr.item_name, pr.quantity, pr.estimated_price, pr.purchase_url, pr.reason,
             u.name AS requester, pr.status, pr.created_at AS requested_at
        FROM purchase_requests pr
        JOIN users u ON u.id = pr.user_id
       WHERE pr.id = $1;
    `;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function updateRequest
   * @description 구매 신청서의 기안 내용(item_name/quantity/estimated_price/purchase_url/reason)을 부분 수정합니다.
   *              전달된 필드만 동적으로 SET 하며, 소유권/상태 검증은 상위 컨트롤러에서 선행합니다.
   * @param {number} id - purchase_requests.id
   * @param {Object} fields - 수정할 항목만 포함한 객체
   * @returns {Promise<Object|undefined>} 수정된 레코드
   */
  updateRequest: async (id, fields) => {
    const allowed = ['item_name', 'quantity', 'estimated_price', 'purchase_url', 'reason'];
    const setClauses = [];
    const values = [];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        values.push(fields[key]);
        setClauses.push(`${key} = $${values.length}`);
      }
    }
    if (setClauses.length === 0) {
      return ProcurementModel.findRequestById(id);
    }
    setClauses.push(`updated_at = now()`);
    values.push(id);

    const queryText = `
      UPDATE purchase_requests
         SET ${setClauses.join(', ')}
       WHERE id = $${values.length}
      RETURNING id, user_id, item_name, quantity, estimated_price, purchase_url, reason, status, updated_at;
    `;
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function deleteRequest
   * @description 구매 신청서를 삭제합니다. 소유권/상태 검증은 상위 컨트롤러에서 선행합니다.
   * @param {number} id - purchase_requests.id
   * @returns {Promise<Object|undefined>} 삭제된 레코드의 id
   */
  deleteRequest: async (id) => {
    const { rows } = await db.query('DELETE FROM purchase_requests WHERE id = $1 RETURNING id;', [id]);
    return rows[0];
  },
};

module.exports = ProcurementModel;
