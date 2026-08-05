/**
 * @file researchProjectModel.js
 * @description research_projects 테이블에 접근하여 연구과제 내부 CRUD 질의를 수행하는 데이터 액세스 모델 레이어입니다.
 *
 * 실제 스키마(마이그레이션 반영):
 *  - title(필수), funding_agency, program, start_date, end_date, owner, role, status(자유 텍스트),
 *    is_public(NOT NULL, 공개 홈페이지 노출 여부), display_order
 *  - 참고: budgets.project_id 가 본 테이블을 ON DELETE SET NULL 로 참조하므로, 과제 삭제 시 예산의 project_id는 NULL로 정리됩니다.
 */

const db = require('../config/db'); // 데이터베이스 커넥션 풀 로드

// CRUD에서 공통으로 반환할 컬럼 목록 (일관된 응답 형태 유지)
const RETURN_COLS = `id, title, funding_agency, program, start_date, end_date, owner,
                     role, status, is_public, display_order, created_at, updated_at`;

const ResearchProjectModel = {
  /**
   * @function findAll
   * @description 연구과제 전체 목록을 조회합니다. (내부용: is_public 여부와 무관하게 전부 노출)
   *              선택 필터(status/isPublic)를 동적으로 결합하며, 홈페이지 표시 순서(display_order)로 정렬합니다.
   * @param {Object} filters - { status?, isPublic? }
   * @returns {Promise<Array>} 연구과제 목록
   */
  findAll: async ({ status, isPublic } = {}) => {
    const conditions = [];
    const values = [];
    if (status !== undefined && status !== null && status !== '') {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }
    if (isPublic !== undefined && isPublic !== null) {
      values.push(isPublic);
      conditions.push(`is_public = $${values.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const queryText = `
      SELECT ${RETURN_COLS}
        FROM research_projects
        ${whereClause}
       ORDER BY display_order ASC, id ASC;
    `;
    const { rows } = await db.query(queryText, values);
    return rows;
  },

  /**
   * @function findById
   * @description 연구과제 단건을 조회합니다. (상세/수정·삭제 전 실존 검증용)
   * @param {number} id - research_projects.id
   * @returns {Promise<Object|undefined>}
   */
  findById: async (id) => {
    const queryText = `SELECT ${RETURN_COLS} FROM research_projects WHERE id = $1;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function create
   * @description 신규 연구과제를 생성합니다. title만 필수이며 나머지는 선택입니다.
   * @param {Object} data - 연구과제 필드 객체
   * @returns {Promise<Object>} 생성된 레코드
   */
  create: async ({ title, fundingAgency, program, startDate, endDate, owner, role, status, isPublic, displayOrder }) => {
    const queryText = `
      INSERT INTO research_projects (
        title, funding_agency, program, start_date, end_date, owner,
        role, status, is_public, display_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, false), COALESCE($10, 0))
      RETURNING ${RETURN_COLS};
    `;
    const values = [
      title,
      fundingAgency || null,
      program || null,
      startDate || null,
      endDate || null,
      owner || null,
      role || null,
      status || null,
      isPublic === undefined ? null : isPublic,
      displayOrder === undefined ? null : displayOrder,
    ];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function update
   * @description 연구과제를 부분 수정합니다. 전달된 필드만 동적으로 SET 합니다.
   * @param {number} id - research_projects.id
   * @param {Object} fields - 허용 컬럼 중 수정 항목만 포함한 객체(snake_case 키)
   * @returns {Promise<Object|undefined>} 수정된 레코드
   */
  update: async (id, fields) => {
    const allowed = [
      'title', 'funding_agency', 'program', 'start_date', 'end_date',
      'owner', 'role', 'status', 'is_public', 'display_order',
    ];
    const setClauses = [];
    const values = [];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        values.push(fields[key]);
        setClauses.push(`${key} = $${values.length}`);
      }
    }
    if (setClauses.length === 0) {
      return ResearchProjectModel.findById(id);
    }
    setClauses.push(`updated_at = now()`);
    values.push(id);

    const queryText = `
      UPDATE research_projects
         SET ${setClauses.join(', ')}
       WHERE id = $${values.length}
      RETURNING ${RETURN_COLS};
    `;
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function remove
   * @description 연구과제를 삭제합니다. budgets.project_id는 ON DELETE SET NULL로 자동 정리됩니다.
   * @param {number} id - research_projects.id
   * @returns {Promise<Object|undefined>} 삭제된 레코드의 id
   */
  remove: async (id) => {
    const { rows } = await db.query('DELETE FROM research_projects WHERE id = $1 RETURNING id;', [id]);
    return rows[0];
  },
};

module.exports = ResearchProjectModel;
