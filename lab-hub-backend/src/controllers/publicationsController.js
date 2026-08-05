/**
 * @file publicationsController.js
 * @description 논문 성과 관리 도메인의 요청/응답 처리를 담당하는 Controller 레이어입니다.
 *              모든 라우트는 authMiddleware를 통과한 뒤 도달하므로 req.user는 항상 존재한다고 가정합니다.
 *
 * 핵심 정책:
 *  - authors_text(원문)과 publication_authors(랩 멤버 N:M) 두 축을 동시에 관리하는 "하이브리드" 저자 모델입니다.
 *  - is_public은 반드시 명시적으로 true를 지정할 때만 공개되며 기본은 비공개(false)입니다.
 *  - 저자 순서(author_order)와 교신저자(is_corresponding)는 논문 표기 규약상 필수 정보로, 함께 처리됩니다.
 */

const publicationsModel = require('../models/publicationsModel'); // 논문 도메인 DB 접근을 위임합니다.
const { success, fail } = require('../utils/response'); // 표준 응답 포맷 헬퍼.

// pub_type ENUM 유효값. schema.sql의 CREATE TYPE pub_type과 동기화해야 합니다.
const VALID_PUB_TYPES = ['sci', 'kci', 'intl_conf', 'domestic_conf'];

// pub_status ENUM 유효값. schema.sql의 CREATE TYPE pub_status와 동기화해야 합니다.
const VALID_STATUSES = ['writing', 'submitted', 'under_review', 'accepted', 'published'];

/**
 * @function normalizeAuthors
 * @description 컨트롤러 입력의 authors 배열을 모델 계층 규격으로 정규화합니다.
 *              허용 형식: [{ userId, authorOrder?, isCorresponding? }] 또는 [숫자(userId)] 두 가지를 모두 수용합니다.
 * @param {Array} authors
 * @returns {Array<{ userId:number, authorOrder:number|null, isCorresponding:boolean }>}
 */
const normalizeAuthors = (authors) => {
  if (!Array.isArray(authors)) return [];
  return authors
    .map((entry) => {
      if (entry === null || entry === undefined) return null;
      if (typeof entry === 'number') {
        return { userId: entry, authorOrder: null, isCorresponding: false };
      }
      if (typeof entry === 'object') {
        const userId = Number(entry.userId);
        if (!Number.isInteger(userId) || userId <= 0) return null;
        return {
          userId,
          authorOrder:
            entry.authorOrder === undefined || entry.authorOrder === null
              ? null
              : Number(entry.authorOrder),
          isCorresponding: entry.isCorresponding === true,
        };
      }
      return null;
    })
    .filter((v) => v !== null);
};

/**
 * @function validateAttachment
 * @description 첨부 메타 1건의 스토리지 무결성을 검증합니다(공지 첨부와 동일 규칙).
 *              반환값이 문자열이면 오류 메시지, null이면 통과입니다.
 * @param {Object} file - { filename, storageType, fileUrl?, filepath? }
 */
const validateAttachment = (file) => {
  if (!file || typeof file !== 'object') return '첨부 항목 형식이 올바르지 않습니다.';
  if (!file.filename || !file.storageType) return '첨부파일의 filename 및 storageType(drive/nas)은 필수입니다.';
  if (!['drive', 'nas'].includes(file.storageType)) return 'storageType은 drive 또는 nas만 허용됩니다.';
  if (file.storageType === 'drive' && !file.fileUrl) return 'drive 저장 방식은 fileUrl이 필수입니다.';
  if (file.storageType === 'nas' && !file.filepath) return 'nas 저장 방식은 filepath가 필수입니다.';
  return null;
};

const PublicationsController = {
  /**
   * @function createPublication
   * @description POST /api/publications — 논문 등록.
   *              authors_text는 필수로 저장하고, authors 배열이 함께 오면 publication_authors 연결테이블에도 반영합니다.
   */
  createPublication: async (req, res, next) => {
    try {
      const {
        title,
        authorsText,
        year,
        publishedDate,
        pubType,
        status,
        venue,
        doi,
        isPublic,
        authors,
        attachments,
      } = req.body || {};

      // 필수 입력 검증. authors_text는 원문 저자 표기 그대로 보존해야 하므로 반드시 요구합니다.
      if (!title || !authorsText || !year || !pubType) {
        return fail(res, 400, 'Missing required fields (title, authorsText, year, pubType).');
      }

      // 첨부가 함께 오면 스토리지 무결성을 사전 검증합니다(DB CHECK 제약 사전 방어).
      if (attachments !== undefined) {
        if (!Array.isArray(attachments)) return fail(res, 400, 'attachments는 배열이어야 합니다.');
        for (const f of attachments) {
          const err = validateAttachment(f);
          if (err) return fail(res, 400, err);
        }
      }
      if (!VALID_PUB_TYPES.includes(pubType)) {
        return fail(res, 400, `Invalid pubType: ${pubType}`);
      }
      if (status !== undefined && !VALID_STATUSES.includes(status)) {
        return fail(res, 400, `Invalid status: ${status}`);
      }
      const yearNum = Number(year);
      if (!Number.isInteger(yearNum) || yearNum <= 0) {
        return fail(res, 400, 'Invalid year (must be a positive integer).');
      }

      const publication = await publicationsModel.createPublication({
        title,
        authorsText,
        year: yearNum,
        publishedDate,
        pubType,
        status,
        venue,
        doi,
        isPublic, // undefined → 모델의 COALESCE가 DB 기본값(false)을 적용합니다.
      });

      // authors 배열이 함께 전달되면 하이브리드 저자 모델의 두 번째 축(연결테이블)에 반영합니다.
      const normalizedAuthors = normalizeAuthors(authors);
      if (normalizedAuthors.length > 0) {
        await publicationsModel.addAuthors(publication.id, normalizedAuthors);
      }
      const authorRows = await publicationsModel.getAuthors(publication.id);

      // 첨부가 함께 전달되면 일괄 등록합니다.
      let attachmentRows = [];
      if (Array.isArray(attachments) && attachments.length > 0) {
        attachmentRows = await publicationsModel.insertAttachmentsBulk(publication.id, attachments);
      }

      return success(res, { ...publication, authors: authorRows, attachments: attachmentRows });
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function addAttachment
   * @description POST /api/publications/:id/attachments — 기존 논문에 첨부파일 메타 1건을 등록합니다.
   *              실제 파일 바이트는 /api/uploads/sign 으로 Supabase에 업로드한 뒤, 반환된 fileUrl을 여기에 저장합니다.
   *
   * Body: { filename, storageType('drive'|'nas'), fileUrl?|filepath?, mimeType?, filesize? }
   */
  addAttachment: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid publication id.');

      const publication = await publicationsModel.findById(id);
      if (!publication) return fail(res, 404, '존재하지 않는 논문입니다.');

      const err = validateAttachment(req.body || {});
      if (err) return fail(res, 400, err);

      const created = await publicationsModel.addAttachment(id, req.body);
      return success(res, created, '첨부파일이 등록되었습니다.', 201);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function deleteAttachment
   * @description DELETE /api/publications/:id/attachments/:attachmentId — 논문 첨부파일 메타 1건을 삭제합니다.
   */
  deleteAttachment: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const attId = Number(req.params.attachmentId);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid publication id.');
      if (!Number.isInteger(attId) || attId <= 0) return fail(res, 400, 'Invalid attachment id.');

      const att = await publicationsModel.findAttachmentById(attId);
      if (!att || att.publication_id !== id) {
        return fail(res, 404, '해당 논문의 첨부파일을 찾을 수 없습니다.');
      }

      const deleted = await publicationsModel.removeAttachment(attId);
      return success(res, { id: deleted.id }, '첨부파일이 삭제되었습니다.');
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function listPublications
   * @description GET /api/publications?year=&pubType=&status= — 목록 조회.
   *              각 논문에 랩 멤버 저자 목록을 결합하여 반환합니다. N+1 방지를 위해 저자는 일괄 조회 후 그룹핑합니다.
   */
  listPublications: async (req, res, next) => {
    try {
      const { year, pubType, status } = req.query;

      if (pubType !== undefined && pubType !== '' && !VALID_PUB_TYPES.includes(pubType)) {
        return fail(res, 400, `Invalid pubType filter: ${pubType}`);
      }
      if (status !== undefined && status !== '' && !VALID_STATUSES.includes(status)) {
        return fail(res, 400, `Invalid status filter: ${status}`);
      }

      const publications = await publicationsModel.findAll({ year, pubType, status });

      const ids = publications.map((p) => p.id);
      const authors = await publicationsModel.getAuthorsForPublicationIds(ids);

      // publication_id 기준으로 저자 배열을 그룹화합니다.
      const authorsByPub = new Map();
      for (const a of authors) {
        if (!authorsByPub.has(a.publication_id)) authorsByPub.set(a.publication_id, []);
        authorsByPub.get(a.publication_id).push(a);
      }

      const enriched = publications.map((p) => ({
        ...p,
        authors: authorsByPub.get(p.id) || [],
      }));

      return success(res, enriched);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function getPublication
   * @description GET /api/publications/:id — 단일 논문 상세. 랩 멤버 저자와 첨부 목록을 함께 반환합니다.
   */
  getPublication: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid publication id.');

      const publication = await publicationsModel.findById(id);
      if (!publication) return fail(res, 404, 'Publication not found.');

      // 저자/첨부는 독립적으로 조회 가능하므로 병렬 실행하여 지연을 최소화합니다.
      const [authors, attachments] = await Promise.all([
        publicationsModel.getAuthors(id),
        publicationsModel.getAttachments(id),
      ]);

      return success(res, { ...publication, authors, attachments });
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function updatePublication
   * @description PATCH /api/publications/:id — 논문 부분 수정.
   *              body.authors가 배열로 오면 기존 랩 멤버 저자 연결을 전량 삭제한 뒤 재삽입합니다(전체 교체).
   */
  updatePublication: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid publication id.');

      const existing = await publicationsModel.findById(id);
      if (!existing) return fail(res, 404, 'Publication not found.');

      const patch = req.body || {};

      if (patch.pubType !== undefined && !VALID_PUB_TYPES.includes(patch.pubType)) {
        return fail(res, 400, `Invalid pubType: ${patch.pubType}`);
      }
      if (patch.status !== undefined && !VALID_STATUSES.includes(patch.status)) {
        return fail(res, 400, `Invalid status: ${patch.status}`);
      }
      if (patch.year !== undefined) {
        const yearNum = Number(patch.year);
        if (!Number.isInteger(yearNum) || yearNum <= 0) {
          return fail(res, 400, 'Invalid year (must be a positive integer).');
        }
        patch.year = yearNum;
      }

      const updated = await publicationsModel.updatePublication(id, patch);

      // 저자 재설정: patch.authors가 배열이면 전량 교체.
      // patch.authors 자체가 없으면 저자 목록은 건드리지 않습니다.
      if (Array.isArray(patch.authors)) {
        await publicationsModel.removeAllAuthors(id);
        const normalized = normalizeAuthors(patch.authors);
        if (normalized.length > 0) {
          await publicationsModel.addAuthors(id, normalized);
        }
      }

      const authors = await publicationsModel.getAuthors(id);
      return success(res, { ...updated, authors });
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function deletePublication
   * @description DELETE /api/publications/:id — 논문 삭제.
   *              publication_authors / publication_attachments는 ON DELETE CASCADE로 자동 정리됩니다.
   */
  deletePublication: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid publication id.');

      const deleted = await publicationsModel.deletePublication(id);
      if (!deleted) return fail(res, 404, 'Publication not found.');

      return success(res, { deleted: true, id: deleted.id });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = PublicationsController;
