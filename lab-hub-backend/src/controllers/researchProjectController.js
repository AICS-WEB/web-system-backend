/**
 * @file researchProjectController.js
 * @description 연구과제(research_projects) 내부 CRUD를 제어하는 컨트롤러 레이어입니다.
 *              공개 조회(/api/public/research-projects)와 달리 is_public 여부와 무관하게 내부 관리자가 전체를 관리합니다.
 *              status/role/program 등은 자유 텍스트(enum 아님)이므로 별도 화이트리스트 검증 없이 저장합니다.
 */

const ResearchProjectModel = require('../models/researchProjectModel');
const { success, fail } = require('../utils/response'); // 팀 표준 공통 응답 유틸 (success/fail)

const ResearchProjectController = {
  /**
   * @function listProjects
   * @description [인증 유저 전체] 연구과제 목록 조회. 선택 필터: ?status=, ?isPublic=(true/false).
   */
  listProjects: async (req, res) => {
    try {
      const { status, isPublic } = req.query;

      // isPublic 쿼리 문자열을 boolean으로 정규화 (전달된 경우에만)
      let isPublicFilter;
      if (isPublic === 'true') isPublicFilter = true;
      else if (isPublic === 'false') isPublicFilter = false;

      const projects = await ResearchProjectModel.findAll({
        status: status || null,
        isPublic: isPublicFilter,
      });
      return success(res, projects);
    } catch (error) {
      console.error('연구과제 목록 조회 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 연구과제 목록 조회에 실패했습니다.');
    }
  },

  /**
   * @function getProject
   * @description [인증 유저 전체] 연구과제 단건 상세 조회. 미존재 시 404.
   */
  getProject: async (req, res) => {
    try {
      const project = await ResearchProjectModel.findById(req.params.id);
      if (!project) {
        return fail(res, 404, '존재하지 않는 연구과제입니다.');
      }
      return success(res, project);
    } catch (error) {
      console.error('연구과제 상세 조회 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 연구과제 조회에 실패했습니다.');
    }
  },

  /**
   * @function createProject
   * @description [관리자 전용] 신규 연구과제 생성. title만 필수.
   *
   * Body: title(필수), fundingAgency, program, startDate, endDate, owner, role, status, isPublic, displayOrder
   */
  createProject: async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.title) {
        return fail(res, 400, '연구과제 제목(title)은 필수 입력 항목입니다.');
      }
      if (b.isPublic !== undefined && typeof b.isPublic !== 'boolean') {
        return fail(res, 400, 'isPublic은 boolean이어야 합니다.');
      }
      if (b.displayOrder !== undefined && !Number.isInteger(Number(b.displayOrder))) {
        return fail(res, 400, 'displayOrder는 정수여야 합니다.');
      }

      const project = await ResearchProjectModel.create({
        title: b.title,
        fundingAgency: b.fundingAgency,
        program: b.program,
        startDate: b.startDate,
        endDate: b.endDate,
        owner: b.owner,
        role: b.role,
        status: b.status,
        isPublic: b.isPublic,
        displayOrder: b.displayOrder === undefined ? undefined : Number(b.displayOrder),
      });
      return success(res, project, '연구과제가 생성되었습니다.', 201);
    } catch (error) {
      console.error('연구과제 생성 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 연구과제 생성에 실패했습니다.');
    }
  },

  /**
   * @function updateProject
   * @description [관리자 전용] 연구과제를 부분 수정합니다. 전달된 필드만 반영합니다.
   *
   * Body (모두 선택, 최소 1개): title, fundingAgency, program, startDate, endDate, owner, role, status, isPublic, displayOrder
   */
  updateProject: async (req, res) => {
    try {
      const { id } = req.params;
      const b = req.body || {};

      const existing = await ResearchProjectModel.findById(id);
      if (!existing) {
        return fail(res, 404, '존재하지 않는 연구과제입니다.');
      }

      // camelCase 입력 → DB 컬럼(snake_case) 매핑
      const map = {
        title: 'title',
        fundingAgency: 'funding_agency',
        program: 'program',
        startDate: 'start_date',
        endDate: 'end_date',
        owner: 'owner',
        role: 'role',
        status: 'status',
        isPublic: 'is_public',
        displayOrder: 'display_order',
      };

      const fields = {};
      for (const [inKey, col] of Object.entries(map)) {
        if (b[inKey] !== undefined) fields[col] = b[inKey];
      }

      // 값 검증
      if (fields.title !== undefined && !fields.title) {
        return fail(res, 400, '연구과제 제목은 빈 값일 수 없습니다.');
      }
      if (fields.is_public !== undefined && typeof fields.is_public !== 'boolean') {
        return fail(res, 400, 'isPublic은 boolean이어야 합니다.');
      }
      if (fields.display_order !== undefined) {
        if (!Number.isInteger(Number(fields.display_order))) {
          return fail(res, 400, 'displayOrder는 정수여야 합니다.');
        }
        fields.display_order = Number(fields.display_order);
      }

      if (Object.keys(fields).length === 0) {
        return fail(res, 400, '수정할 필드를 최소 하나 이상 전달해야 합니다.');
      }

      const updated = await ResearchProjectModel.update(id, fields);
      return success(res, updated, '연구과제가 수정되었습니다.');
    } catch (error) {
      console.error('연구과제 수정 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 연구과제 수정에 실패했습니다.');
    }
  },

  /**
   * @function deleteProject
   * @description [관리자 전용] 연구과제를 삭제합니다. 연결된 예산의 project_id는 SET NULL로 정리됩니다.
   */
  deleteProject: async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await ResearchProjectModel.findById(id);
      if (!existing) {
        return fail(res, 404, '존재하지 않는 연구과제입니다.');
      }

      const deleted = await ResearchProjectModel.remove(id);
      return success(res, { id: deleted.id }, '연구과제가 삭제되었습니다.');
    } catch (error) {
      console.error('연구과제 삭제 중 서버 예외 에러:', error);
      return fail(res, 500, '서버 오류로 연구과제 삭제에 실패했습니다.');
    }
  },
};

module.exports = ResearchProjectController;
