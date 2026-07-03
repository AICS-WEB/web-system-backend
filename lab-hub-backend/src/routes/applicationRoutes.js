/**
 * @file applicationRoutes.js
 * @description 연구생 지원서 제출 및 관리자용 선발 심사 API 경로를 정의하고 권한 가드를 바인딩하는 라우터 레이어입니다.
 */

const express = require('express');
const router = express.Router();
const applicationController = require('../controllers/applicationController');

// 코어 보안 인프라인 JWT 검증 및 RBAC 인가 미들웨어 가드 로드
const { authenticateToken, authorizeRoles } = require('../middlewares/authMiddleware');

/**
 * @route   POST /api/applications/submit
 * @desc    학부 연구생 지원서 신규 접수 상신 (이메일 및 필수 서식 정형 검사 가동)
 * @access  Private (연구실 가입 완료된 학부생 및 외부 인증 유저 대상)
 */
router.post('/submit', authenticateToken, applicationController.submitApplication);

/**
 * @route   PUT /api/applications/:id/review
 * @desc    [관리자 전용] 기안된 연구생 지원서 최종 심사 합격 및 반려 통제
 * @access  Private (manager, admin 권한 전용 가드 배포)
 */
router.put(
  '/:id/review',
  authenticateToken,
  authorizeRoles('manager', 'admin'),
  applicationController.reviewApplication
);

module.exports = router; // app.js 글로벌 미들웨어 파이프라인에 마운트하기 위해 export합니다.