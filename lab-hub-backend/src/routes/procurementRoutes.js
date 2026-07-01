/**
 * @file procurementRoutes.js
 * @description 물품 구매 신청 및 행정 결재 심사 API 엔드포인트를 열고 권한 가드를 바인딩하는 라우터 레이어입니다.
 */

const express = require('express');
const router = express.Router();
const procurementController = require('../controllers/procurementController');

// 코어 보안 인프라인 JWT 검증 및 RBAC 인가 미들웨어 가드 로드
const { authenticateToken, authorizeRoles } = require('../middlewares/authMiddleware');

/**
 * @route   POST /api/procurement/requests
 * @desc    신규 물품 구매 신청서 상신 (수량 및 가격 수치 벨리데이션 가동)
 * @access  Private (연구실 승인 유저 전체)
 */
router.post('/requests', authenticateToken, procurementController.requestProcurement);

/**
 * @route   PUT /api/procurement/requests/:id/review
 * @desc    [관리자 전용] 기안된 물품 구매 서류 최종 심사 확정 및 반려
 * @access  Private (기장/랩장 및 교수 등급 전용 방어벽 배포)
 */
router.put(
  '/requests/:id/review',
  authenticateToken,
  authorizeRoles('manager', 'admin'),
  procurementController.reviewProcurement
);

module.exports = router; // app.js 글로벌 미들웨어 파이프라인에 마운트하기 위해 export합니다.