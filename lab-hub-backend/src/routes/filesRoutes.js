/**
 * @file filesRoutes.js
 * @description /api/files 하위 파일 공유 엔드포인트를 정의하는 라우터 모듈입니다.
 *              모든 라우트는 authMiddleware로 보호되어 로그인한 사용자만 접근 가능하며,
 *              리소스별 min_role 동적 판정은 각 컨트롤러 내부에서 별도로 수행됩니다.
 */

const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../middlewares/authMiddleware'); // Bearer Access Token 검증 미들웨어.
const filesController = require('../controllers/filesController'); // 요청/응답 처리는 컨트롤러에 위임합니다.

// 라우터에 등록되는 전 엔드포인트에 인증 미들웨어를 일괄 적용합니다.
// 파일별 min_role 인가는 이 다음 단계로 컨트롤러가 처리합니다.
router.use(authMiddleware);

// 파일 CRUD 및 다운로드
router.post('/', filesController.createFile);
router.get('/', filesController.listFiles);
router.get('/:id', filesController.getFile);
router.get('/:id/download', filesController.downloadFile);
router.patch('/:id', filesController.updateFile);
router.delete('/:id', filesController.deleteFile);

module.exports = router; // app.js에서 /api/files 경로에 마운트됩니다.
