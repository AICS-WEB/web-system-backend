/**
 * @file filesController.js
 * @description 파일 공유 도메인의 요청/응답 처리를 담당하는 Controller 레이어입니다.
 *              모든 라우트는 authMiddleware를 통과한 뒤 도달하므로 req.user는 항상 존재한다고 가정합니다.
 *
 * 핵심 정책:
 *  - min_role 동적 인가: 파일마다 요구 권한(min_role)이 다르므로 리소스 로드 후 req.user.role과 비교하여 판정합니다.
 *  - 등급 순서: member < manager < admin. 하위 권한은 상위 파일에 접근할 수 없습니다.
 *  - 목록 조회: DB 레벨에서 min_role 화이트리스트로 필터하여 응용 계층 필터링 누락 위험을 배제합니다.
 *  - 버전 관리: 파일 내용 자체(file_url/filename/mime_type/filesize) 갱신 시 version 컬럼을 +1 증가시킵니다.
 *              단순 메타(title/description/category/min_role) 수정은 버전을 올리지 않습니다.
 */

const filesModel = require('../models/filesModel'); // 파일 도메인 DB 접근을 위임합니다.
const { hasRoleAtLeast, rolesUpTo } = require('../utils/role'); // 동적 min_role 판정 유틸리티.
const { success, fail } = require('../utils/response'); // 표준 응답 포맷 헬퍼.

// file_category ENUM 유효값. schema.sql의 CREATE TYPE file_category와 동기화해야 합니다.
const VALID_CATEGORIES = ['paper', 'presentation', 'template', 'software', 'other'];

// user_role ENUM 유효값. min_role 필드로 입력 가능한 값 집합입니다.
const VALID_MIN_ROLES = ['member', 'manager', 'admin'];

// 파일 "내용"과 관련된 필드 목록. PATCH 요청 시 이 중 하나라도 포함되면 version을 +1 증가시킵니다.
const VERSION_BUMP_FIELDS = ['fileUrl', 'filename', 'mimeType', 'filesize'];

const FilesController = {
  /**
   * @function createFile
   * @description POST /api/files — 파일 메타데이터 등록.
   *              storage_type은 모델에서 'drive'로 강제 고정되며 file_url이 필수입니다.
   *              uploaded_by는 authMiddleware가 주입한 req.user.id로 설정됩니다.
   */
  createFile: async (req, res, next) => {
    try {
      const {
        title, description, category, minRole,
        filename, mimeType, fileUrl, filesize,
      } = req.body || {};

      if (!title || !category || !filename || !fileUrl) {
        return fail(res, 400, 'Missing required fields (title, category, filename, fileUrl).');
      }
      if (!VALID_CATEGORIES.includes(category)) {
        return fail(res, 400, `Invalid category: ${category}`);
      }
      if (minRole !== undefined && minRole !== null && !VALID_MIN_ROLES.includes(minRole)) {
        return fail(res, 400, `Invalid minRole: ${minRole}`);
      }

      const file = await filesModel.createFile({
        uploadedBy: req.user.id,
        title,
        description,
        category,
        minRole,
        filename,
        mimeType,
        fileUrl,
        filesize,
      });

      return success(res, file);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function listFiles
   * @description GET /api/files?category= — 파일 목록 조회.
   *              요청자 role보다 높은 min_role의 파일은 DB WHERE 절에서 아예 제외합니다.
   */
  listFiles: async (req, res, next) => {
    try {
      const { category } = req.query;
      if (category !== undefined && category !== '' && !VALID_CATEGORIES.includes(category)) {
        return fail(res, 400, `Invalid category filter: ${category}`);
      }

      // 요청자 역할로 접근 가능한 min_role 화이트리스트를 계산합니다.
      // 예: manager → ['member','manager'], admin → ['member','manager','admin']
      const allowedMinRoles = rolesUpTo(req.user.role);

      const files = await filesModel.findAll({ category, allowedMinRoles });
      return success(res, files);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function getFile
   * @description GET /api/files/:id — 파일 단건 상세.
   *              파일별 min_role을 DB에서 읽은 뒤 요청자 role과 비교하여 동적 인가를 판정합니다.
   *              권한 없음은 404가 아니라 403으로 명시 (리소스 존재 자체가 상위 등급에는 이미 노출되므로 URL 유출 우려 낮음).
   */
  getFile: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid file id.');

      const file = await filesModel.findById(id);
      if (!file) return fail(res, 404, 'File not found.');

      if (!hasRoleAtLeast(req.user.role, file.min_role)) {
        return fail(res, 403, 'Forbidden: insufficient role for this file.');
      }

      return success(res, file);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function downloadFile
   * @description GET /api/files/:id/download — 다운로드 요청.
   *              min_role 인가 통과 시 download_count를 원자적으로 +1 증가시키고 file_url을 반환합니다.
   *              (실제 바이너리 스트리밍이 아닌 외부 링크 반환 방식 — storage_type='drive' 범위)
   */
  downloadFile: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid file id.');

      const file = await filesModel.findById(id);
      if (!file) return fail(res, 404, 'File not found.');

      if (!hasRoleAtLeast(req.user.role, file.min_role)) {
        return fail(res, 403, 'Forbidden: insufficient role for this file.');
      }

      // 다운로드 카운터를 원자적으로 증가시키고 파일 정보를 함께 반환합니다.
      const updated = await filesModel.incrementDownloadCount(id);

      return success(res, {
        id: file.id,
        title: file.title,
        filename: updated.filename,
        storage_type: updated.storage_type,
        file_url: updated.file_url, // 클라이언트는 이 URL로 리다이렉트/다운로드합니다.
        download_count: updated.download_count,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function updateFile
   * @description PATCH /api/files/:id — 파일 메타데이터 수정.
   *              파일 내용 관련 필드(fileUrl/filename/mimeType/filesize) 중 하나라도 포함되면 version을 +1 증가시킵니다.
   *              단순 표시용 메타(title/description/category/min_role)만 바뀌면 version을 유지합니다.
   */
  updateFile: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid file id.');

      const existing = await filesModel.findById(id);
      if (!existing) return fail(res, 404, 'File not found.');

      const patch = req.body || {};

      if (patch.category !== undefined && !VALID_CATEGORIES.includes(patch.category)) {
        return fail(res, 400, `Invalid category: ${patch.category}`);
      }
      if (patch.minRole !== undefined && !VALID_MIN_ROLES.includes(patch.minRole)) {
        return fail(res, 400, `Invalid minRole: ${patch.minRole}`);
      }

      // 내용 필드 중 하나라도 patch에 포함되면 자동으로 버전 카운터를 증가시킵니다.
      const bumpVersion = VERSION_BUMP_FIELDS.some((f) =>
        Object.prototype.hasOwnProperty.call(patch, f)
      );

      const updated = await filesModel.updateFile(id, patch, { bumpVersion });
      return success(res, updated);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function deleteFile
   * @description DELETE /api/files/:id — 파일 레코드 완전 삭제(soft delete 없음).
   */
  deleteFile: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid file id.');

      const deleted = await filesModel.deleteFile(id);
      if (!deleted) return fail(res, 404, 'File not found.');

      return success(res, { deleted: true, id: deleted.id });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = FilesController;
