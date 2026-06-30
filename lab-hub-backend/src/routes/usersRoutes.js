/**
 * @file usersRoutes.js
 * @description 사용자 가입 및 로그인 인증 라우팅 테이블입니다.
 */

const express = require('express');
const router = express.Router();
const usersController = require('../controllers/usersController');

/**
 * @route POST /api/users/register
 * @desc 신규 사용자 가입 승인 요청
 */
router.post('/register', usersController.registerUser);

/**
 * @route POST /api/users/login
 * @desc 사용자 로그인 자격 검증 및 JWT 발급
 * @access Public
 */
router.post('/login', usersController.loginUser);

module.exports = router;