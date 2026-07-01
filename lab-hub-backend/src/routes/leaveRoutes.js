/**
 * @file leaveRoutes.js
 * @description 휴가 신청 및 결재 심사 API 엔드포인트를 정의하고 권한 가드를 바인딩하는 라우터 레이어입니다.
 */

const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/leaveController');

// 우리가 완벽하게 뼈대를 구축해 둔 토큰 검증 및 RBAC 인가 미들웨어 로드
const { authMiddleware, requireRole } = require('../middlewares/authMiddleware');

/**
 * @route   POST /api/leave/requests
 * @desc    신규 휴가 신청서 기안 상신 (소수점 한도 검증 및 서식 필터링 가동)
 * @access  Private (일반 연구원 등급 이상 토큰 인증 필수)
 */
router.post('/requests', authMiddleware, leaveController.requestLeave);

/**
 * @route   PUT /api/leave/requests/:id/review
 * @desc    [관리자 전용] 특정 휴가 기안서 최종 승인/반려 심사 및 출결 테이블 자동 업서트 연동
 * @access  Private (기장/랩장 및 교수 등급 전용 방어벽 배포)
 */
router.put(
  '/requests/:id/review', 
  authMiddleware, 
  requireRole('manager', 'admin'), 
  leaveController.reviewLeave
);

module.exports = router; // app.js 글로벌 미들웨어 파이프라인에 탑재하기 위해 export합니다.