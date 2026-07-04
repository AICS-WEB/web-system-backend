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

module.exports = router;
