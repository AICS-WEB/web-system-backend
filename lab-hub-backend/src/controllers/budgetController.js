/**
 * @file budgetController.js
 * @description 연구비 잔여 한도 및 하이브리드 영수증 증빙 무결성을 검증하는 회계 제어 컨트롤러 레이어입니다.
 */

const BudgetModel = require('../models/budgetModel');
const response = require('../utils/response');

const BudgetController = {
  /**
   * @function requestExpense
   * @description [인증 유저] 과제 잔여 예산을 대조하고 영수증 포맷을 필터링하여 지출 신청서를 기안합니다.
   */
  requestExpense: async (req, res) => {
    try {
      const userId = req.user.id;
      const { projectId, amount, expenseType, purpose, receiptType, receiptPath, receiptUrl } = req.body;

      // 1. 필수 파라미터 유효성 검증
      if (!projectId || !amount || !expenseType || !receiptType) {
        return response.error(res, '과제 ID, 지출 금액, 지출 유형, 영수증 증빙 방식은 필수 입력 항목입니다.', 400);
      }

      // 2. 하이브리드 영수증 상호 배제 무결성 체크
      if (receiptType === 'nas' && !receiptPath) {
        return response.error(res, '자체 스토리지(nas) 증빙 방식은 receiptPath(절대경로)가 필수입니다.', 400);
      }
      if (receiptType === 'drive' && !receiptUrl) {
        return response.error(res, '클라우드(drive) 증빙 방식은 receiptUrl(매출전표 링크)이 필수입니다.', 400);
      }

      // 3. 과제 잔여 예산 한도 연산 대조 알고리즘 (DECIMAL 기반 실수 변환)
      const budgetStatus = await BudgetModel.findProjectBudgetStatus(projectId);
      if (!budgetStatus) {
        return response.error(res, '존재하지 않거나 예산 장부가 개설되지 않은 연구 과제입니다.', 404);
      }

      const totalBudget = parseFloat(budgetStatus.total_budget);
      const totalSpent = parseFloat(budgetStatus.total_spent);
      const inputAmount = parseFloat(amount);

      if (totalSpent + inputAmount > totalBudget) {
        return response.error(res, `해당 과제의 연구비 잔여 한도가 부족하여 상신할 수 없습니다. (현재 누적 지출액: ${totalSpent}원 / 총 예산: ${totalBudget}원)`, 400);
      }

      // 4. 영속성 모델 레이어 호출 및 데이터 적재
      const expense = await BudgetModel.createExpenseRequest({
        projectId, userId, amount: inputAmount, expenseType, purpose,
        receiptType, receiptPath: receiptType === 'nas' ? receiptPath : null,
        receiptUrl: receiptType === 'drive' ? receiptUrl : null
      });

      return response.success(res, '연구비 지출 결재 신청서가 성공적으로 기안되었습니다.', { expense }, 201);

    } catch (error) {
      console.error('연구비 지출 기안 중 서버 예외 에러:', error);
      return response.error(res, '서버 오류로 지출 기안에 실패했습니다.', 500);
    }
  },

  /**
   * @function reviewExpense
   * @description [관리자 전용] 기안된 연구비 서류를 심사하여 최종 승인 또는 반려 처리합니다.
   */
  reviewExpense: async (req, res) => {
    try {
      const expenseId = req.params.id;
      const reviewerId = req.user.id;
      const { status, rejectReason } = req.body;

      if (!status || !['approved', 'rejected'].includes(status)) {
        return response.error(res, '올바른 심사 결과 상태값(approved/rejected)을 전달해 주세요.', 400);
      }

      const expense = await BudgetModel.findExpenseById(expenseId);
      if (!expense) {
        return response.error(res, '존재하지 않는 연구비 지출 기안서입니다.', 404);
      }

      if (expense.status !== 'pending') {
        return response.error(res, '이미 결재 심사가 종결된 연구비 서류입니다.', 400);
      }

      // 최종 상태 업데이트 반영
      const result = await BudgetModel.updateExpenseStatus(expenseId, status, rejectReason || null, reviewerId);
      const msg = status === 'approved' ? '연구비 지출 신청건을 최종 승인(정산 반영)했습니다.' : '연구비 지출 신청건을 반려했습니다.';

      return response.success(res, msg, { result }, 200);

    } catch (error) {
      console.error('연구비 지출 심사 중 서버 예외 에러:', error);
      return response.error(res, '서버 오류로 결재 심사 처리에 실패했습니다.', 500);
    }
  }
};

module.exports = BudgetController;