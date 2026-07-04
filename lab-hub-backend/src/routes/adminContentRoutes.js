/**
 * @file adminContentRoutes.js
 * @description /api/admin 하위 외부 홈페이지 콘텐츠 5개 리소스의 관리자 CRUD 라우터입니다.
 *              모든 엔드포인트에 authMiddleware + requireRole('manager','admin') 이중 가드를 걸어
 *              일반 로그인 사용자는 접근 불가하도록 방어합니다.
 *
 * 리소스 매핑:
 *  - partners    → partner_labs
 *  - professor   → professor_profile (통상 1건)
 *  - events      → lab_events
 *  - research    → research_areas
 *  - lectures    → lectures
 */

const express = require('express');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middlewares/authMiddleware');
const adminContentController = require('../controllers/adminContentController');

// 라우터 전체에 인증 + 역할 인가를 일괄 적용합니다.
router.use(authMiddleware);
router.use(requireRole('manager', 'admin'));

// ---------------- partners ----------------
router.post('/partners',       adminContentController.createPartner);
router.get('/partners',        adminContentController.listPartners);
router.patch('/partners/:id',  adminContentController.updatePartner);
router.delete('/partners/:id', adminContentController.deletePartner);

// ---------------- professor (single record) ----------------
router.post('/professor',  adminContentController.createProfessor);
router.get('/professor',   adminContentController.getProfessor);
router.patch('/professor', adminContentController.updateProfessor);
// DELETE 미제공: 지도교수 프로필은 삭제보다는 갱신 흐름을 강제합니다.

// ---------------- events ----------------
router.post('/events',       adminContentController.createEvent);
router.get('/events',        adminContentController.listEvents);
router.patch('/events/:id',  adminContentController.updateEvent);
router.delete('/events/:id', adminContentController.deleteEvent);

// ---------------- research ----------------
router.post('/research',       adminContentController.createResearch);
router.get('/research',        adminContentController.listResearch);
router.patch('/research/:id',  adminContentController.updateResearch);
router.delete('/research/:id', adminContentController.deleteResearch);

// ---------------- lectures ----------------
router.post('/lectures',       adminContentController.createLecture);
router.get('/lectures',        adminContentController.listLectures);
router.patch('/lectures/:id',  adminContentController.updateLecture);
router.delete('/lectures/:id', adminContentController.deleteLecture);

module.exports = router; // app.js에서 /api/admin 경로에 마운트됩니다.
