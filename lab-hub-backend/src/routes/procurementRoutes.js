/**
 * @file procurementRoutes.js
 * @description 물품 구매 신청 및 행정 결재 심사 API 엔드포인트를 열고 권한 가드를 바인딩하는 라우터 레이어입니다.
 */

const express = require('express');
const router = express.Router();
const procurementController = require('../controllers/procurementController');

// 코어 보안 인프라인 JWT 검증 및 RBAC 인가 미들웨어 가드 로드
const { authMiddleware, requireRole } = require('../middlewares/authMiddleware');

/**
 * @route   POST /api/procurement/requests
 * @desc    신규 물품 구매 신청서 상신 (수량 및 가격 수치 벨리데이션 가동)
 * @access  Private (연구실 승인 유저 전체)
 */
router.post('/requests', authMiddleware, procurementController.requestProcurement);

/**
 * @route   GET /api/procurement/requests
 * @desc    물품 구매 신청 목록 조회 (?status= 필터, 신청자 이름 JOIN, 최신순)
 * @access  Private (로그인만 하면 role 구분 없이 전체 조회 가능 — 공용 물품 구매 내역)
 * @note    정적 경로가 '/requests/:id' 파라미터 경로보다 먼저 등록되어야 매칭 우선순위가 보장됩니다.
 */
router.get('/requests', authMiddleware, procurementController.listRequests);

/**
 * @route   GET /api/procurement/requests/:id
 * @desc    물품 구매 신청 단건 상세 조회 (신청자 이름 JOIN, 미존재 시 404)
 * @access  Private (로그인만 하면 role 구분 없이 조회 가능)
 */
router.get('/requests/:id', authMiddleware, procurementController.getRequestDetail);

/**
 * @route   PATCH /api/procurement/requests/:id
 * @desc    [본인] 결재 전(pending) 구매 신청서 내용 수정
 * @access  Private (신청 본인)
 */
router.patch('/requests/:id', authMiddleware, procurementController.updateRequest);

/**
 * @route   DELETE /api/procurement/requests/:id
 * @desc    구매 신청서 삭제 (본인은 pending만, manager/admin은 상태 무관)
 * @access  Private (토큰 인증 필수)
 */
router.delete('/requests/:id', authMiddleware, procurementController.deleteRequest);

/**
 * @route   PUT /api/procurement/requests/:id/review
 * @desc    [관리자 전용] 기안된 물품 구매 서류 최종 심사 확정 및 반려
 * @access  Private (기장/랩장 및 교수 등급 전용 방어벽 배포)
 */
router.put(
  '/requests/:id/review',
  authMiddleware,
  requireRole('manager', 'admin'),
  procurementController.reviewProcurement
);

/**
 * @route   PUT /api/procurement/requests/:id/status
 * @desc    [관리자 전용] 결재 이후 실물 흐름 상태 전이 (approved→purchased, purchased→delivered)
 * @access  Private (기장/랩장 및 교수 등급 전용 방어벽 배포)
 */
router.put(
  '/requests/:id/status',
  authMiddleware,
  requireRole('manager', 'admin'),
  procurementController.advanceStatus
);

module.exports = router; // app.js 글로벌 미들웨어 파이프라인에 마운트하기 위해 export합니다.