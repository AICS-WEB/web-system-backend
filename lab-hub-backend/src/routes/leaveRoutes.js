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
 * @route   GET /api/leave/requests
 * @desc    휴가 신청 목록 조회 (?status= 필터, user_name JOIN). 관리자는 전체(+?userId=), 일반 유저는 본인 것만.
 * @access  Private (토큰 인증 필수)
 */
router.get('/requests', authMiddleware, leaveController.listRequests);

/**
 * @route   PATCH /api/leave/requests/:id
 * @desc    [본인] 결재 전(pending) 휴가 신청서 내용 수정
 * @access  Private (신청 본인)
 */
router.patch('/requests/:id', authMiddleware, leaveController.updateRequest);

/**
 * @route   DELETE /api/leave/requests/:id
 * @desc    휴가 신청서 삭제 (본인은 pending만, manager/admin은 상태 무관)
 * @access  Private (토큰 인증 필수)
 */
router.delete('/requests/:id', authMiddleware, leaveController.deleteRequest);

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

/**
 * @route   GET /api/leave/balance
 * @desc    [본인] 토큰 주체의 연차 잔여일 조회 (?year=YYYY, 기본값 현재 연도)
 * @access  Private (토큰 인증 필수)
 * @note    정적 경로가 '/balance/:userId' 파라미터 경로보다 반드시 먼저 등록되어야 매칭 우선순위가 보장됩니다.
 */
router.get('/balance', authMiddleware, leaveController.getMyBalance);

/**
 * @route   GET /api/leave/balance/:userId
 * @desc    [관리자 전용] 특정 유저의 연차 잔여일 조회 (?year=YYYY, 기본값 현재 연도)
 * @access  Private (기장/랩장 및 교수 등급 전용)
 */
router.get(
  '/balance/:userId',
  authMiddleware,
  requireRole('manager', 'admin'),
  leaveController.getUserBalance
);

module.exports = router; // app.js 글로벌 미들웨어 파이프라인에 탑재하기 위해 export합니다.