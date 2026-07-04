/**
 * @file procurementController.js
 * @description 물품 구매 신청 및 결재 워크플로우 제어 컨트롤러 레이어입니다.
 *
 * 스키마 정합성:
 *  - 테이블은 purchase_requests
 *  - 필드: itemName, quantity, estimatedPrice, purchaseUrl(선택), reason(필수)
 *  - status ENUM: pending/approved/rejected/purchased/delivered (본 컨트롤러 review에서는 approved/rejected만 처리)
 */

const ProcurementModel = require('../models/procurementModel');
const { success, fail } = require('../utils/response');

// 결재 review 에서 허용하는 상태값 (구매/납품 완료 처리는 별도 엔드포인트로 분리 권장)
const VALID_REVIEW_STATUSES = ['approved', 'rejected'];

// 상태 전이(advanceStatus)에서 허용하는 정합 전이 규칙.
// 결재(pending → approved/rejected)와 분리하여 실물 흐름(구매/납품)만 통제합니다.
//   approved  → purchased  (구매 실행)
//   purchased → delivered  (납품 확정)
const LEGAL_TRANSITIONS = {
  approved:  'purchased',
  purchased: 'delivered',
};

const ProcurementController = {
  /**
   * @function requestProcurement
   * @description [인증 유저] 필수 서식을 검증하고 수량·금액 무결성을 확인한 뒤 신규 물품 구매 신청서를 기안합니다.
   *
   * Body:
   *   - itemName       (필수)
   *   - quantity       (필수, 양의 정수)
   *   - estimatedPrice (필수, 0 이상 숫자)
   *   - purchaseUrl    (선택, 구매처 링크)
   *   - reason         (필수, 신청 사유)
   */
  requestProcurement: async (req, res) => {
    try {
      const userId = req.user.id;
      const { itemName, quantity, estimatedPrice, purchaseUrl, reason } = req.body;

      // [1] 필수 서식 파라미터 검증
      if (!itemName || quantity === undefined || estimatedPrice === undefined || !reason) {
        return fail(res, 400, '물품명, 수량, 예상 금액, 신청 사유는 필수 입력 항목입니다.');
      }

      // [2] 수량·가격 실수/정수 정합성 체크
      const parsedQuantity = parseInt(quantity, 10);
      const parsedPrice = parseFloat(estimatedPrice);

      if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
        return fail(res, 400, '물품 수량은 1개 이상의 올바른 정수여야 합니다.');
      }
      if (isNaN(parsedPrice) || parsedPrice < 0) {
        return fail(res, 400, '예상 금액은 0 이상의 올바른 숫자여야 합니다.');
      }

      // [3] 영속성 모델 레이어 호출
      const request = await ProcurementModel.createRequest({
        userId,
        itemName,
        quantity: parsedQuantity,
        estimatedPrice: parsedPrice,
        purchaseUrl: purchaseUrl || null,
        reason,
      });

      return success(res, { request }, '물품 구매 신청서가 정상적으로 상신되었습니다.', 201);

    } catch (error) {
      console.error('물품 구매 신청 중 서버 예외 발생:', error);
      return fail(res, 500, '서버 오류로 물품 구매 신청에 실패했습니다.');
    }
  },

  /**
   * @function advanceStatus
   * @description [관리자 전용] 결재 이후의 실물 흐름 상태(approved → purchased → delivered)를 전이시킵니다.
   *              - approved  → purchased : 실제 구매 실행 시점. purchased_by/purchased_at 기록. expenseId(선택)로 지출 레코드 연결.
   *              - purchased → delivered : 물건 납품 확인 시점. delivered_at 기록.
   *              - 그 외 전이는 400 (예: pending에서 곧바로 purchased 등)
   *
   * Body:
   *   - status     : 'purchased' | 'delivered' (필수)
   *   - expenseId  : 정수 (선택, purchased 전이 시에만 유효). 이미 연결된 값이 있으면 유지, 없으면 세팅.
   */
  advanceStatus: async (req, res) => {
    try {
      const requestId = req.params.id;
      const actorId = req.user.id;
      const { status: targetStatus, expenseId } = req.body || {};

      // [1] 필수 파라미터 검증
      if (!targetStatus) {
        return fail(res, 400, '전이할 상태값(status)은 필수입니다.');
      }
      if (!['purchased', 'delivered'].includes(targetStatus)) {
        return fail(res, 400, '상태 전이는 purchased 또는 delivered만 가능합니다. 승인/반려는 /review 엔드포인트를 사용하세요.');
      }
      if (expenseId !== undefined && expenseId !== null && !Number.isInteger(Number(expenseId))) {
        return fail(res, 400, 'expenseId는 정수여야 합니다.');
      }

      // [2] 대상 서류 실존 확인
      const request = await ProcurementModel.findRequestById(requestId);
      if (!request) {
        return fail(res, 404, '존재하지 않는 물품 구매 신청서입니다.');
      }

      // [3] 정합 전이 규칙 검증 (현재 상태 → 목표 상태가 화이트리스트에 있어야 함)
      const expectedNext = LEGAL_TRANSITIONS[request.status];
      if (expectedNext !== targetStatus) {
        return fail(
          res,
          400,
          `현재 상태(${request.status})에서 ${targetStatus}(으)로는 전이할 수 없습니다. 허용 흐름: approved→purchased→delivered.`
        );
      }

      // [4] 목표 상태에 맞는 원자적 Model 호출
      let result;
      if (targetStatus === 'purchased') {
        result = await ProcurementModel.updateToPurchased(
          requestId,
          actorId,
          expenseId === undefined || expenseId === null ? null : Number(expenseId)
        );
      } else {
        // targetStatus === 'delivered'
        result = await ProcurementModel.updateToDelivered(requestId);
      }

      const outcomeMessage = targetStatus === 'purchased'
        ? `[${result.item_name}] 구매 처리가 완료되었습니다.`
        : `[${result.item_name}] 납품이 확인되었습니다.`;

      return success(res, { result }, outcomeMessage);

    } catch (error) {
      console.error('물품 구매 상태 전이 처리 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 상태 전이 처리에 실패했습니다.');
    }
  },

  /**
   * @function reviewProcurement
   * @description [관리자 전용] 기안된 물품 구매 신청 건을 심사하여 최종 승인 또는 반려 조치합니다.
   */
  reviewProcurement: async (req, res) => {
    try {
      const requestId = req.params.id;
      const reviewerId = req.user.id;
      const { status, rejectReason } = req.body;

      // [1] 필수 상태 파라미터 규격 대조
      if (!status || !VALID_REVIEW_STATUSES.includes(status)) {
        return fail(res, 400, '올바른 결재 판정 상태값(approved/rejected)을 입력해 주세요.');
      }

      // [2] 대상 서류 실존/결재 종결 여부 검증
      const request = await ProcurementModel.findRequestById(requestId);
      if (!request) {
        return fail(res, 404, '존재하지 않는 물품 구매 신청서입니다.');
      }
      if (request.status !== 'pending') {
        return fail(res, 400, '이미 최종 승인 혹은 반려 처리가 종결된 문서입니다.');
      }

      // [3] 최종 상태 원자적 반영
      const result = await ProcurementModel.updateRequestStatus(requestId, status, rejectReason || null, reviewerId);

      const outcomeMessage = status === 'approved'
        ? `[${result.item_name}] 물품 구매 신청이 최종 승인되었습니다. 비품 장부 등록 절차가 진행됩니다.`
        : `[${result.item_name}] 물품 구매 신청건이 반려되었습니다.`;

      return success(res, { result }, outcomeMessage);

    } catch (error) {
      console.error('물품 구매 심사 처리 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 결재 심사 처리에 실패했습니다.');
    }
  }
};

module.exports = ProcurementController;
