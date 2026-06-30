/**
 * @file usersRoutes.js
 * @description 사용자 관련 API 엔드포인트 라우팅 체계를 정의하는 라우터 레이어입니다.
 */

const express = require('express');
const router = express.Router();
const usersController = require('../controllers/usersController');

/**
 * @route POST /api/users/register
 * @desc 신규 사용자 가입 승인 요청 엔드포인트
 * @access Public (비인증 개방 권한)
 */
router.post('/register', usersController.registerUser);

module.exports = router;