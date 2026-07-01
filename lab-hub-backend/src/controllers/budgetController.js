/**
 * @file budgetController.js
 * @description 예산 잔여 한도 및 지출 영수증 첨부 무결성을 검증하는 회계 제어 컨트롤러 레이어입니다.
 *
 * 스키마 정합성:
 *  - 지출은 budgets(예산) 단위에 귀속됩니다 (budget_id).
 *  - 카테고리는 expense_category ENUM: personnel/activity/material/other
 *  - 영수증은 expense_receipts 별도 테이블. drive → file_url, nas → filepath 필수.
 */

const BudgetModel = require('../models/budgetModel');
const { success, fail } = require('../utils/response');

// expense_category ENUM 유효값
const VALID_CATEGORIES = ['personnel', 'activity', 'material', 'other'];

// expense_status ENUM 유효값 (심사 결과)
const VALID_REVIEW_STATUSES = ['approved', 'rejected'];

const BudgetController = {
  /**
   * @function requestExpense
   * @description [인증 유저] 예산 잔여 한도를 대조하고, 선택적으로 영수증을 함께 등록하여 지출 신청서를 기안합니다.
   *
   * Body:
   *   - budgetId (필수, int)
   *   - category (필수, ENUM)
   *   - itemName (필수, string)
   *   - amount   (필수, number)
   *   - date     (필수, YYYY-MM-DD)
   *   - receipt  (선택, { storageType, filename, fileUrl?, filepath?, mimeType?, filesize? })
   */
  requestExpense: async (req, res) => {
    try {
      const userId = req.user.id;
      const { budgetId, category, itemName, amount, date, receipt } = req.body;

      // 1. 필수 파라미터 검증
      if (!budgetId || !category || !itemName || !amount || !date) {
        return fail(res, 400, '예산 ID, 카테고리, 항목명, 금액, 지출일은 필수 입력 항목입니다.');
      }
      if (!VALID_CATEGORIES.includes(category)) {
        return fail(res, 400, `유효하지 않은 지출 카테고리입니다: ${category}`);
      }

      // 2. 영수증 첨부(선택)의 하이브리드 스토리지 규격 방어 검증
      if (receipt) {
        if (!receipt.storageType || !receipt.filename) {
          return fail(res, 400, '영수증 storageType과 filename은 필수입니다.');
        }
        if (!['drive', 'nas'].includes(receipt.storageType)) {
          return fail(res, 400, '영수증 storageType은 drive 또는 nas만 허용됩니다.');
        }
        if (receipt.storageType === 'drive' && !receipt.fileUrl) {
          return fail(res, 400, 'drive 저장 방식은 fileUrl이 필수입니다.');
        }
        if (receipt.storageType === 'nas' && !receipt.filepath) {
          return fail(res, 400, 'nas 저장 방식은 filepath가 필수입니다.');
        }
      }

      // 3. 예산 잔여 한도 대조
      const budgetStatus = await BudgetModel.findBudgetStatus(budgetId);
      if (!budgetStatus) {
        return fail(res, 404, '존재하지 않거나 예산 장부가 개설되지 않은 예산입니다.');
      }

      const totalBudget = parseFloat(budgetStatus.total_budget);
      const totalSpent  = parseFloat(budgetStatus.total_spent);
      const inputAmount = parseFloat(amount);

      if (isNaN(inputAmount) || inputAmount <= 0) {
        return fail(res, 400, '지출 금액은 0원보다 큰 올바른 숫자여야 합니다.');
      }
      if (totalSpent + inputAmount > totalBudget) {
        return fail(res, 400, `해당 예산의 잔여 한도가 부족합니다. (누적 지출: ${totalSpent}원 / 총 예산: ${totalBudget}원)`);
      }

      // 4. 지출 레코드 INSERT
      const expense = await BudgetModel.createExpense({
        budgetId,
        userId,
        category,
        itemName,
        amount: inputAmount,
        date,
      });

      // 5. 영수증 함께 저장 (선택)
      let receiptRow = null;
      if (receipt) {
        receiptRow = await BudgetModel.createReceipt({
          expenseId: expense.id,
          filename: receipt.filename,
          mimeType: receipt.mimeType,
          storageType: receipt.storageType,
          fileUrl: receipt.fileUrl,
          filepath: receipt.filepath,
          filesize: receipt.filesize,
        });
      }

      return success(res, { expense, receipt: receiptRow }, '연구비 지출 결재 신청서가 성공적으로 기안되었습니다.', 201);

    } catch (error) {
      console.error('연구비 지출 기안 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 지출 기안에 실패했습니다.');
    }
  },

  /**
   * @function reviewExpense
   * @description [관리자 전용] 기안된 지출 서류를 심사하여 최종 승인/반려 처리합니다.
   */
  reviewExpense: async (req, res) => {
    try {
      const expenseId = req.params.id;
      const reviewerId = req.user.id;
      const { status, rejectReason } = req.body;

      if (!status || !VALID_REVIEW_STATUSES.includes(status)) {
        return fail(res, 400, '올바른 심사 결과 상태값(approved/rejected)을 전달해 주세요.');
      }

      const expense = await BudgetModel.findExpenseById(expenseId);
      if (!expense) {
        return fail(res, 404, '존재하지 않는 연구비 지출 기안서입니다.');
      }

      if (expense.status !== 'pending') {
        return fail(res, 400, '이미 결재 심사가 종결된 연구비 서류입니다.');
      }

      const result = await BudgetModel.updateExpenseStatus(expenseId, status, rejectReason || null, reviewerId);
      const msg = status === 'approved'
        ? '연구비 지출 신청건을 최종 승인(정산 반영)했습니다.'
        : '연구비 지출 신청건을 반려했습니다.';

      return success(res, { result }, msg);

    } catch (error) {
      console.error('연구비 지출 심사 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 결재 심사 처리에 실패했습니다.');
    }
  }
};

module.exports = BudgetController;
