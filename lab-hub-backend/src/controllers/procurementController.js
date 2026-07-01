/**
 * @file procurementController.js
 * @description 물품 구매 수량 및 한도 실수형 데이터 검증과 승인 워크플로우를 제어하는 컨트롤러 레이어입니다.
 */

const ProcurementModel = require('../models/procurementModel');
const response = require('../utils/response'); // 팀 표준 공통 응답 유틸 연동

const ProcurementController = {
  /**
   * @function requestProcurement
   * @description [인증 유저] 구매 필수 서식을 필터링하고 수량·금액 무결성을 검증하여 신규 물품 구매를 신청합니다.
   */
  requestProcurement: async (req, res) => {
    try {
      const userId = req.user.id; // 토큰에서 디코딩된 연구원 식별자
      const { itemPlainName, specification, quantity, estimatedPrice, purpose } = req.body;

      // [알고리즘 1단계] 필수 서식 파라미터 유효성 검증
      if (!itemPlainName || !quantity || !estimatedPrice) {
        return response.error(res, '물품명, 수량, 예상 금액은 필수 입력 항목입니다.', 400);
      }

      // [알고리즘 2단계] 정수 및 실수 연산 정합성 체크
      const parsedQuantity = parseInt(quantity, 10);
      const parsedPrice = parseFloat(estimatedPrice);

      if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
        return response.error(res, '물품 수량은 1개 이상의 올바른 정수여야 합니다.', 400);
      }
      if (isNaN(parsedPrice) || parsedPrice <= 0) {
        return response.error(res, '예상 금액은 0원보다 큰 올바른 숫자여야 합니다.', 400);
      }

      // [알고리즘 3단계] 영속성 모델 레이어 호출 및 데이터 적재
      const request = await ProcurementModel.createRequest({
        userId,
        itemPlainName,
        specification: specification || null,
        quantity: parsedQuantity,
        estimatedPrice: parsedPrice,
        purpose: purpose || null
      });

      return response.success(res, '물품 구매 신청서가 정상적으로 상신되었습니다.', { request }, 201);

    } catch (error) {
      console.error('물품 구매 신청 중 서버 예외 발생:', error);
      return response.error(res, '서버 오류로 물품 구매 신청에 실패했습니다.', 500);
    }
  },

  /**
   * @function reviewProcurement
   * @description [관리자 전용] 기안된 물품 구매 신청 건을 심사하여 최종 승인 또는 반려 조치합니다.
   */
  reviewProcurement: async (req, res) => {
    try {
      const requestId = req.params.id;
      const reviewerId = req.user.id; // 결재를 승인한 관리자 고유 ID
      const { status, rejectReason } = req.body; // 'approved' 또는 'rejected'

      // 1. 필수 상태 파라미터 규격 대조
      if (!status || !['approved', 'rejected'].includes(status)) {
        return response.error(res, '올바른 결재 판정 상태값(approved/rejected)을 입력해 주세요.', 400);
      }

      // 2. 해당 신청 서류의 실존 여부 및 결재 종결 여부 무결성 검증
      const request = await ProcurementModel.findRequestById(requestId);
      if (!request) {
        return response.error(res, '존재하지 않는 물품 구매 신청서입니다.', 404);
      }

      if (request.status !== 'pending') {
        return response.error(res, '이미 최종 승인 혹은 반려 처리가 종결된 문서입니다.', 400);
      }

      // 3. 모델 레이어를 호출하여 최종 상태 원자적 반영
      const result = await ProcurementModel.updateRequestStatus(requestId, status, rejectReason || null, reviewerId);
      
      const outcomeMessage = status === 'approved'
        ? `[${result.item_plain_name}] 물품 구매 신청이 최종 승인되었습니다. 비품 장부 등록 절차가 진행됩니다.`
        : `[${result.item_plain_name}] 물품 구매 신청건이 반려되었습니다.`;

      return response.success(res, outcomeMessage, { result }, 200);

    } catch (error) {
      console.error('물품 구매 심사 처리 중 서버 예외 에러:', error);
      return response.error(res, '서버 오류로 결재 심사 처리에 실패했습니다.', 500);
    }
  }
};

module.exports = ProcurementController;