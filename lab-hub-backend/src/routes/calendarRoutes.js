/**
 * @file calendarRoutes.js
 * @description /api/calendar 하위 캘린더 엔드포인트를 정의하는 라우터 모듈입니다.
 *              모든 라우트는 authMiddleware로 보호되어 로그인한 사용자만 접근 가능합니다.
 */

const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../middlewares/authMiddleware'); // Bearer Access Token 검증 미들웨어.
const calendarController = require('../controllers/calendarController'); // 요청/응답 처리는 컨트롤러에 위임합니다.

// 이 라우터에 등록되는 모든 엔드포인트에 인증 미들웨어를 일괄 적용합니다.
// 개별 라우트에 반복 명시하지 않아 누락 위험을 원천 차단합니다.
router.use(authMiddleware);

// 이벤트 CRUD
router.post('/events', calendarController.createEvent);
router.get('/events', calendarController.listEvents);
router.get('/events/:id', calendarController.getEvent);
router.patch('/events/:id', calendarController.updateEvent);
router.delete('/events/:id', calendarController.deleteEvent);

// 반복 일정의 특정 회차 예외 (수정/취소) — 마스터 이벤트는 변경되지 않습니다.
router.post('/events/:id/exceptions', calendarController.createException);

// 반복 일정 시리즈 분할 (this-and-future) — 옛 시리즈에 UNTIL을 부여하고 새 시리즈를 생성합니다.
router.post('/events/:id/split', calendarController.splitRecurrence);

module.exports = router; // app.js에서 /api/calendar 경로에 마운트됩니다.
