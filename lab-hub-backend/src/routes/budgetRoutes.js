/**
 * @file budgetRoutes.js
 * @description 연구비 지출 기안 및 회계 심사 API 엔드포인트를 열고 등급별 인가 가드를 매핑하는 라우터입니다.
 */

const express = require('express');
const router = express.Router();
const budgetController = require('../controllers/budgetController');

// 우리 코어 인프라인 JWT 검증 및 RBAC 미들웨어 가드 장착
const { authMiddleware, requireRole } = require('../middlewares/authMiddleware');

/**
 * @route   POST /api/budget/expenses
 * @desc    연구비 지출 내역서 기안 상신 (잔여 예산 및 영수증 증빙 무결성 검사 가동)
 * @access  Private (연구실 승인 유저 전체)
 */
router.post('/expenses', authMiddleware, budgetController.requestExpense);

/**
 * @route   GET /api/budget/expenses
 * @desc    지출 내역 목록 조회 (?budgetId=&status=&category= 필터, 예산명/신청자명 JOIN)
 * @access  Private (로그인만 하면 role 무관 조회 — 공용 회계 자산)
 */
router.get('/expenses', authMiddleware, budgetController.listExpenses);

/**
 * @route   GET /api/budget/budgets
 * @desc    예산 장부 목록 조회 (승인 지출 합계 used_amount 포함)
 * @access  Private (로그인만 하면 role 무관 조회)
 */
router.get('/budgets', authMiddleware, budgetController.listBudgets);

/**
 * @route   POST /api/budget/budgets
 * @desc    [관리자 전용] 신규 예산 장부 생성
 * @access  Private (manager/admin)
 */
router.post('/budgets', authMiddleware, requireRole('manager', 'admin'), budgetController.createBudget);

/**
 * @route   PATCH /api/budget/budgets/:id
 * @desc    [관리자 전용] 예산 장부 수정
 * @access  Private (manager/admin)
 */
router.patch('/budgets/:id', authMiddleware, requireRole('manager', 'admin'), budgetController.updateBudget);

/**
 * @route   DELETE /api/budget/budgets/:id
 * @desc    [관리자 전용] 예산 장부 삭제 (연결 지출 있으면 409)
 * @access  Private (manager/admin)
 */
router.delete('/budgets/:id', authMiddleware, requireRole('manager', 'admin'), budgetController.deleteBudget);

/**
 * @route   PUT /api/budget/expenses/:id/review
 * @desc    [관리자 전용] 기안된 연구비 청구 서류 최종 심사 및 확정
 * @access  Private (기장/랩장 및 교수 등급 전용 방어벽 배포)
 */
router.put(
  '/expenses/:id/review',
  authMiddleware,
  requireRole('manager', 'admin'),
  budgetController.reviewExpense
);

module.exports = router;