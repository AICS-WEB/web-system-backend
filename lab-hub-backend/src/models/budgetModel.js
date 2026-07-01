/**
 * @file budgetModel.js
 * @description 과제 예산 및 지출 내역(expenses) 테이블에 접근하여 SQL 질의를 수행하는 모델 레이어입니다.
 */

const db = require('../config/db'); // 데이터베이스 커넥션 풀 로드

const BudgetModel = {
  /**
   * @function findProjectBudgetStatus
   * @description 특정 과제의 총 배정 예산과 현재까지 승인(approved)된 총 지출액을 집계하여 반환합니다.
   * @param {number} projectId - 과제 고유 식별 ID (PK)
   * @returns {Promise<Object|null>} 총 예산 및 누적 지출액 객체
   */
  findProjectBudgetStatus: async (projectId) => {
    // 과제 마스터 테이블과 지출 테이블을 조인 및 그룹화하여 실시간 잔여 예산을 산출합니다.
    // 금액의 정밀도 보존을 위해 COALESCE 함수로 NULL 발생 시 0을 반환하도록 방어합니다.
    const queryText = `
      SELECT 
        p.id AS project_id,
        p.budget AS total_budget,
        COALESCE(SUM(e.amount), 0) AS total_spent
      FROM projects p
      LEFT JOIN expenses e ON p.id = e.project_id AND e.status = 'approved'
      WHERE p.id = $1
      GROUP BY p.id, p.budget;
    `;
    const { rows } = await db.query(queryText, [projectId]);
    return rows[0];
  },

  /**
   * @function createExpenseRequest
   * @description 연구원이 기안한 연구비 지출 내역을 최초 등록합니다. 초기 결재 상태는 'pending'입니다.
   * @param {Object} expenseData - 지출 상신 정보 DTO 객체
   * @returns {Promise<Object>} 등록 완료된 지출 레코드
   */
  createExpenseRequest: async (expenseData) => {
    const { projectId, userId, amount, expenseType, purpose, receiptType, receiptPath, receiptUrl } = expenseData;
    
    // 명세서에 맞춰 receipt_type에 따라 path와 url을 상호 배제 형태로 안전하게 인서트합니다.
    const queryText = `
      INSERT INTO expenses (
        project_id, user_id, amount, expense_type, purpose, 
        receipt_type, receipt_path, receipt_url, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', now(), now())
      RETURNING id, project_id, user_id, amount, expense_type, status, created_at;
    `;
    const values = [projectId, userId, amount, expenseType, purpose, receiptType, receiptPath, receiptUrl];
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
   * @description [관리자] 연구비 지출 내역서의 결재 상태를 최종 확정(approved/rejected)합니다.
   */
  updateExpenseStatus: async (expenseId, status, rejectReason, reviewerId) => {
    const queryText = `
      UPDATE expenses
      SET status = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now()
      WHERE id = $1
      RETURNING id, project_id, amount, status, reviewed_at;
    `;
    const values = [expenseId, status, rejectReason, reviewerId];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  }
};

module.exports = BudgetModel;