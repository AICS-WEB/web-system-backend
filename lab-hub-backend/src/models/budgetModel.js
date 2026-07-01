/**
 * @file budgetModel.js
 * @description 예산(budgets) 및 지출 내역(expenses) 테이블에 접근하여 SQL 질의를 수행하는 모델 레이어입니다.
 *
 * 실제 스키마 매핑:
 *  - budgets            : 예산 마스터 (project_id → research_projects, total_budget 등)
 *  - expenses           : 지출 내역 (budget_id, category, item_name, amount, date, status, ...)
 *  - expense_receipts   : 지출 영수증 첨부 (하이브리드 storage: drive/nas)
 *
 * 잔여 예산 계산: budgets.total_budget - COALESCE(SUM(expenses.amount WHERE status='approved'), 0)
 */

const db = require('../config/db'); // 데이터베이스 커넥션 풀 로드

const BudgetModel = {
  /**
   * @function findBudgetStatus
   * @description 특정 예산의 총 배정액과 현재까지 승인(approved)된 지출액 합계를 반환합니다.
   *              프론트/컨트롤러는 total_budget - total_spent 로 잔여 한도를 산출합니다.
   * @param {number} budgetId - budgets.id
   * @returns {Promise<Object|null>} { budget_id, name, fund_type, project_id, total_budget, total_spent } | null
   */
  findBudgetStatus: async (budgetId) => {
    const queryText = `
      SELECT
        b.id           AS budget_id,
        b.name,
        b.fund_type,
        b.project_id,
        b.total_budget,
        COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0) AS total_spent
      FROM budgets b
      LEFT JOIN expenses e ON e.budget_id = b.id
      WHERE b.id = $1
      GROUP BY b.id;
    `;
    const { rows } = await db.query(queryText, [budgetId]);
    return rows[0];
  },

  /**
   * @function createExpense
   * @description 신규 지출 기안 레코드를 삽입합니다. 초기 status는 DB 기본값 'pending'.
   * @param {Object} params - { budgetId, userId, category, itemName, amount, date }
   * @returns {Promise<Object>} 등록된 지출 레코드
   */
  createExpense: async ({ budgetId, userId, category, itemName, amount, date }) => {
    const queryText = `
      INSERT INTO expenses (budget_id, user_id, category, item_name, amount, date)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, budget_id, user_id, category, item_name, amount, date, status, created_at;
    `;
    const values = [budgetId, userId || null, category, itemName, amount, date];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function createReceipt
   * @description 지출 건에 첨부되는 영수증 레코드를 삽입합니다. storage_type(drive/nas)에 따라 file_url 또는 filepath 중 하나가 유효.
   * @param {Object} params - { expenseId, filename, mimeType, storageType, fileUrl, filepath, filesize }
   */
  createReceipt: async ({ expenseId, filename, mimeType, storageType, fileUrl, filepath, filesize }) => {
    const queryText = `
      INSERT INTO expense_receipts (
        expense_id, filename, mime_type, storage_type, file_url, filepath, filesize
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, expense_id, filename, storage_type, file_url, filepath;
    `;
    const values = [
      expenseId,
      filename,
      mimeType || null,
      storageType,
      storageType === 'drive' ? (fileUrl || null) : null,
      storageType === 'nas' ? (filepath || null) : null,
      filesize || null,
    ];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function findExpenseById
   * @description 심사 무결성 체크를 위해 특정 지출 서류 내역을 단건 조회합니다.
   */
  findExpenseById: async (id) => {
    const queryText = `SELECT * FROM expenses WHERE id = $1;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function updateExpenseStatus
   * @description [관리자] 지출 내역서 결재 상태를 최종 승인/반려로 확정합니다.
   */
  updateExpenseStatus: async (expenseId, status, rejectReason, reviewerId) => {
    const queryText = `
      UPDATE expenses
         SET status        = $2,
             reject_reason = $3,
             reviewed_by   = $4,
             reviewed_at   = now(),
             updated_at    = now()
       WHERE id = $1
      RETURNING id, budget_id, amount, status, reviewed_by, reviewed_at;
    `;
    const values = [expenseId, status, rejectReason, reviewerId];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },
};

module.exports = BudgetModel;
