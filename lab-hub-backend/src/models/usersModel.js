/**
 * @file usersModel.js
 * @description 테이블 명세서에 정의된 컬럼 구조를 바탕으로 데이터베이스와 통신하는 데이터 액세스 레이어(Model)입니다.
 */

const db = require('../config/db'); // 상위config 폴더에 구현된 DB 커넥션 풀 모듈을 불러옵니다.

const UsersModel = {
  /**
   * @function createPendingUser
   * @description 신규 회원의 가입 신청 데이터를 데이터베이스의 users 테이블에 삽입합니다.
   * @param {Object} userData - 컨트롤러로부터 전달받은 가입 양식 데이터 객체
   * @returns {Object} 데이터베이스에 성공적으로 삽입된 유저의 핵심 식별 데이터
   */
  createPendingUser: async (userData) => {
    // SQL Injection 공격을 차단하기 위해 파라미터화된 쿼리(Parameterized Query) 알고리즘을 사용합니다.
    const queryText = `
      INSERT INTO users (
        email, password_hash, name, student_id, department, 
        program, enrollment_year, research_topic, profile_image, phone,
        bio, github_url, linkedin_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, email, name, account_status, created_at;
    `;

    // 매핑 명세서에 명시된 제약 조건(Default값, Nullable 등)을 반영하여 배열 구조로 정렬합니다.
    const values = [
      userData.email,
      userData.passwordHash, // 비즈니스 로직 단에서 Bcrypt로 단방향 해시화된 비밀번호가 전달됩니다.
      userData.name,
      userData.studentId,
      userData.department,
      userData.program,
      userData.enrollmentYear,
      userData.researchTopic || null, // 선택 입력 항목은 데이터가 없을 시 NULL 바인딩 처리합니다.
      userData.profileImage || null,
      userData.phone || null,
      userData.bio || null,
      userData.githubUrl || null,
      userData.linkedinUrl || null
    ];

    // DB 풀에 대여한 클라이언트를 통해 안전하게 질의를 수행하고 결과를 rows 변수에 할당합니다.
    const { rows } = await db.query(queryText, values);
    return rows[0]; // 생성된 유저의 가입 확인용 레코드를 반환합니다.
  },

  /**
   * @function findByEmail
   * @description 로그인 검증 시 중복 검사 및 계정 조회를 위해 이메일로 사용자 전체 필드를 스캔합니다.
   * @param {string} email - 식별 대상 이메일 주소
   * @returns {Object|null} 조회된 사용자 객체 혹은 존재하지 않을 시 null
   */
  findByEmail: async (email) => {
    const queryText = `SELECT * FROM users WHERE email = $1;`;
    const { rows } = await db.query(queryText, [email]);
    return rows[0];
  },

  /**
   * @function findByStudentId
   * @description 학번(student_id)의 UNIQUE 제약조건 무결성을 지키기 위해 중복 가입 여부를 조회합니다.
   * @param {string} studentId - 학번 또는 사번
   * @returns {Object|null} 학번 존재 여부 확인용 식별 데이터
   */
  findByStudentId: async (studentId) => {
    const queryText = `SELECT id FROM users WHERE student_id = $1;`;
    const { rows } = await db.query(queryText, [studentId]);
    return rows[0];
  },

  /**
   * @function findPendingUsers
   * @description account_status가 'pending'인 가입 승인 대기자 목록을 최신순으로 조회합니다.
   * @returns {Promise<Array>} 대기자 유저 배열
   */
  findPendingUsers: async () => {
    // 비밀번호 해시 등 민감한 정보는 제외하고 행정 처리에 필요한 필드만 추출합니다.
    const queryText = `
      SELECT id, email, name, student_id, department, program, enrollment_year, created_at 
      FROM users 
      WHERE account_status = 'pending'
      ORDER BY created_at DESC;
    `;
    const { rows } = await db.query(queryText);
    return rows;
  },

  /**
   * @function updateUserStatus
   * @description 특정 유저의 가입 상태(account_status)를 승인(approved) 또는 반려(rejected) 등으로 업데이트합니다.
   * @param {number} id - 대상 사용자의 고유 ID (PK)
   * @param {string} status - 변경할 상태 ENUM ('approved', 'rejected', 'deactivated')
   * @returns {Promise<Object>} 업데이트된 유저의 결과 레코드
   */
  updateUserStatus: async (id, status) => {
    const queryText = `
      UPDATE users 
      SET account_status = $2, updated_at = now() 
      WHERE id = $1
      RETURNING id, email, name, account_status, updated_at;
    `;
    const { rows } = await db.query(queryText, [id, status]);
    return rows[0];
  },

  /**
   * @function findById
   * @description 유저의 고유 식별 번호(id)로 단건 정보를 조회합니다.
   */
  findById: async (id) => {
    const queryText = `SELECT id, email, name, role, account_status FROM users WHERE id = $1;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function findAllUsers
   * @description [관리자] 전체 사용자 목록을 민감정보(password_hash) 제외한 안전 필드로 조회합니다. 최신 가입순 정렬.
   *              is_public_profile은 프론트 호환을 위해 is_public 별칭으로 함께 노출합니다.
   * @returns {Promise<Array>} 사용자 목록
   */
  findAllUsers: async () => {
    const queryText = `
      SELECT id, email, name, role, account_status, student_id, department, program,
             enrollment_year, research_topic, phone, bio, github_url, linkedin_url,
             profile_image, is_public_profile AS is_public, is_alumni, last_login_at,
             created_at, updated_at
        FROM users
       ORDER BY created_at DESC, id DESC;
    `;
    const { rows } = await db.query(queryText);
    return rows;
  },

  /**
   * @function updateUserRole
   * @description [관리자] 특정 사용자의 역할(role)을 변경합니다.
   * @param {number} id - users.id
   * @param {string} role - user_role ENUM ('member','manager','admin')
   * @returns {Promise<Object|undefined>} 수정된 레코드
   */
  updateUserRole: async (id, role) => {
    const queryText = `
      UPDATE users SET role = $2, updated_at = now()
       WHERE id = $1
      RETURNING id, email, name, role, account_status, updated_at;
    `;
    const { rows } = await db.query(queryText, [id, role]);
    return rows[0];
  },

  /**
   * @function findProfileById
   * @description 사용자 전체 프로필을 민감정보 제외한 필드로 조회합니다. (마이페이지 조회용)
   * @param {number} id - users.id
   * @returns {Promise<Object|undefined>} 프로필 레코드
   */
  findProfileById: async (id) => {
    const queryText = `
      SELECT id, email, name, role, account_status, student_id, department, program,
             enrollment_year, graduation_year, research_topic, phone, bio,
             github_url, linkedin_url, profile_image, is_public_profile AS is_public,
             is_alumni, preferred_language, last_login_at, created_at, updated_at
        FROM users
       WHERE id = $1;
    `;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function updateProfile
   * @description [본인] 프로필 수정 가능 필드를 부분 업데이트합니다. 전달된 필드만 동적으로 SET 합니다.
   *              이메일/학번/역할/계정상태 등 신원·권한 필드는 본 함수 범위 밖(허용 컬럼 화이트리스트로 차단)입니다.
   * @param {number} id - users.id
   * @param {Object} fields - 허용 컬럼 중 수정 항목만 포함한 객체
   * @returns {Promise<Object|undefined>} 수정된 프로필
   */
  updateProfile: async (id, fields) => {
    const allowed = [
      'name', 'department', 'program', 'enrollment_year', 'research_topic',
      'phone', 'bio', 'github_url', 'linkedin_url', 'profile_image',
      'is_public_profile', 'preferred_language',
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
      return UsersModel.findProfileById(id);
    }
    setClauses.push(`updated_at = now()`);
    values.push(id);

    const queryText = `
      UPDATE users SET ${setClauses.join(', ')}
       WHERE id = $${values.length}
      RETURNING id, email, name, role, account_status, department, program, enrollment_year,
                research_topic, phone, bio, github_url, linkedin_url, profile_image,
                is_public_profile AS is_public, preferred_language, updated_at;
    `;
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function findPasswordHashById
   * @description 비밀번호 변경 시 현재 비밀번호 검증을 위해 password_hash를 조회합니다.
   * @param {number} id - users.id
   * @returns {Promise<Object|undefined>} { id, password_hash }
   */
  findPasswordHashById: async (id) => {
    const { rows } = await db.query('SELECT id, password_hash FROM users WHERE id = $1;', [id]);
    return rows[0];
  },

  /**
   * @function updatePassword
   * @description 사용자의 비밀번호 해시를 갱신합니다. (해싱은 컨트롤러/유틸에서 선행)
   * @param {number} id - users.id
   * @param {string} passwordHash - bcrypt 해시 문자열
   * @returns {Promise<Object|undefined>} { id }
   */
  updatePassword: async (id, passwordHash) => {
    const { rows } = await db.query(
      'UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1 RETURNING id;',
      [id, passwordHash]
    );
    return rows[0];
  }
};

// 모든 질의 메서드가 집약된 유저 모델 객체를 최하단에서 안전하게 export합니다.
module.exports = UsersModel;