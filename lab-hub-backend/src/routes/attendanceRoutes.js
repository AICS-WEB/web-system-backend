/**
 * @file attendanceRoutes.js
 * @description 출퇴근 API 경로에 안전한 토큰 인증 미들웨어를 결합하여 엔드포인트를 개설하는 라우터입니다.
 */

const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');

// 이전 단계에서 우리가 구축해 둔 토큰 인증 수신 미들웨어 로드
const { authMiddleware } = require('../middlewares/authMiddleware');

/**
 * @route POST /api/attendance/check-in
 * @desc 연구실 출근 체크 (IP 검증 및 지각 판별 포함)
 * @access Private (일반 연구원 이상 토큰 인증 필수 방어막 장착)
 */
router.post('/check-in', authMiddleware, attendanceController.checkIn);

/**
 * @route POST /api/attendance/check-out
 * @desc 연구실 퇴근 체크
 * @access Private (토큰 인증 필수)
 */
router.post('/check-out', authMiddleware, attendanceController.checkOut);

module.exports = router;