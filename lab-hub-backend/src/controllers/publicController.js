/**
 * @file publicController.js
 * @description 외부 홈페이지(비로그인 방문자) 전용 공개 조회 Controller 레이어입니다.
 *              모든 엔드포인트는 authMiddleware 없이 접근 가능하며, Model 계층에서 이미 SELECT 컬럼을
 *              화이트리스트로 제한해 민감 정보(password_hash / phone / role / account_status 등) 노출을 원천 차단합니다.
 */

const publicModel = require('../models/publicModel');
const { success, fail } = require('../utils/response');

const PublicController = {
  /**
   * @function listMembers
   * @description GET /api/public/members — 공개 프로필 허용 멤버 전체 조회.
   *              is_alumni 기준으로 current_students / alumni 두 배열로 분리해서 응답합니다.
   *              프론트가 두 개의 섹션으로 렌더링하기 편하도록 서버에서 분리 처리.
   */
  listMembers: async (req, res, next) => {
    try {
      const rows = await publicModel.listMembers();

      const currentStudents = [];
      const alumni = [];
      for (const row of rows) {
        if (row.is_alumni) alumni.push(row);
        else currentStudents.push(row);
      }

      return success(res, {
        current_students: currentStudents,
        alumni: alumni,
        counts: {
          current: currentStudents.length,
          alumni: alumni.length,
          total: rows.length,
        },
      });
    } catch (err) { next(err); }
  },

  /**
   * @function listPublications
   * @description GET /api/public/publications — is_public=true 논문만 최신순으로 반환.
   */
  listPublications: async (req, res, next) => {
    try {
      const rows = await publicModel.listPublications();
      return success(res, rows);
    } catch (err) { next(err); }
  },

  /**
   * @function listPartners
   * @description GET /api/public/partners — display_order 오름차순으로 파트너 목록 반환.
   */
  listPartners: async (req, res, next) => {
    try {
      const rows = await publicModel.listPartners();
      return success(res, rows);
    } catch (err) { next(err); }
  },

  /**
   * @function getProfessor
   * @description GET /api/public/professor — 지도교수 프로필 1건 + 해당 user_id로 조인된 공개 논문 목록.
   *              user_id 가 null 이면 publications 는 빈 배열로 반환합니다.
   */
  getProfessor: async (req, res, next) => {
    try {
      const professor = await publicModel.findProfessor();
      if (!professor) return fail(res, 404, '등록된 지도교수 프로필이 없습니다.');

      let publications = [];
      if (professor.user_id) {
        publications = await publicModel.findProfessorPublications(professor.user_id);
      }

      return success(res, {
        ...professor,
        publications,
      });
    } catch (err) { next(err); }
  },

  /**
   * @function listEvents
   * @description GET /api/public/events — 최신순 이벤트 목록.
   */
  listEvents: async (req, res, next) => {
    try {
      const rows = await publicModel.listEvents();
      return success(res, rows);
    } catch (err) { next(err); }
  },

  /**
   * @function listResearchAreas
   * @description GET /api/public/research — display_order 오름차순 연구 분야 카드 목록.
   */
  listResearchAreas: async (req, res, next) => {
    try {
      const rows = await publicModel.listResearchAreas();
      return success(res, rows);
    } catch (err) { next(err); }
  },

  /**
   * @function listLectures
   * @description GET /api/public/lectures?semester=&year= — 강의 목록. 요일→시작시각 순 정렬.
   *              year 파라미터가 오면 정수 파싱을 시도하며 파싱 실패 시 400.
   */
  listLectures: async (req, res, next) => {
    try {
      const semester = req.query.semester || undefined;

      let academicYear;
      if (req.query.year !== undefined && req.query.year !== '') {
        const parsed = Number(req.query.year);
        if (!Number.isInteger(parsed)) {
          return fail(res, 400, 'year 파라미터는 정수여야 합니다.');
        }
        academicYear = parsed;
      }

      const rows = await publicModel.listLectures({ semester, academicYear });
      return success(res, rows);
    } catch (err) { next(err); }
  },
};

module.exports = PublicController;
