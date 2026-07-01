/**
 * @file budgetRoutes.js
 * @description 연구비 지출 기안 및 회계 심사 API 엔드포인트를 열고 등급별 인가 가드를 매핑하는 라우터입니다.
 */

const express = require('express');
const router = express.Router();
const budgetController = require('../controllers/budgetController');

// 우리 코어 인프라인 JWT 검증 및 RBAC 미들웨어 가드 장착
const { authenticateToken, authorizeRoles } = require('../middlewares/authMiddleware');

/**
 * @route   POST /api/budget/expenses
 * @desc    연구비 지출 내역서 기안 상신 (잔여 예산 및 영수증 증빙 무결성 검사 가동)
 * @access  Private (연구실 승인 유저 전체)
 */
router.post('/expenses', authenticateToken, budgetController.requestExpense);

/**
 * @route   PUT /api/budget/expenses/:id/review
 * @desc    [관리자 전용] 기안된 연구비 청구 서류 최종 심사 및 확정
 * @access  Private (기장/랩장 및 교수 등급 전용 방어벽 배포)
 */
router.put(
  '/expenses/:id/review',
  authenticateToken,
  authorizeRoles('manager', 'admin'),
  budgetController.reviewExpense
);

module.exports = router;