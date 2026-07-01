/**
 * @file publicationsRoutes.js
 * @description /api/publications 하위 논문 성과 관리 엔드포인트를 정의하는 라우터 모듈입니다.
 *              모든 라우트는 authMiddleware로 보호되어 로그인한 사용자만 접근 가능합니다.
 */

const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../middlewares/authMiddleware'); // Bearer Access Token 검증 미들웨어.
const publicationsController = require('../controllers/publicationsController'); // 요청/응답 처리는 컨트롤러에 위임합니다.

// 라우터에 등록되는 전 엔드포인트에 인증 미들웨어를 일괄 적용합니다.
// 개별 라우트에 반복 명시하지 않아 누락 위험을 원천 차단합니다.
router.use(authMiddleware);

// 논문 CRUD
router.post('/', publicationsController.createPublication);
router.get('/', publicationsController.listPublications);
router.get('/:id', publicationsController.getPublication);
router.patch('/:id', publicationsController.updatePublication);
router.delete('/:id', publicationsController.deletePublication);

module.exports = router; // app.js에서 /api/publications 경로에 마운트됩니다.
