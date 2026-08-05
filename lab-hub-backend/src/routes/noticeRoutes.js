/**
 * @file noticeRoutes.js
 * @description 공지사항 등록 및 상세 조회 API 경로를 정의하고 권한 가드를 바인딩하는 라우터 레이어입니다.
 */

const express = require('express');
const router = express.Router();
const noticeController = require('../controllers/noticeController');

// 우리가 완벽하게 아키텍처를 다져놓은 토큰 검증 및 RBAC 인가 미들웨어 로드
const { authMiddleware, requireRole } = require('../middlewares/authMiddleware');

/**
 * @route   POST /api/notices
 * @desc    신규 공지사항 및 하이브리드 첨부파일 메타데이터 등록 (트랜잭션 가동)
 * @access  Private (기장/랩장 및 교수 등급 전용 방어벽 배포)
 */
router.post(
  '/', 
  authMiddleware, 
  requireRole('manager', 'admin'), 
  noticeController.createNotice
);

/**
 * @route   GET /api/notices
 * @desc    공지사항 목록 조회 (상단고정 우선, 카테고리 필터 지원). 첨부파일은 개수(attachment_count)만 반환
 * @access  Private (연구실 승인 유저 전체 개방)
 */
router.get('/', authMiddleware, noticeController.listNotices);

/**
 * @route   GET /api/notices/:id
 * @desc    공지사항 상세 조회 및 원자적 조회수(view_count) 1 증가 연산 처리
 * @access  Private (연구실 승인 유저 전체 개방)
 */
router.get('/:id', authMiddleware, noticeController.getNoticeDetail);

/**
 * @route   PATCH /api/notices/:id
 * @desc    [관리자 전용] 공지사항 마스터 필드(title/content/category/isPinned) 수정
 * @access  Private (manager/admin)
 */
router.patch('/:id', authMiddleware, requireRole('manager', 'admin'), noticeController.updateNotice);

/**
 * @route   PATCH /api/notices/:id/pin
 * @desc    [관리자 전용] 공지사항 상단 고정 상태(is_pinned) 설정
 * @access  Private (manager/admin)
 */
router.patch('/:id/pin', authMiddleware, requireRole('manager', 'admin'), noticeController.setPinned);

/**
 * @route   DELETE /api/notices/:id
 * @desc    [관리자 전용] 공지사항 삭제 (첨부파일 CASCADE 정리)
 * @access  Private (manager/admin)
 */
router.delete('/:id', authMiddleware, requireRole('manager', 'admin'), noticeController.deleteNotice);

module.exports = router; // app.js 글로벌 미들웨어 파이프라인에 마운트하기 위해 export합니다.