/**
 * @file publicRoutes.js
 * @description /api/public 하위 외부 홈페이지 공개 조회 라우터입니다.
 *              인증 미들웨어를 붙이지 않아 비로그인 방문자도 접근 가능합니다.
 *              민감 정보 유출 방지는 Model 계층의 명시적 SELECT 컬럼 화이트리스트가 담당합니다.
 *
 * 주의:
 *  - /api/public/applications 는 별도의 applicationRoutes.publicRouter 로 이미 마운트돼 있으므로
 *    본 라우터에서는 다루지 않습니다. app.js 에서는 마운트 순서상 applications 가 먼저 등록되어
 *    /api/public/applications 요청이 이 라우터로 흘러들지 않습니다.
 */

const express = require('express');
const router = express.Router();

const publicController = require('../controllers/publicController');

// 공개 라우트 — authMiddleware 없음.
router.get('/members',      publicController.listMembers);
router.get('/publications', publicController.listPublications);
router.get('/partners',     publicController.listPartners);
router.get('/site-settings', publicController.getSiteSettings);
router.get('/professor',    publicController.getProfessor);
router.get('/events',       publicController.listEvents);
router.get('/research',     publicController.listResearchAreas);
router.get('/research-projects', publicController.listResearchProjects);
router.get('/theses',       publicController.listTheses);
router.get('/lectures',     publicController.listLectures);

module.exports = router; // app.js에서 /api/public 경로에 마운트됩니다.
