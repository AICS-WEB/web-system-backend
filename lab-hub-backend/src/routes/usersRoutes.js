/**
 * @file usersRoutes.js
 * @description 사용자 관련 인증 개방형 라우트 및 미들웨어 보호형 라우트 명세입니다.
 */

const express = require('express');
const router = express.Router();
const usersController = require('../controllers/usersController');
const { success } = require('../utils/response');

// 팀 표준 인증 미들웨어(authMiddleware) 및 역할 기반 인가 헬퍼(requireRole)를 로드합니다.
const { authMiddleware, requireRole } = require('../middlewares/authMiddleware');

/**
 * ==========================================
 * 🔒 Protected Routes (인증/인가 필요)
 * ==========================================
 *
 * NOTE: /register 와 /login 은 /api/auth 도메인으로 통일했습니다.
 *       /api/auth 라우터가 Access(30분) + Refresh(14일) 이중 토큰 파이프라인을 완비하고 있어
 *       사용자 관리(/api/users)는 리소스 자체(프로필/권한)에만 집중합니다.
 *       구 usersController.registerUser / loginUser 는 참조되지 않으며 추후 정리 예정입니다.
 */

/**
 * @route GET /api/users/me
 * @desc 내 프로필 조회 (로그인한 사람 누구나 자신의 토큰으로 접근)
 */
router.get('/me', authMiddleware, (req, res) => {
  // 미들웨어가 주입해준 req.user 데이터를 그대로 반환하여 인증 성공을 증명합니다.
  return success(res, { user: req.user }, '인증 유저 정보 조회 성공');
});

/**
 * @route  GET /api/users/me/profile
 * @desc   [본인] 토큰 주체의 전체 프로필을 DB에서 조회 (마이페이지)
 * @access Private
 */
router.get('/me/profile', authMiddleware, usersController.getMyProfile);

/**
 * @route  PATCH /api/users/me
 * @desc   [본인] 프로필 수정 (email/studentId/role/status 제외)
 * @access Private
 */
router.patch('/me', authMiddleware, usersController.updateMyProfile);

/**
 * @route  POST /api/users/me/password
 * @desc   [본인] 로그인 상태 비밀번호 변경 (현재 비밀번호 검증)
 * @access Private
 */
router.post('/me/password', authMiddleware, usersController.changePassword);

/**
 * @route GET /api/users/admin-dashboard
 * @desc 최고 관리자 전용 대시보드 (role이 manager 또는 admin인 핵심 인력만 접근 가능)
 */
router.get('/admin-dashboard', authMiddleware, requireRole('manager', 'admin'), (req, res) => {
  return success(
    res,
    { secretData: 'AICS Lab Core Management Matrix' },
    '관리자 보호 자원 접근 승인 완료'
  );
});

/**
 * @route  GET /api/users
 * @desc   [관리자 전용] 전체 사용자 목록 조회 (민감정보 제외)
 * @access Private (manager/admin)
 */
router.get(
  '/',
  authMiddleware,
  requireRole('manager', 'admin'),
  usersController.listUsers
);

/**
 * @route  GET /api/users/pending
 * @desc   [관리자 전용] 가입 승인 대기(pending) 상태 유저 목록 조회
 * @access Private (manager/admin)
 */
router.get(
  '/pending',
  authMiddleware,
  requireRole('manager', 'admin'),
  usersController.getPendingUsers
);

/**
 * @route  PATCH /api/users/:id/approve
 * @desc   [관리자 전용] 특정 가입 신청 건을 승인(approved) 처리
 * @access Private (manager/admin)
 */
router.patch(
  '/:id/approve',
  authMiddleware,
  requireRole('manager', 'admin'),
  usersController.approveUser
);

/**
 * @route  PATCH /api/users/:id/reject
 * @desc   [관리자 전용] 특정 가입 신청 건을 반려(rejected) 처리
 * @access Private (manager/admin)
 */
router.patch(
  '/:id/reject',
  authMiddleware,
  requireRole('manager', 'admin'),
  usersController.rejectUser
);

/**
 * @route  PATCH /api/users/:id/role
 * @desc   [관리자 전용] 특정 사용자의 역할(role) 변경
 * @access Private (manager/admin)
 */
router.patch(
  '/:id/role',
  authMiddleware,
  requireRole('manager', 'admin'),
  usersController.changeRole
);

/**
 * @route  PATCH /api/users/:id/status
 * @desc   [관리자 전용] 특정 사용자의 계정 상태(account_status) 변경 (deactivated 포함)
 * @access Private (manager/admin)
 */
router.patch(
  '/:id/status',
  authMiddleware,
  requireRole('manager', 'admin'),
  usersController.changeStatus
);

module.exports = router;
