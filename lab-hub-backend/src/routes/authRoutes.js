/**
 * @file authRoutes.js
 * @description /api/auth 하위 인증 엔드포인트를 정의하는 라우터 모듈입니다.
 *              컨트롤러로의 위임만 수행하며, 본 파일에 비즈니스 로직이나 DB 접근이 포함되어서는 안 됩니다.
 */

const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController'); // 요청/응답 처리는 컨트롤러에 위임합니다.

// 회원가입: account_status='pending' 상태로 계정을 생성하여 관리자 승인 대기열에 추가합니다.
router.post('/register', authController.register);

// 로그인: 자격 증명 검증 후 Access(30분)/Refresh(14일) 토큰을 발급합니다.
router.post('/login', authController.login);

// Access Token 갱신: 유효한 Refresh Token으로 신규 Access Token을 재발급합니다.
router.post('/refresh', authController.refresh);

// 로그아웃: 전달된 Refresh Token을 즉시 폐기합니다.
router.post('/logout', authController.logout);

// 비밀번호 재설정 요청: 이메일로 일회용 재설정 토큰을 발급합니다(만료 1시간).
router.post('/password/reset-request', authController.passwordResetRequest);

// 비밀번호 재설정 확정: 재설정 토큰을 검증한 뒤 비밀번호를 변경합니다.
router.post('/password/reset', authController.passwordReset);

module.exports = router; // app.js에서 /api/auth 경로에 마운트됩니다.
