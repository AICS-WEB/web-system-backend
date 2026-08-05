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

  /**
   * @function findBudgets
   * @description 예산 장부 전체 목록을 조회하며, 각 예산의 승인(approved)된 지출 합계를 used_amount로 집계합니다.
   *              프론트는 total_budget - used_amount 로 잔액을 산출합니다. 최신 생성순 정렬.
   * @returns {Promise<Array>} 예산 목록 (각 항목에 used_amount 포함)
   */
  findBudgets: async () => {
    const queryText = `
      SELECT
        b.id, b.name, b.fund_type, b.project_id, b.total_budget,
        b.start_date, b.end_date, b.status,
        COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0) AS used_amount,
        b.created_at, b.updated_at
      FROM budgets b
      LEFT JOIN expenses e ON e.budget_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC;
    `;
    const { rows } = await db.query(queryText);
    return rows;
  },

  /**
   * @function findBudgetById
   * @description 예산 단건을 used_amount 집계와 함께 조회합니다. (수정/삭제 전 실존 검증 및 응답용)
   * @param {number} id - budgets.id
   * @returns {Promise<Object|undefined>}
   */
  findBudgetById: async (id) => {
    const queryText = `
      SELECT
        b.id, b.name, b.fund_type, b.project_id, b.total_budget,
        b.start_date, b.end_date, b.status,
        COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'approved'), 0) AS used_amount,
        b.created_at, b.updated_at
      FROM budgets b
      LEFT JOIN expenses e ON e.budget_id = b.id
      WHERE b.id = $1
      GROUP BY b.id;
    `;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function createBudget
   * @description 신규 예산 장부를 생성합니다. status 미지정 시 DB 기본값 'active'.
   * @param {Object} params - { name, fundType, projectId?, totalBudget, startDate, endDate, status? }
   * @returns {Promise<Object>} 생성된 예산 레코드
   */
  createBudget: async ({ name, fundType, projectId, totalBudget, startDate, endDate, status }) => {
    const queryText = `
      INSERT INTO budgets (name, fund_type, project_id, total_budget, start_date, end_date, status)
      VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::budget_status, 'active'))
      RETURNING id, name, fund_type, project_id, total_budget, start_date, end_date, status, created_at;
    `;
    const values = [name, fundType, projectId || null, totalBudget, startDate, endDate, status || null];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function updateBudget
   * @description 예산 장부의 필드를 부분 수정합니다. 전달된 필드만 동적으로 SET 합니다.
   * @param {number} id - budgets.id
   * @param {Object} fields - { name?, fund_type?, project_id?, total_budget?, start_date?, end_date?, status? } 중 수정 항목만
   * @returns {Promise<Object|undefined>} 수정된 레코드
   */
  updateBudget: async (id, fields) => {
    const allowed = ['name', 'fund_type', 'project_id', 'total_budget', 'start_date', 'end_date', 'status'];
    const setClauses = [];
    const values = [];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        values.push(fields[key]);
        setClauses.push(`${key} = $${values.length}`);
      }
    }
    if (setClauses.length === 0) {
      return BudgetModel.findBudgetById(id);
    }
    setClauses.push(`updated_at = now()`);
    values.push(id);

    const queryText = `
      UPDATE budgets
         SET ${setClauses.join(', ')}
       WHERE id = $${values.length}
      RETURNING id, name, fund_type, project_id, total_budget, start_date, end_date, status, updated_at;
    `;
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function deleteBudget
   * @description 예산 장부를 삭제합니다. expenses가 ON DELETE RESTRICT로 참조하므로, 지출 내역이 있으면 DB가 삭제를 거부합니다.
   *              (컨트롤러에서 사전 지출 존재 여부를 확인해 사용자 친화적 메시지로 안내합니다.)
   * @param {number} id - budgets.id
   * @returns {Promise<Object|undefined>} 삭제된 레코드의 id
   */
  deleteBudget: async (id) => {
    const { rows } = await db.query('DELETE FROM budgets WHERE id = $1 RETURNING id;', [id]);
    return rows[0];
  },

  /**
   * @function countExpensesByBudget
   * @description 특정 예산에 연결된 지출 내역 건수를 반환합니다. (예산 삭제 전 참조 무결성 사전 검사용)
   * @param {number} budgetId - budgets.id
   * @returns {Promise<number>} 연결된 지출 건수
   */
  countExpensesByBudget: async (budgetId) => {
    const { rows } = await db.query('SELECT COUNT(*)::int AS cnt FROM expenses WHERE budget_id = $1;', [budgetId]);
    return rows[0].cnt;
  },

  /**
   * @function findExpenses
   * @description 지출 내역 목록을 예산명(budget_name)/신청자명(user_name)과 함께 조회합니다. 선택 필터(budgetId/status/category)를 동적 결합.
   * @param {Object} filters - { budgetId?, status?, category? }
   * @returns {Promise<Array>} 지출 내역 목록
   */
  findExpenses: async ({ budgetId, status, category } = {}) => {
    const conditions = [];
    const values = [];
    if (budgetId) { values.push(budgetId); conditions.push(`e.budget_id = $${values.length}`); }
    if (status)   { values.push(status);   conditions.push(`e.status = $${values.length}`); }
    if (category) { values.push(category); conditions.push(`e.category = $${values.length}`); }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const queryText = `
      SELECT e.id, e.budget_id, b.name AS budget_name, e.user_id, u.name AS user_name,
             e.category, e.item_name, e.amount, e.date, e.status, e.reject_reason,
             e.reviewed_by, e.reviewed_at, e.created_at
        FROM expenses e
        JOIN budgets b ON b.id = e.budget_id
        LEFT JOIN users u ON u.id = e.user_id
        ${whereClause}
       ORDER BY e.date DESC, e.id DESC;
    `;
    const { rows } = await db.query(queryText, values);
    return rows;
  },
};

module.exports = BudgetModel;
