/**
 * @file adminContentController.js
 * @description 외부 홈페이지 콘텐츠(5개 리소스)의 관리자 CRUD를 담당하는 Controller 레이어입니다.
 *              모든 라우트는 authMiddleware + requireRole('manager','admin') 이후 도달합니다.
 *
 * 리소스별 특징:
 *  - partners / events / research / lectures : 표준 CRUD (POST / GET 목록 / PATCH :id / DELETE :id)
 *  - professor_profile : 통상 1건 유지 (POST=최초 1회 생성, GET/PATCH는 단건, DELETE 미제공)
 */

const { Partners, Professor, Events, Research, Lectures } = require('../models/adminContentModel');
const { success, fail } = require('../utils/response');

// 공통 id 파라미터 검증. 잘못된 id는 즉시 400으로 반환.
const parseId = (raw) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const AdminContentController = {
  // =====================================================================
  // [1] partner_labs
  // =====================================================================
  createPartner: async (req, res, next) => {
    try {
      const { labName, universityName, partnerLink, logoImageUrl, displayOrder } = req.body || {};
      if (!labName || !universityName) {
        return fail(res, 400, 'labName과 universityName은 필수입니다.');
      }
      const row = await Partners.create({ labName, universityName, partnerLink, logoImageUrl, displayOrder });
      return success(res, row, null, 201);
    } catch (err) { next(err); }
  },

  listPartners: async (req, res, next) => {
    try {
      const rows = await Partners.findAll();
      return success(res, rows);
    } catch (err) { next(err); }
  },

  updatePartner: async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return fail(res, 400, 'Invalid partner id.');
      const existing = await Partners.findById(id);
      if (!existing) return fail(res, 404, 'Partner not found.');
      const row = await Partners.update(id, req.body || {});
      return success(res, row);
    } catch (err) { next(err); }
  },

  deletePartner: async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return fail(res, 400, 'Invalid partner id.');
      const deleted = await Partners.remove(id);
      if (!deleted) return fail(res, 404, 'Partner not found.');
      return success(res, { deleted: true, id: deleted.id });
    } catch (err) { next(err); }
  },

  // =====================================================================
  // [2] professor_profile — 단건 컨텍스트
  // =====================================================================
  createProfessor: async (req, res, next) => {
    try {
      const {
        userId, name, email, profileImageUrl,
        position, department, university, introduction,
        education, career, researchFocus,
      } = req.body || {};
      if (!name || !email) {
        return fail(res, 400, 'name과 email은 필수입니다.');
      }

      // 이미 존재하는 프로필이 있으면 409로 거부. (수정은 PATCH 사용)
      const cnt = await Professor.countAll();
      if (cnt > 0) {
        return fail(res, 409, '이미 지도교수 프로필이 존재합니다. 수정은 PATCH /api/admin/professor를 사용하세요.');
      }

      const row = await Professor.createOne({
        userId, name, email, profileImageUrl,
        position, department, university, introduction,
        education, career, researchFocus,
      });
      return success(res, row, null, 201);
    } catch (err) { next(err); }
  },

  getProfessor: async (req, res, next) => {
    try {
      const row = await Professor.findFirst();
      if (!row) return fail(res, 404, '등록된 지도교수 프로필이 없습니다.');
      return success(res, row);
    } catch (err) { next(err); }
  },

  updateProfessor: async (req, res, next) => {
    try {
      const existing = await Professor.findFirst();
      if (!existing) {
        return fail(res, 404, '수정할 지도교수 프로필이 없습니다. 먼저 POST로 생성하세요.');
      }
      const row = await Professor.updateFirst(req.body || {});
      return success(res, row);
    } catch (err) { next(err); }
  },

  // =====================================================================
  // [3] lab_events
  // =====================================================================
  createEvent: async (req, res, next) => {
    try {
      const { eventName, eventDate, location, description, eventImageUrl } = req.body || {};
      if (!eventName || !eventDate) {
        return fail(res, 400, 'eventName과 eventDate는 필수입니다.');
      }
      const row = await Events.create({ eventName, eventDate, location, description, eventImageUrl });
      return success(res, row, null, 201);
    } catch (err) { next(err); }
  },

  listEvents: async (req, res, next) => {
    try {
      const rows = await Events.findAll();
      return success(res, rows);
    } catch (err) { next(err); }
  },

  updateEvent: async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return fail(res, 400, 'Invalid event id.');
      const existing = await Events.findById(id);
      if (!existing) return fail(res, 404, 'Event not found.');
      const row = await Events.update(id, req.body || {});
      return success(res, row);
    } catch (err) { next(err); }
  },

  deleteEvent: async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return fail(res, 400, 'Invalid event id.');
      const deleted = await Events.remove(id);
      if (!deleted) return fail(res, 404, 'Event not found.');
      return success(res, { deleted: true, id: deleted.id });
    } catch (err) { next(err); }
  },

  // =====================================================================
  // [4] research_areas
  // =====================================================================
  createResearch: async (req, res, next) => {
    try {
      const { title, tag, description, imageUrl, displayOrder } = req.body || {};
      if (!title) return fail(res, 400, 'title은 필수입니다.');
      const row = await Research.create({ title, tag, description, imageUrl, displayOrder });
      return success(res, row, null, 201);
    } catch (err) { next(err); }
  },

  listResearch: async (req, res, next) => {
    try {
      const rows = await Research.findAll();
      return success(res, rows);
    } catch (err) { next(err); }
  },

  updateResearch: async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return fail(res, 400, 'Invalid research id.');
      const existing = await Research.findById(id);
      if (!existing) return fail(res, 404, 'Research area not found.');
      const row = await Research.update(id, req.body || {});
      return success(res, row);
    } catch (err) { next(err); }
  },

  deleteResearch: async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return fail(res, 400, 'Invalid research id.');
      const deleted = await Research.remove(id);
      if (!deleted) return fail(res, 404, 'Research area not found.');
      return success(res, { deleted: true, id: deleted.id });
    } catch (err) { next(err); }
  },

  // =====================================================================
  // [5] lectures
  // =====================================================================
  createLecture: async (req, res, next) => {
    try {
      const {
        courseCode, titleKo, titleEn, semester, academicYear,
        dayOfWeek, startTime, endTime, room, displayOrder,
      } = req.body || {};
      if (!titleKo || !semester || academicYear === undefined || academicYear === null) {
        return fail(res, 400, 'titleKo, semester, academicYear는 필수입니다.');
      }
      if (!Number.isInteger(Number(academicYear))) {
        return fail(res, 400, 'academicYear는 정수여야 합니다.');
      }
      const row = await Lectures.create({
        courseCode, titleKo, titleEn, semester, academicYear,
        dayOfWeek, startTime, endTime, room, displayOrder,
      });
      return success(res, row, null, 201);
    } catch (err) { next(err); }
  },

  listLectures: async (req, res, next) => {
    try {
      const rows = await Lectures.findAll();
      return success(res, rows);
    } catch (err) { next(err); }
  },

  updateLecture: async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return fail(res, 400, 'Invalid lecture id.');
      const existing = await Lectures.findById(id);
      if (!existing) return fail(res, 404, 'Lecture not found.');
      const row = await Lectures.update(id, req.body || {});
      return success(res, row);
    } catch (err) { next(err); }
  },

  deleteLecture: async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return fail(res, 400, 'Invalid lecture id.');
      const deleted = await Lectures.remove(id);
      if (!deleted) return fail(res, 404, 'Lecture not found.');
      return success(res, { deleted: true, id: deleted.id });
    } catch (err) { next(err); }
  },
};

module.exports = AdminContentController;
