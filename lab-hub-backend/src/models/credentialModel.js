/**
 * @file credentialModel.js
 * @description 공용 크레덴셜(shared_credentials) 및 접근 감사 로그(credential_access_logs) 도메인의 데이터 액세스 레이어.
 *
 * 컬럼 취급 규칙:
 *  - password_encrypted / password_iv / password_auth_tag: AES-256-GCM 산출물. Model은 값 저장/조회만 담당하고
 *    실제 암/복호화는 Controller가 utils/crypto.js를 통해 수행합니다.
 *  - min_role: shared_credentials별 열람 최소 권한. DB 기본값 'member'.
 *  - last_rotated_at: 생성 시 now(), 이후 비밀번호가 실제로 재암호화된 경우에만 갱신됩니다.
 *  - created_by: users(id) SET NULL 정책이므로 NULL 허용.
 *
 * credential_access_logs:
 *  - credential_id는 ON DELETE CASCADE — 크레덴셜 삭제 시 로그도 함께 삭제됩니다.
 *  - user_id는 NOT NULL + ON DELETE RESTRICT — 감사 로그 보존 정책상 사용자를 지울 수 없게 막습니다.
 *  - action은 credential_action ENUM('view','copy'). view는 복호화 열람, copy는 클라이언트 복사 액션.
 */

const db = require('../config/db'); // PostgreSQL 커넥션 풀 모듈.

// 목록 SELECT 절에서 공통으로 사용할, 암호화 원본을 제외한 안전 컬럼 화이트리스트.
// 응답에 password_encrypted / password_iv / password_auth_tag가 새어나가지 않도록 DB 레벨에서 원천 차단합니다.
const SAFE_COLUMNS = `
  id, title, category, username, url, memo, min_role,
  last_rotated_at, created_by, created_at, updated_at
`;

const CredentialModel = {
  /**
   * @function create
   * @description 신규 크레덴셜 저장. 암호화된 3-튜플을 각 컬럼에 저장하며 last_rotated_at=now()로 초기화합니다.
   */
  create: async ({
    title, category, username,
    passwordEncrypted, passwordIv, passwordAuthTag,
    url, memo, minRole, createdBy,
  }) => {
    const queryText = `
      INSERT INTO shared_credentials (
        title, category, username,
        password_encrypted, password_iv, password_auth_tag,
        url, memo, min_role, last_rotated_at, created_by
      ) VALUES (
        $1, $2::credential_category, $3,
        $4, $5, $6,
        $7, $8, COALESCE($9::user_role, 'member'::user_role), now(), $10
      )
      RETURNING *;
    `;
    const values = [
      title,
      category,
      username || null,
      passwordEncrypted,
      passwordIv,
      passwordAuthTag,
      url || null,
      memo || null,
      minRole === undefined || minRole === null ? null : minRole,
      createdBy || null,
    ];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function findAll
   * @description 크레덴셜 목록 조회. 응답 페이로드 자체에서 암호화 컬럼을 제외해 반환합니다.
   *              min_role 화이트리스트로 요청자 권한 이하 등급만 노출하여 응용 계층 필터링 누락 위험을 배제합니다.
   */
  findAll: async ({ category, allowedMinRoles } = {}) => {
    const conditions = [];
    const values = [];

    if (Array.isArray(allowedMinRoles)) {
      // 빈 배열이면 어떤 등급도 없다는 뜻이므로 결과가 반드시 0건이 되도록 즉시 반환합니다.
      if (allowedMinRoles.length === 0) return [];
      values.push(allowedMinRoles);
      conditions.push(`min_role = ANY($${values.length}::user_role[])`);
    }

    if (category !== undefined && category !== null && category !== '') {
      values.push(category);
      conditions.push(`category = $${values.length}::credential_category`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const queryText = `
      SELECT ${SAFE_COLUMNS}
        FROM shared_credentials
        ${whereClause}
       ORDER BY created_at DESC, id DESC;
    `;
    const { rows } = await db.query(queryText, values);
    return rows;
  },

  /**
   * @function findById
   * @description 크레덴셜 단건 조회. 복호화가 필요한 상세/reveal 흐름을 위해 암호화 컬럼까지 포함해 반환합니다.
   *              Controller에서 응답 전 반드시 sanitize()로 암호화 원본을 제거해야 합니다.
   */
  findById: async (id) => {
    const queryText = `SELECT * FROM shared_credentials WHERE id = $1;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function update
   * @description 부분 업데이트(PATCH). patch에 명시된 필드만 SET 절에 포함시켜 안전한 부분 수정을 수행합니다.
   *              options.rotatePassword=true인 경우 last_rotated_at을 now()로 갱신합니다.
   *              (Controller가 password 재암호화 여부를 판단해 이 플래그를 True로 전달합니다.)
   */
  update: async (id, patch, { rotatePassword = false } = {}) => {
    const fieldMap = {
      title: 'title',
      category: 'category',
      username: 'username',
      passwordEncrypted: 'password_encrypted',
      passwordIv: 'password_iv',
      passwordAuthTag: 'password_auth_tag',
      url: 'url',
      memo: 'memo',
      minRole: 'min_role',
    };

    const sets = [];
    const values = [];
    let i = 1;
    for (const [key, column] of Object.entries(fieldMap)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        // ENUM 타입은 명시적 캐스팅을 걸어 pg의 타입 추론 실패를 방지합니다.
        if (column === 'category') {
          sets.push(`${column} = $${i}::credential_category`);
        } else if (column === 'min_role') {
          sets.push(`${column} = $${i}::user_role`);
        } else {
          sets.push(`${column} = $${i}`);
        }
        values.push(patch[key]);
        i += 1;
      }
    }

    // 변경 컬럼도 없고 재암호화도 없으면 no-op 처리하여 불필요한 UPDATE를 피합니다.
    if (sets.length === 0 && !rotatePassword) {
      return await CredentialModel.findById(id);
    }

    if (rotatePassword) sets.push(`last_rotated_at = now()`);
    sets.push(`updated_at = now()`);

    values.push(id);
    const queryText = `
      UPDATE shared_credentials
         SET ${sets.join(', ')}
       WHERE id = $${i}
      RETURNING *;
    `;
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function remove
   * @description 크레덴셜 삭제. credential_access_logs.credential_id가 ON DELETE CASCADE이므로
   *              별도의 사전 삭제 없이 원자적으로 로그까지 함께 정리됩니다.
   *              (감사 로그를 영구 보존해야 한다면 향후 스키마를 RESTRICT로 바꾸고 아카이브 테이블에 사전 스냅샷을 뜨는
   *               흐름이 필요하지만, 현재 스키마 기준에서는 CASCADE를 그대로 따릅니다.)
   */
  remove: async (id) => {
    const queryText = `DELETE FROM shared_credentials WHERE id = $1 RETURNING id;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function logAccess
   * @description credential_access_logs에 감사 로그를 1건 적재합니다.
   *              view는 복호화 열람 시점, copy는 클라이언트 복사 액션 시점에 호출됩니다.
   *              user_id RESTRICT 정책으로 이 로그가 존재하는 한 해당 사용자는 삭제될 수 없습니다.
   */
  logAccess: async ({ credentialId, userId, action }) => {
    const queryText = `
      INSERT INTO credential_access_logs (credential_id, user_id, action)
      VALUES ($1, $2, $3::credential_action)
      RETURNING id, credential_id, user_id, action, accessed_at;
    `;
    const { rows } = await db.query(queryText, [credentialId, userId, action]);
    return rows[0];
  },
};

module.exports = CredentialModel;
