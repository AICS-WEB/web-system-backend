/**
 * @file applicationModel.js
 * @description 연구생 지원(recruit_applications) 및 첨부(recruit_application_attachments) 도메인의 데이터 액세스 레이어.
 *
 * 컬럼 취급 규칙:
 *  - 이 테이블은 외부인(지원자)이 작성합니다. users와 FK 없음(지원자는 회원이 아님).
 *  - status: recruit_status ENUM('pending','reviewing','accepted','rejected'). 기본 'pending'.
 *  - privacy_consent: 반드시 true여야 저장 가능(테이블 CHECK 제약도 존재). consent_at는 제출 시점 now().
 *  - internal_memo / reviewed_by: 관리자 검토용. 외부(지원자) 응답에는 절대 노출되면 안 됨(Controller가 통제).
 *  - reviewed_by는 users(id) ON DELETE SET NULL. 관리자 삭제 시 검토 기록만 익명화됩니다.
 *  - is_read: 관리자 상세 열람 시 true로 갱신됩니다(Controller에서 호출).
 */

const db = require('../config/db'); // PostgreSQL 커넥션 풀 모듈.

const ApplicationModel = {
  /**
   * @function create
   * @description 신규 지원 서류를 저장합니다. privacy_consent=true를 강제하며 consent_at는 now()로 함께 기록합니다.
   *              공개 폼 제출에서 호출되며 Controller가 검증을 완료한 상태로 진입해야 합니다.
   */
  create: async (data) => {
    const queryText = `
      INSERT INTO recruit_applications (
        target_term, name, email, phone, student_id, department, grade,
        interest_area, introduction, github_url, portfolio_url,
        privacy_consent, consent_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11,
        true, now()
      )
      RETURNING id, target_term, name, email, status, is_read, created_at;
    `;
    const values = [
      data.targetTerm,
      data.name,
      data.email,
      data.phone || null,
      data.studentId || null,
      data.department || null,
      data.grade || null,
      data.interestArea || null,
      data.introduction || null,
      data.githubUrl || null,
      data.portfolioUrl || null,
    ];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function findByEmailAndTerm
   * @description 동일 이메일 + 동일 target_term 조합으로 이미 접수된 지원서가 있는지 확인합니다.
   *              공개 제출 흐름에서 중복 제출을 409로 거부하는 데 사용합니다.
   *              email 매칭은 대소문자 구분 없이 처리하여 사용자의 표기 차이로 인한 중복 우회를 막습니다.
   */
  findByEmailAndTerm: async (email, targetTerm) => {
    const queryText = `
      SELECT id
        FROM recruit_applications
       WHERE LOWER(email) = LOWER($1) AND target_term = $2
       LIMIT 1;
    `;
    const { rows } = await db.query(queryText, [email, targetTerm]);
    return rows[0];
  },

  /**
   * @function findAll
   * @description 관리자 목록 조회. status, target_term, is_read 필터를 조합해 반환합니다.
   *              internal_memo 등 민감 컬럼도 함께 반환되므로 Controller는 반드시 인증/인가를 거친 뒤 호출해야 합니다.
   */
  findAll: async ({ status, targetTerm, isRead } = {}) => {
    const conditions = [];
    const values = [];

    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}::recruit_status`);
    }
    if (targetTerm) {
      values.push(targetTerm);
      conditions.push(`target_term = $${values.length}`);
    }
    if (typeof isRead === 'boolean') {
      values.push(isRead);
      conditions.push(`is_read = $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const queryText = `
      SELECT *
        FROM recruit_applications
        ${whereClause}
       ORDER BY created_at DESC, id DESC;
    `;
    const { rows } = await db.query(queryText, values);
    return rows;
  },

  /**
   * @function findById
   * @description 지원 서류 단건 조회. 상세 응답이 관리자용이므로 internal_memo 포함해 반환합니다.
   */
  findById: async (id) => {
    const queryText = `SELECT * FROM recruit_applications WHERE id = $1;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function markRead
   * @description 관리자 상세 열람 시 is_read=true로 원자적으로 갱신합니다.
   *              is_read=false인 경우에만 UPDATE가 발생하며, 이미 읽음 상태였다면 undefined를 반환합니다.
   */
  markRead: async (id) => {
    const queryText = `
      UPDATE recruit_applications
         SET is_read = true, updated_at = now()
       WHERE id = $1 AND is_read = false
      RETURNING *;
    `;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function update
   * @description 부분 업데이트(PATCH). status/internal_memo/is_read/reviewed_by 필드만 화이트리스트로 갱신합니다.
   *              공개 폼에서 넘어오는 필드(name/email 등)는 절대 이 함수로 갱신되지 않습니다.
   */
  update: async (id, patch) => {
    const fieldMap = {
      status: 'status',
      internalMemo: 'internal_memo',
      isRead: 'is_read',
      reviewedBy: 'reviewed_by',
    };

    const sets = [];
    const values = [];
    let i = 1;
    for (const [key, column] of Object.entries(fieldMap)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        // status는 recruit_status ENUM으로 명시 캐스팅합니다.
        if (column === 'status') {
          sets.push(`${column} = $${i}::recruit_status`);
        } else {
          sets.push(`${column} = $${i}`);
        }
        values.push(patch[key]);
        i += 1;
      }
    }

    if (sets.length === 0) {
      return await ApplicationModel.findById(id);
    }
    sets.push(`updated_at = now()`);

    values.push(id);
    const queryText = `
      UPDATE recruit_applications
         SET ${sets.join(', ')}
       WHERE id = $${i}
      RETURNING *;
    `;
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function remove
   * @description 지원 서류 완전 삭제. recruit_application_attachments는 ON DELETE CASCADE이므로 첨부도 자동 정리됩니다.
   */
  remove: async (id) => {
    const queryText = `DELETE FROM recruit_applications WHERE id = $1 RETURNING id;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },
};

module.exports = ApplicationModel;
