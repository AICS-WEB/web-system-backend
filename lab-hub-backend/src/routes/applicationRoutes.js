/**
 * @file applicationRoutes.js
 * @description 연구생 지원 도메인 라우터 모듈. 접근 경로를 목적별로 두 개의 라우터로 분리해 export합니다.
 *
 *  1) publicRouter — /api/public/applications
 *     - 외부 지원자용 공개 폼 제출 전용. 인증 불필요.
 *     - express-rate-limit로 IP당 1시간 5회 제한하여 남용을 억제합니다.
 *
 *  2) adminRouter — /api/applications
 *     - 관리자 전용. authMiddleware + requireRole('manager','admin') 이중 가드.
 *     - 목록/상세/수정/삭제 등 심사 흐름과 internal_memo 조회를 포함합니다.
 *
 *  app.js에서는 두 라우터를 각기 다른 마운트 포인트에 바인딩합니다.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const { authMiddleware, requireRole } = require('../middlewares/authMiddleware');
const applicationController = require('../controllers/applicationController');

// ==========================================
// 1) 공개 라우터 (Public Router)
// ==========================================
const publicRouter = express.Router();

/**
 * @constant submitRateLimiter
 * @description POST /api/public/applications 남용 방지용 rate limiter.
 *              - windowMs: 1시간
 *              - max: IP당 5회
 *              - 초과 시 429 응답. 팀 표준 응답 규격({success,data,message})을 유지합니다.
 *              - 프록시 배후 실행 시 정확한 클라이언트 IP 확보를 위해 app.js에서 app.set('trust proxy', ...)를 함께 설정해야 합니다.
 */
const submitRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1시간
  max: 5,                   // IP당 최대 5회 제출
  standardHeaders: true,    // RateLimit-* 표준 헤더 사용
  legacyHeaders: false,     // X-RateLimit-* 레거시 헤더 비활성화
  handler: (req, res /*, next, options */) => {
    return res.status(429).json({
      success: false,
      data: null,
      message: '해당 IP에서 너무 많은 지원서가 제출되었습니다. 잠시 후 다시 시도해주세요.',
    });
  },
});

// 공개 제출 엔드포인트. 라우터 마운트 포인트가 /api/public/applications이므로 여기서는 루트('/') 하나만 노출합니다.
publicRouter.post('/', submitRateLimiter, applicationController.submitApplication);

// ==========================================
// 2) 관리자 라우터 (Admin Router)
// ==========================================
const adminRouter = express.Router();

// 관리자 라우터의 모든 엔드포인트에 인증 + 역할 인가를 일괄 적용합니다.
// manager/admin만 통과 가능(member는 403).
adminRouter.use(authMiddleware);
adminRouter.use(requireRole('manager', 'admin'));

// 목록/상세/수정/삭제 — 상세 조회 시 컨트롤러가 is_read 자동 갱신.
adminRouter.get('/', applicationController.listApplications);
adminRouter.get('/:id', applicationController.getApplication);
adminRouter.patch('/:id', applicationController.updateApplication);
adminRouter.delete('/:id', applicationController.deleteApplication);

// app.js에서 각각 별도의 마운트 포인트에 바인딩할 수 있도록 두 라우터를 함께 export합니다.
module.exports = {
  publicRouter,
  adminRouter,
};
