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
      const [rows, alumniProfiles] = await Promise.all([
        publicModel.listMembers(),
        publicModel.listAlumniProfiles(),
      ]);

      const currentStudents = [];
      const alumni = [];
      for (const row of rows) {
        if (row.is_alumni) alumni.push(row);
        else currentStudents.push(row);
      }

      const alumniByUserId = new Map(
        alumni.map((member) => [member.id, member]),
      );

      for (const profile of alumniProfiles) {
        const profileDetails = {
          alumni_profile_id: profile.alumni_profile_id,
          degree: profile.degree,
          history: Array.isArray(profile.history) ? profile.history : [],
          interests: Array.isArray(profile.interests) ? profile.interests : [],
          display_order: profile.display_order,
        };
        const linkedMember = profile.user_id
          ? alumniByUserId.get(profile.user_id)
          : null;

        if (linkedMember) {
          Object.assign(linkedMember, profileDetails, {
            name: profile.name || linkedMember.name,
            profile_source: 'users+alumni_profiles',
          });
          continue;
        }

        alumni.push({
          id: `alumni-profile-${profile.alumni_profile_id}`,
          user_id: profile.user_id,
          name: profile.name,
          department: profile.department,
          program: profile.program,
          enrollment_year: profile.enrollment_year,
          graduation_year: profile.graduation_year,
          grade_override: profile.grade_override,
          grade_display: profile.grade_display,
          research_topic: profile.research_topic,
          profile_image: profile.profile_image,
          bio: profile.bio,
          github_url: profile.github_url,
          linkedin_url: profile.linkedin_url,
          is_alumni: true,
          profile_source: 'alumni_profiles',
          ...profileDetails,
        });
      }

      alumni.sort((a, b) => {
        const aOrder = a.display_order ?? Number.MAX_SAFE_INTEGER;
        const bOrder = b.display_order ?? Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder;
      });

      return success(res, {
        current_students: currentStudents,
        alumni,
        counts: {
          current: currentStudents.length,
          alumni: alumni.length,
          total: currentStudents.length + alumni.length,
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

  getSiteSettings: async (req, res, next) => {
    try {
      const settings = await publicModel.getSiteSettings();
      if (!settings) return fail(res, 404, '등록된 사이트 설정이 없습니다.');
      return success(res, settings);
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
   * @function listResearchProjects
   * @description GET /api/public/research-projects — 공개 연구 프로젝트 목록.
   */
  listResearchProjects: async (req, res, next) => {
    try {
      const rows = await publicModel.listResearchProjects();
      return success(res, rows);
    } catch (err) { next(err); }
  },

  listTheses: async (req, res, next) => {
    try {
      const rows = await publicModel.listTheses();
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
