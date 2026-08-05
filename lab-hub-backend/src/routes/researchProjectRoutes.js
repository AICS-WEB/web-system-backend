/**
 * @file researchProjectRoutes.js
 * @description 연구과제(research_projects) 내부 CRUD API 엔드포인트를 정의하고 권한 가드를 바인딩하는 라우터 레이어입니다.
 *              공개 조회는 /api/public/research-projects 에서 별도로 담당하며, 본 라우터는 내부 관리용(전체 조회 + 생성/수정/삭제)입니다.
 */

const express = require('express');
const router = express.Router();
const researchProjectController = require('../controllers/researchProjectController');

const { authMiddleware, requireRole } = require('../middlewares/authMiddleware');

/**
 * @route  GET /api/research-projects
 * @desc   연구과제 목록 조회 (?status=&isPublic= 필터, is_public 무관 전체)
 * @access Private (로그인만 하면 role 무관 조회)
 * @note   정적/파라미터 충돌 없음. 목록은 인증만, 쓰기 작업은 manager/admin 전용.
 */
router.get('/', authMiddleware, researchProjectController.listProjects);

/**
 * @route  GET /api/research-projects/:id
 * @desc   연구과제 단건 상세 조회
 * @access Private
 */
router.get('/:id', authMiddleware, researchProjectController.getProject);

/**
 * @route  POST /api/research-projects
 * @desc   [관리자 전용] 신규 연구과제 생성
 * @access Private (manager/admin)
 */
router.post('/', authMiddleware, requireRole('manager', 'admin'), researchProjectController.createProject);

/**
 * @route  PATCH /api/research-projects/:id
 * @desc   [관리자 전용] 연구과제 수정
 * @access Private (manager/admin)
 */
router.patch('/:id', authMiddleware, requireRole('manager', 'admin'), researchProjectController.updateProject);

/**
 * @route  DELETE /api/research-projects/:id
 * @desc   [관리자 전용] 연구과제 삭제 (예산 project_id는 SET NULL 정리)
 * @access Private (manager/admin)
 */
router.delete('/:id', authMiddleware, requireRole('manager', 'admin'), researchProjectController.deleteProject);

module.exports = router; // app.js 글로벌 미들웨어 파이프라인에 마운트하기 위해 export합니다.
