/**
 * @file authModel.js
 * @description 인증 전용 데이터 액세스 레이어. refresh_tokens, password_reset_tokens 테이블 쿼리와
 *              인증 흐름상 불가피한 users 테이블 읽기(검증용) 및 비밀번호 해시 갱신만을 담당합니다.
 *              사용자 정보(role, account_status 등) 변경 등 일반 사용자 관리 책임은 본 모델의 범위 밖이며,
 *              usersModel.js(친구 영역)와의 컬럼 변경 충돌을 피하기 위해 users 테이블에는 password_hash UPDATE만 수행합니다.
 */

const db = require('../config/db'); // PostgreSQL 커넥션 풀 모듈을 불러옵니다.

const AuthModel = {
  // ============================================================
  //  Refresh Token
  // ============================================================

  /**
   * @function createRefreshToken
   * @description 발급된 Refresh Token의 해시값을 refresh_tokens 테이블에 적재합니다.
   *              token_hash 컬럼에는 원문 토큰이 절대 저장되지 않으며 SHA-256 해시만 보관합니다.
   * @param {Object} params - { userId, tokenHash, expiresAt, deviceInfo }
   * @returns {Object} 삽입된 토큰 레코드의 핵심 식별 데이터
   */
  createRefreshToken: async ({ userId, tokenHash, expiresAt, deviceInfo }) => {
    const queryText = `
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at, device_info)
      VALUES ($1, $2, $3, $4)
      RETURNING id, user_id, expires_at, created_at;
    `;
    const { rows } = await db.query(queryText, [userId, tokenHash, expiresAt, deviceInfo || null]);
    return rows[0];
  },

  /**
   * @function findActiveRefreshTokenByHash
   * @description 미폐기(revoked_at IS NULL)이며 만료되지 않은(expires_at > now()) Refresh Token 레코드를 조회합니다.
   * @param {string} tokenHash - 클라이언트가 보낸 원문 토큰을 서버에서 sha256 해시한 값
   * @returns {Object|undefined} 유효한 토큰 레코드 또는 undefined
   */
  findActiveRefreshTokenByHash: async (tokenHash) => {
    const queryText = `
      SELECT id, user_id, token_hash, expires_at, revoked_at, created_at
        FROM refresh_tokens
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > now();
    `;
    const { rows } = await db.query(queryText, [tokenHash]);
    return rows[0];
  },

  /**
   * @function revokeRefreshTokenByHash
   * @description 로그아웃 또는 강제 무효화 시 토큰 해시값을 기준으로 revoked_at 타임스탬프를 기록합니다.
   * @param {string} tokenHash - 폐기 대상 Refresh Token의 SHA-256 해시값
   * @returns {Object|undefined} 폐기 처리된 레코드 또는 undefined(이미 폐기되었거나 존재하지 않음)
   */
  revokeRefreshTokenByHash: async (tokenHash) => {
    const queryText = `
      UPDATE refresh_tokens
         SET revoked_at = now()
       WHERE token_hash = $1
         AND revoked_at IS NULL
      RETURNING id, user_id, revoked_at;
    `;
    const { rows } = await db.query(queryText, [tokenHash]);
    return rows[0];
  },

  // ============================================================
  //  Password Reset Token
  // ============================================================

  /**
   * @function createPasswordResetToken
   * @description 비밀번호 재설정 요청 시 발급된 토큰의 해시값을 password_reset_tokens 테이블에 적재합니다.
   *              만료 시간은 컨트롤러 측에서 통상 1시간으로 설정합니다.
   * @param {Object} params - { userId, tokenHash, expiresAt }
   * @returns {Object} 생성된 재설정 토큰 레코드
   */
  createPasswordResetToken: async ({ userId, tokenHash, expiresAt }) => {
    const queryText = `
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
      RETURNING id, user_id, expires_at, created_at;
    `;
    const { rows } = await db.query(queryText, [userId, tokenHash, expiresAt]);
    return rows[0];
  },

  /**
   * @function findActivePasswordResetTokenByHash
   * @description 미사용(used_at IS NULL)이며 만료되지 않은 비밀번호 재설정 토큰 레코드를 조회합니다.
   * @param {string} tokenHash - 원문 토큰의 sha256 해시값
   * @returns {Object|undefined} 유효한 재설정 토큰 레코드 또는 undefined
   */
  findActivePasswordResetTokenByHash: async (tokenHash) => {
    const queryText = `
      SELECT id, user_id, token_hash, expires_at, used_at, created_at
        FROM password_reset_tokens
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > now();
    `;
    const { rows } = await db.query(queryText, [tokenHash]);
    return rows[0];
  },

  /**
   * @function markPasswordResetTokenUsed
   * @description 비밀번호 재설정이 완료된 토큰을 더 이상 재사용할 수 없도록 used_at 타임스탬프를 기록합니다.
   * @param {number} id - 사용 처리할 토큰 레코드의 PK
   * @returns {Object|undefined} 사용 처리된 레코드 또는 undefined
   */
  markPasswordResetTokenUsed: async (id) => {
    const queryText = `
      UPDATE password_reset_tokens
         SET used_at = now()
       WHERE id = $1
         AND used_at IS NULL
      RETURNING id, user_id, used_at;
    `;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  // ============================================================
  //  Users (인증 흐름에 한해 제한적으로 접근)
  // ============================================================

  /**
   * @function findUserById
   * @description Refresh 시 신규 Access Token 페이로드에 담을 최신 role을 조회하기 위한 읽기 전용 쿼리입니다.
   *              사용자 관리(usersModel.js) 범위와 충돌하지 않도록 SELECT만 수행합니다.
   * @param {number} id - 사용자 PK
   * @returns {Object|undefined} 인증에 필요한 최소 필드 (id, email, role, account_status)
   */
  findUserById: async (id) => {
    const queryText = `
      SELECT id, email, name, role, account_status
        FROM users
       WHERE id = $1;
    `;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function updateUserPassword
   * @description 비밀번호 재설정 흐름의 마지막 단계로 users.password_hash 컬럼을 갱신합니다.
   *              본 함수는 인증 책임의 일부로, 컬럼 범위(password_hash, updated_at)를 최소화하여 친구 코드와의 영향도를 차단합니다.
   * @param {number} userId - 갱신 대상 사용자 PK
   * @param {string} passwordHash - bcrypt로 단방향 해시된 신규 비밀번호
   * @returns {Object|undefined} 갱신된 사용자의 식별 정보
   */
  updateUserPassword: async (userId, passwordHash) => {
    const queryText = `
      UPDATE users
         SET password_hash = $2,
             updated_at = now()
       WHERE id = $1
      RETURNING id, email;
    `;
    const { rows } = await db.query(queryText, [userId, passwordHash]);
    return rows[0];
  },
};

module.exports = AuthModel; // Controller 레이어에서 인증 관련 쿼리를 호출할 수 있도록 내보냅니다.
