/**
 * @file credentialRoutes.js
 * @description /api/credentials 하위 공용 크레덴셜 엔드포인트를 정의하는 라우터 모듈입니다.
 *              모든 라우트는 authMiddleware로 보호되어 로그인한 사용자만 접근 가능하며,
 *              리소스별 min_role 동적 판정과 감사 로그 적재는 컨트롤러 내부에서 처리됩니다.
 */

const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../middlewares/authMiddleware'); // Bearer Access Token 검증 미들웨어.
const credentialController = require('../controllers/credentialController'); // 요청/응답 처리는 컨트롤러에 위임합니다.

// 라우터에 등록되는 전 엔드포인트에 인증 미들웨어를 일괄 적용합니다.
// 크레덴셜별 min_role 인가는 이 다음 단계로 컨트롤러가 처리합니다.
router.use(authMiddleware);

// 크레덴셜 CRUD
router.post('/', credentialController.createCredential);
router.get('/', credentialController.listCredentials);
router.get('/:id', credentialController.getCredential);

// 실제 비밀번호 복호화 열람 (min_role 검증 + credential_access_logs view 기록)
router.get('/:id/reveal', credentialController.revealPassword);

// 클라이언트 복사 액션 감사 로그 (평문 반환 없음)
router.post('/:id/copy', credentialController.logCopy);

router.patch('/:id', credentialController.updateCredential);
router.delete('/:id', credentialController.deleteCredential);

module.exports = router; // app.js에서 /api/credentials 경로에 마운트됩니다.
