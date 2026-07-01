/**
 * @file noticeRoutes.js
 * @description 공지사항 등록 및 상세 조회 API 경로를 정의하고 권한 가드를 바인딩하는 라우터 레이어입니다.
 */

const express = require('express');
const router = express.Router();
const noticeController = require('../controllers/noticeController');

// 우리가 완벽하게 아키텍처를 다져놓은 토큰 검증 및 RBAC 인가 미들웨어 로드
const { authenticateToken, authorizeRoles } = require('../middlewares/authMiddleware');

/**
 * @route   POST /api/notices
 * @desc    신규 공지사항 및 하이브리드 첨부파일 메타데이터 등록 (트랜잭션 가동)
 * @access  Private (기장/랩장 및 교수 등급 전용 방어벽 배포)
 */
router.post(
  '/', 
  authenticateToken, 
  authorizeRoles('manager', 'admin'), 
  noticeController.createNotice
);

/**
 * @route   GET /api/notices/:id
 * @desc    공지사항 상세 조회 및 원자적 조회수(view_count) 1 증가 연산 처리
 * @access  Private (연구실 승인 유저 전체 개방)
 */
router.get('/:id', authenticateToken, noticeController.getNoticeDetail);

module.exports = router; // app.js 글로벌 미들웨어 파이프라인에 마운트하기 위해 export합니다.