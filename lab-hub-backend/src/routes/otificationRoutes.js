/**
 * @file notificationRoutes.js
 * @description 시스템 알림 조회 및 상태 변환 엔드포인트를 열고 JWT 인증 미들웨어를 결합하는 라우팅 레이어입니다.
 */

const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");

// 우리 코어 아키텍처인 JWT 토큰 파싱 검증 미들웨어 가드 로드
const { authenticateToken } = require("../middlewares/authMiddleware");

/**
 * @route   GET /api/notifications
 * @desc    현재 로그인된 연구원의 시스템 알림 목록 전체 수신 조회
 * @access  Private (연구실 인증 구성원 전체 대상)
 */
router.get("/", authenticateToken, notificationController.getMyNotifications);

/**
 * @route   PATCH /api/notifications/:id/read
 * @desc    특정 알림 항목 단건 읽음 처리 갱신
 * @access  Private (소유권 대조 검증 가드 내장)
 */
router.patch("/:id/read", authenticateToken, notificationController.readNotification);

/**
 * @route   POST /api/notifications/read-all
 * @desc    수신된 미읽음 알림 전체 일괄 읽음 확정 처리
 * @access  Private (연구실 인증 구성원 전체 대상)
 */
router.post("/read-all", authenticateToken, notificationController.readAllNotifications);

module.exports = router; // app.js 글로벌 미들웨어 파이프라인에 마운트하기 위해 export합니다.
