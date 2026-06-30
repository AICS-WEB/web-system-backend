/**
 * @file usersRoutes.js
 * @description 사용자 관련 인증 개방형 라우트 및 미들웨어 보호형 라우트 명세입니다.
 */

const express = require('express');
const router = express.Router();
const usersController = require('../controllers/usersController');
const response = require('../utils/response');

// 새로 만든 인증 미들웨어를 로드합니다.
const { authenticateToken, authorizeRoles } = require('../middlewares/authMiddleware');

/**
 * ==========================================
 * 🔓 Public Routes (누구나 접근 가능)
 * ==========================================
 */
router.post('/register', usersController.registerUser);
router.post('/login', usersController.loginUser);

/**
 * ==========================================
 * 🔒 Protected Routes (인증/인가 필요)
 * ==========================================
 */

/**
 * @route GET /api/users/me
 * @desc 내 프로필 조회 (로그인한 사람 누구나 자신의 토큰으로 접근)
 */
router.get('/me', authenticateToken, (req, res) => {
  // 미들웨어가 주입해준 req.user 데이터를 그대로 반환하여 인증 성공을 증명합니다.
  return response.success(res, '인증 유저 정보 조회 성공', { user: req.user }, 200);
});

/**
 * @route GET /api/users/admin-dashboard
 * @desc 최고 관리자 전용 대시보드 (role이 manager 또는 admin인 핵심 인력만 접근 가능)
 */
router.get('/admin-dashboard', authenticateToken, authorizeRoles('manager', 'admin'), (req, res) => {
  return response.success(res, '관리자 보호 자원 접근 승인 완료', { secretData: "AICS Lab Core Management Matrix" }, 200);
});

module.exports = router;