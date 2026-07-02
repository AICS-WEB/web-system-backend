/**
 * @file credentialController.js
 * @description 공용 크레덴셜 도메인의 요청/응답 처리를 담당하는 Controller 레이어입니다.
 *              모든 라우트는 authMiddleware를 통과한 뒤 도달하므로 req.user는 항상 존재한다고 가정합니다.
 *
 * 핵심 정책:
 *  - 저장 흐름: 요청 body의 평문 password → utils/crypto.encrypt() → 3개 hex 문자열 → DB.
 *  - 조회 흐름: 목록은 SELECT 화이트리스트로 암호화 컬럼 자체를 제외. 상세도 응답 직전 sanitize()로 재확인.
 *  - 열람(reveal): min_role 인가 통과 시에만 utils/crypto.decrypt()로 복호화하며, 동일 트랜잭션 흐름에서
 *    credential_access_logs에 action='view' 감사 로그를 남깁니다.
 *  - copy 액션: 실제 값은 다시 반환하지 않고 로그만 남겨 클라이언트 측 클립보드 복사 이벤트를 감사합니다.
 *  - min_role 동적 인가: 크레덴셜별 요구 권한이 다르므로 리소스 로드 후 req.user.role과 비교합니다.
 */

const credentialModel = require('../models/credentialModel'); // 크레덴셜 도메인 DB 접근을 위임합니다.
const { encrypt, decrypt } = require('../utils/crypto'); // AES-256-GCM 암/복호화 유틸.
const { hasRoleAtLeast, rolesUpTo } = require('../utils/role'); // 동적 min_role 판정 유틸리티.
const { success, fail } = require('../utils/response'); // 표준 응답 포맷 헬퍼.

// credential_category ENUM 유효값. schema.sql의 CREATE TYPE credential_category와 동기화해야 합니다.
const VALID_CATEGORIES = ['wifi', 'server', 'cloud', 'license', 'other'];

// user_role ENUM 유효값. min_role 필드로 입력 가능한 값 집합입니다.
const VALID_MIN_ROLES = ['member', 'manager', 'admin'];

/**
 * @function sanitize
 * @description 응답 페이로드에서 암호화 원본 3-튜플을 완전히 제거합니다.
 *              목록 SELECT는 이미 컬럼 화이트리스트를 쓰지만, 상세/생성/수정 흐름은 SELECT * / RETURNING *을 쓰므로
 *              반드시 이 함수를 거쳐야 password_encrypted / password_iv / password_auth_tag가 새어나가지 않습니다.
 */
const sanitize = (record) => {
  if (!record) return record;
  const { password_encrypted, password_iv, password_auth_tag, ...safe } = record;
  return safe;
};

const CredentialController = {
  /**
   * @function createCredential
   * @description POST /api/credentials — 신규 크레덴셜 등록.
   *              평문 password를 즉시 AES-256-GCM으로 암호화한 뒤 DB에 3개 컬럼으로 저장합니다.
   *              created_by는 authMiddleware가 주입한 req.user.id로 설정되고 last_rotated_at은 Model이 now()로 초기화합니다.
   */
  createCredential: async (req, res, next) => {
    try {
      const {
        title, category, username, password,
        url, memo, minRole,
      } = req.body || {};

      if (!title || !category || !password) {
        return fail(res, 400, 'Missing required fields (title, category, password).');
      }
      if (!VALID_CATEGORIES.includes(category)) {
        return fail(res, 400, `Invalid category: ${category}`);
      }
      if (minRole !== undefined && minRole !== null && !VALID_MIN_ROLES.includes(minRole)) {
        return fail(res, 400, `Invalid minRole: ${minRole}`);
      }
      if (typeof password !== 'string' || password.length === 0) {
        return fail(res, 400, 'password must be a non-empty string.');
      }

      // 평문 → AES-256-GCM (매 호출마다 새 IV 생성).
      const { encrypted, iv, authTag } = encrypt(password);

      const record = await credentialModel.create({
        title,
        category,
        username,
        passwordEncrypted: encrypted,
        passwordIv: iv,
        passwordAuthTag: authTag,
        url,
        memo,
        minRole,
        createdBy: req.user.id,
      });

      return success(res, sanitize(record), null, 201);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function listCredentials
   * @description GET /api/credentials?category= — 크레덴셜 목록 조회(비밀번호 값 미포함, 메타데이터만).
   *              요청자 role보다 높은 min_role의 크레덴셜은 DB WHERE 절에서 아예 제외됩니다.
   *              목록 조회 자체는 감사 로그를 남기지 않습니다(실제 비번 열람만 로그 남김).
   */
  listCredentials: async (req, res, next) => {
    try {
      const { category } = req.query;
      if (category !== undefined && category !== '' && !VALID_CATEGORIES.includes(category)) {
        return fail(res, 400, `Invalid category filter: ${category}`);
      }

      // 요청자 역할로 접근 가능한 min_role 화이트리스트를 계산합니다.
      // 예: manager → ['member','manager'], admin → ['member','manager','admin']
      const allowedMinRoles = rolesUpTo(req.user.role);

      const rows = await credentialModel.findAll({ category, allowedMinRoles });
      return success(res, rows); // Model이 이미 암호화 컬럼을 SELECT에서 제외했습니다.
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function getCredential
   * @description GET /api/credentials/:id — 크레덴셜 단건 상세(비밀번호 제외).
   *              min_role 동적 인가를 통과해야 응답을 받을 수 있습니다.
   *              암호화 3-튜플은 sanitize()로 응답 직전에 완전히 제거합니다.
   */
  getCredential: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid credential id.');

      const row = await credentialModel.findById(id);
      if (!row) return fail(res, 404, 'Credential not found.');

      if (!hasRoleAtLeast(req.user.role, row.min_role)) {
        return fail(res, 403, 'Forbidden: insufficient role for this credential.');
      }

      return success(res, sanitize(row));
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function revealPassword
   * @description GET /api/credentials/:id/reveal — 실제 비밀번호 복호화 반환.
   *              min_role 인가 통과 시에만 복호화하고, 성공 시 credential_access_logs에 action='view' 로그를 남깁니다.
   *              감사 로그 실패 시에는 평문을 반환하지 않도록 순서상 로그 → 응답 순으로 처리합니다.
   */
  revealPassword: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid credential id.');

      const row = await credentialModel.findById(id);
      if (!row) return fail(res, 404, 'Credential not found.');

      if (!hasRoleAtLeast(req.user.role, row.min_role)) {
        return fail(res, 403, 'Forbidden: insufficient role for this credential.');
      }

      // 무결성 검증까지 포함된 GCM 복호화. 변조된 경우 여기서 예외가 발생해 500으로 전파됩니다.
      const plaintext = decrypt({
        encrypted: row.password_encrypted,
        iv: row.password_iv,
        authTag: row.password_auth_tag,
      });

      // 열람 감사 로그. 실패해도 서버 다운을 피하기 위해 next(err)로 예외를 위임합니다.
      await credentialModel.logAccess({
        credentialId: id,
        userId: req.user.id,
        action: 'view',
      });

      // 응답 페이로드는 최소 필수값만. 절대 password_encrypted 등 원본을 함께 반환하지 않습니다.
      return success(res, {
        id: row.id,
        title: row.title,
        username: row.username,
        password: plaintext,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function logCopy
   * @description POST /api/credentials/:id/copy — 클라이언트 클립보드 복사 액션 감사 로그.
   *              평문 비밀번호는 반환하지 않습니다(이미 reveal에서 받았을 것이라 가정). 로그만 적재하고 종료합니다.
   *              min_role 인가는 여기서도 동일하게 적용합니다(권한 없는 사용자의 로그 노이즈 방지).
   */
  logCopy: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid credential id.');

      const row = await credentialModel.findById(id);
      if (!row) return fail(res, 404, 'Credential not found.');

      if (!hasRoleAtLeast(req.user.role, row.min_role)) {
        return fail(res, 403, 'Forbidden: insufficient role for this credential.');
      }

      await credentialModel.logAccess({
        credentialId: id,
        userId: req.user.id,
        action: 'copy',
      });

      return success(res, { logged: true, id, action: 'copy' });
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function updateCredential
   * @description PATCH /api/credentials/:id — 크레덴셜 부분 수정.
   *              body.password가 유효 문자열로 포함되면 재암호화 후 password_encrypted/iv/auth_tag를 갱신하고
   *              last_rotated_at을 now()로 갱신합니다. 그 외 메타(title/url/memo/min_role 등)만 바뀌면 rotate 없음.
   */
  updateCredential: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid credential id.');

      const existing = await credentialModel.findById(id);
      if (!existing) return fail(res, 404, 'Credential not found.');

      const {
        title, category, username, password,
        url, memo, minRole,
      } = req.body || {};

      if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
        return fail(res, 400, `Invalid category: ${category}`);
      }
      if (minRole !== undefined && !VALID_MIN_ROLES.includes(minRole)) {
        return fail(res, 400, `Invalid minRole: ${minRole}`);
      }

      // patch에 명시된 필드만 담아 Model.update에 전달합니다(허용 필드 화이트리스트).
      const patch = {};
      if (title !== undefined) patch.title = title;
      if (category !== undefined) patch.category = category;
      if (username !== undefined) patch.username = username;
      if (url !== undefined) patch.url = url;
      if (memo !== undefined) patch.memo = memo;
      if (minRole !== undefined) patch.minRole = minRole;

      let rotatePassword = false;
      if (password !== undefined && password !== null && password !== '') {
        if (typeof password !== 'string') {
          return fail(res, 400, 'password must be a string.');
        }
        const { encrypted, iv, authTag } = encrypt(password);
        patch.passwordEncrypted = encrypted;
        patch.passwordIv = iv;
        patch.passwordAuthTag = authTag;
        rotatePassword = true;
      }

      const updated = await credentialModel.update(id, patch, { rotatePassword });
      return success(res, sanitize(updated));
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function deleteCredential
   * @description DELETE /api/credentials/:id — 크레덴셜 삭제.
   *              credential_access_logs.credential_id는 ON DELETE CASCADE이므로 관련 감사 로그가 자동 정리됩니다.
   *              (스키마 상 감사 로그를 영구 보존하려면 별도의 아카이브 흐름이 필요합니다.)
   */
  deleteCredential: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid credential id.');

      const deleted = await credentialModel.remove(id);
      if (!deleted) return fail(res, 404, 'Credential not found.');

      return success(res, { deleted: true, id: deleted.id });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = CredentialController;
