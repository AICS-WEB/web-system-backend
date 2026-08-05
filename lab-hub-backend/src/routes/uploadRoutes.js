/**
 * @file uploadRoutes.js
 * @description 파일 업로드(Supabase Storage 서명 URL) API 엔드포인트를 정의하는 라우터 레이어입니다.
 *              실제 파일 바이트는 프론트가 발급받은 서명 URL로 Supabase에 직접 업로드하며, 백엔드는 URL 발급만 담당합니다.
 */

const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { authMiddleware } = require('../middlewares/authMiddleware');

/**
 * @route  POST /api/uploads/sign
 * @desc   Supabase Storage 서명 업로드 URL 발급 (body: { filename, folder? })
 * @access Private (로그인 필요)
 */
router.post('/sign', authMiddleware, uploadController.createSignedUploadUrl);

module.exports = router;
