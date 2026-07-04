/**
 * @file notificationRoutes.js
 * @description /api/notifications 하위 시스템 알림 엔드포인트를 정의하는 라우터 모듈입니다.
 *              모든 라우트는 authMiddleware로 보호되어 로그인한 사용자만 접근 가능합니다.
 *              - 목록/읽음 처리: 본인의 알림만 다룸 (컨트롤러가 req.user.id로 스코프 제한)
 *              - 알림 생성(POST): admin/manager 전용 브로드캐스트 발송 목적
 */

const express = require('express');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middlewares/authMiddleware'); // Bearer Access Token 검증 + 역할 인가.
const notificationController = require('../controllers/notificationController'); // 요청/응답 처리는 컨트롤러에 위임합니다.

// 라우터에 등록되는 전 엔드포인트에 인증 미들웨어를 일괄 적용합니다.
router.use(authMiddleware);

// 내 알림 목록. ?isRead=true|false 필터 지원.
router.get('/', notificationController.listMyNotifications);

// 내 미읽음 알림 개수 (뱃지 카운터용).
router.get('/unread-count', notificationController.getUnreadCount);

// 알림 발송 (관리자 전용). 시스템 이벤트 알림은 각 도메인 컨트롤러가 model.createNotification을 직접 호출.
router.post('/', requireRole('manager', 'admin'), notificationController.createNotification);

// 모두 읽음 (일괄) — 고정 경로가 :id 패턴보다 먼저 오도록 배치하여 라우팅 충돌을 방지합니다.
router.patch('/read-all', notificationController.markAllAsRead);

// 단건 읽음.
router.patch('/:id/read', notificationController.markAsRead);

module.exports = router; // app.js에서 /api/notifications 경로에 마운트됩니다.
