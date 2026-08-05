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

// expense_status 전체(목록 필터용): pending 포함
const VALID_EXPENSE_STATUSES = ['pending', 'approved', 'rejected'];

// fund_type ENUM 유효값 (예산 재원 구분)
const VALID_FUND_TYPES = ['department', 'research', 'other'];

// budget_status ENUM 유효값 (예산 장부 상태)
const VALID_BUDGET_STATUSES = ['active', 'completed', 'pending'];

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
  },

  /**
   * @function listBudgets
   * @description [인증 유저 전체] 예산 장부 목록을 승인 지출 합계(used_amount)와 함께 조회합니다. 공용 회계 자산이므로 role 무관 열람.
   */
  listBudgets: async (req, res) => {
    try {
      const budgets = await BudgetModel.findBudgets();
      return success(res, budgets);
    } catch (error) {
      console.error('예산 장부 목록 조회 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 예산 장부 조회에 실패했습니다.');
    }
  },

  /**
   * @function createBudget
   * @description [관리자 전용] 신규 예산 장부를 생성합니다.
   *
   * Body: name, fundType, totalBudget, startDate, endDate (필수), projectId, status (선택)
   */
  createBudget: async (req, res) => {
    try {
      const { name, fundType, projectId, totalBudget, startDate, endDate, status } = req.body || {};

      // [1] 필수 항목 검증
      if (!name || !fundType || totalBudget === undefined || !startDate || !endDate) {
        return fail(res, 400, '예산명, 재원 구분, 총액, 시작/종료 일자는 필수 입력 항목입니다.');
      }
      // [2] enum 검증
      if (!VALID_FUND_TYPES.includes(fundType)) {
        return fail(res, 400, `유효하지 않은 재원 구분입니다. 허용 값: ${VALID_FUND_TYPES.join(', ')}.`);
      }
      if (status !== undefined && !VALID_BUDGET_STATUSES.includes(status)) {
        return fail(res, 400, `유효하지 않은 예산 상태입니다. 허용 값: ${VALID_BUDGET_STATUSES.join(', ')}.`);
      }
      // [3] 금액 정합성
      const parsedTotal = parseFloat(totalBudget);
      if (isNaN(parsedTotal) || parsedTotal < 0) {
        return fail(res, 400, '총 예산액은 0 이상의 올바른 숫자여야 합니다.');
      }
      // [4] 기간 정합성 (DB CHECK(start<=end)의 사전 방어)
      if (new Date(startDate) > new Date(endDate)) {
        return fail(res, 400, '종료 일자가 시작 일자보다 앞설 수 없습니다.');
      }

      const budget = await BudgetModel.createBudget({
        name, fundType, projectId, totalBudget: parsedTotal, startDate, endDate, status,
      });
      return success(res, budget, '예산 장부가 생성되었습니다.', 201);
    } catch (error) {
      console.error('예산 장부 생성 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 예산 장부 생성에 실패했습니다.');
    }
  },

  /**
   * @function updateBudget
   * @description [관리자 전용] 예산 장부를 부분 수정합니다. 전달된 필드만 반영합니다.
   *
   * Body (모두 선택, 최소 1개): name, fundType, projectId, totalBudget, startDate, endDate, status
   */
  updateBudget: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, fundType, projectId, totalBudget, startDate, endDate, status } = req.body || {};

      // [1] 실존 확인
      const existing = await BudgetModel.findBudgetById(id);
      if (!existing) {
        return fail(res, 404, '존재하지 않는 예산 장부입니다.');
      }

      // [2] 전달된 필드만 정규화 + 값 검증
      const fields = {};
      if (name !== undefined) fields.name = name;
      if (fundType !== undefined) {
        if (!VALID_FUND_TYPES.includes(fundType)) {
          return fail(res, 400, `유효하지 않은 재원 구분입니다. 허용 값: ${VALID_FUND_TYPES.join(', ')}.`);
        }
        fields.fund_type = fundType;
      }
      if (status !== undefined) {
        if (!VALID_BUDGET_STATUSES.includes(status)) {
          return fail(res, 400, `유효하지 않은 예산 상태입니다. 허용 값: ${VALID_BUDGET_STATUSES.join(', ')}.`);
        }
        fields.status = status;
      }
      if (totalBudget !== undefined) {
        const parsedTotal = parseFloat(totalBudget);
        if (isNaN(parsedTotal) || parsedTotal < 0) {
          return fail(res, 400, '총 예산액은 0 이상의 올바른 숫자여야 합니다.');
        }
        fields.total_budget = parsedTotal;
      }
      if (projectId !== undefined) fields.project_id = projectId === '' ? null : projectId;
      if (startDate !== undefined) fields.start_date = startDate;
      if (endDate !== undefined) fields.end_date = endDate;

      if (Object.keys(fields).length === 0) {
        return fail(res, 400, '수정할 필드를 최소 하나 이상 전달해야 합니다.');
      }

      const updated = await BudgetModel.updateBudget(id, fields);
      return success(res, updated, '예산 장부가 수정되었습니다.');
    } catch (error) {
      console.error('예산 장부 수정 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 예산 장부 수정에 실패했습니다.');
    }
  },

  /**
   * @function deleteBudget
   * @description [관리자 전용] 예산 장부를 삭제합니다. 연결된 지출 내역이 있으면 참조 무결성 보호를 위해 409로 차단합니다.
   */
  deleteBudget: async (req, res) => {
    try {
      const { id } = req.params;

      const existing = await BudgetModel.findBudgetById(id);
      if (!existing) {
        return fail(res, 404, '존재하지 않는 예산 장부입니다.');
      }

      // expenses가 ON DELETE RESTRICT로 참조하므로, 지출이 하나라도 있으면 사전에 409로 안내합니다.
      const expenseCount = await BudgetModel.countExpensesByBudget(id);
      if (expenseCount > 0) {
        return fail(res, 409, `연결된 지출 내역이 ${expenseCount}건 있어 삭제할 수 없습니다. 지출 내역을 먼저 정리하세요.`);
      }

      const deleted = await BudgetModel.deleteBudget(id);
      return success(res, { id: deleted.id }, '예산 장부가 삭제되었습니다.');
    } catch (error) {
      console.error('예산 장부 삭제 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 예산 장부 삭제에 실패했습니다.');
    }
  },

  /**
   * @function listExpenses
   * @description [인증 유저 전체] 지출 내역 목록을 예산명/신청자명과 함께 조회합니다. 선택 필터(budgetId/status/category) 지원.
   */
  listExpenses: async (req, res) => {
    try {
      const { budgetId, status, category } = req.query;

      if (status !== undefined && !VALID_EXPENSE_STATUSES.includes(status)) {
        return fail(res, 400, `유효하지 않은 상태 필터입니다. 허용 값: ${VALID_EXPENSE_STATUSES.join(', ')}.`);
      }
      if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
        return fail(res, 400, `유효하지 않은 분류 필터입니다. 허용 값: ${VALID_CATEGORIES.join(', ')}.`);
      }

      const expenses = await BudgetModel.findExpenses({
        budgetId: budgetId || null,
        status: status || null,
        category: category || null,
      });
      return success(res, expenses);
    } catch (error) {
      console.error('지출 내역 목록 조회 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 지출 내역 조회에 실패했습니다.');
    }
  }
};

module.exports = BudgetController;
