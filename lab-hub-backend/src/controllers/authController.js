/**
 * @file authController.js
 * @description 인증 흐름(회원가입, 로그인, 토큰 갱신, 로그아웃, 비밀번호 재설정)의 요청/응답을 담당하는 Controller 레이어입니다.
 *              비즈니스 로직은 본 파일에 두고, DB 접근은 모델 레이어에 위임합니다.
 */

const usersModel = require('../models/usersModel'); // 회원 조회/가입은 친구 영역인 usersModel을 재사용합니다.
const authModel = require('../models/authModel'); // refresh/reset 토큰 및 인증 전용 쿼리를 제공합니다.
const bcryptUtils = require('../utils/bcryptUtils'); // 평문 비밀번호 해시·비교 유틸리티.
const jwtUtils = require('../utils/jwt'); // Access Token 발급 및 불투명 토큰 생성·해시 유틸리티.
const { success, fail } = require('../utils/response'); // 표준 응답 포맷 헬퍼.

// Refresh Token의 유효 기간(일). .env(REFRESH_TOKEN_TTL_DAYS)로 재정의 가능하며 기본 14일입니다.
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 14);

// Password Reset Token의 유효 기간(분). .env(RESET_TOKEN_TTL_MINUTES)로 재정의 가능하며 기본 60분입니다.
const RESET_TOKEN_TTL_MINUTES = Number(process.env.RESET_TOKEN_TTL_MINUTES || 60);

const AuthController = {
  /**
   * @function register
   * @description POST /api/auth/register — 신규 회원 가입 신청을 처리합니다.
   *              비밀번호는 bcrypt 해시 후 저장하며, account_status는 DB 기본값('pending')을 그대로 사용해 관리자 승인 대기 상태로 진입합니다.
   *              role 또한 DB 기본값('member')으로 시작되며 본 흐름에서는 변경하지 않습니다.
   */
  register: async (req, res, next) => {
    try {
      const {
        email,
        password,
        name,
        studentId,
        department,
        program,
        enrollmentYear,
        researchTopic,
        profileImage,
        phone,
        bio,
        githubUrl,
        linkedinUrl,
      } = req.body || {};

      // 필수 입력 항목의 누락 여부를 1차로 검증합니다.
      if (!email || !password || !name || !studentId || !department || !program || !enrollmentYear) {
        return fail(res, 400, 'Missing required fields.');
      }

      // 이메일/학번 UNIQUE 제약 위반을 사전에 차단하여 사용자 친화적인 메시지를 반환합니다.
      const existsEmail = await usersModel.findByEmail(email);
      if (existsEmail) return fail(res, 409, 'Email already registered.');

      const existsStudent = await usersModel.findByStudentId(studentId);
      if (existsStudent) return fail(res, 409, 'Student ID already registered.');

      // 평문 비밀번호를 bcrypt 단방향 해시로 변환합니다.
      const passwordHash = await bcryptUtils.hashPassword(password);

      // usersModel에 정의된 표준 INSERT를 활용합니다. account_status/role은 DB 기본값을 사용합니다.
      const newUser = await usersModel.createPendingUser({
        email,
        passwordHash,
        name,
        studentId,
        department,
        program,
        enrollmentYear,
        researchTopic,
        profileImage,
        phone,
        bio,
        githubUrl,
        linkedinUrl,
      });

      // 응답에는 비밀번호 해시 등 민감 정보가 포함되지 않도록 createPendingUser의 RETURNING 결과만 그대로 전달합니다.
      return success(res, newUser);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function login
   * @description POST /api/auth/login — 이메일/비밀번호 검증 후 Access(JWT, 30분) + Refresh(불투명, 14일) 토큰을 발급합니다.
   *              account_status가 'approved'가 아닐 경우 인증을 거부하여 미승인 계정의 진입을 차단합니다.
   */
  login: async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) return fail(res, 400, 'Missing email or password.');

      const user = await usersModel.findByEmail(email);
      // 사용자 존재 여부를 외부에 노출하지 않도록 동일한 401 메시지를 사용합니다.
      if (!user) return fail(res, 401, 'Invalid email or password.');

      const isMatch = await bcryptUtils.comparePassword(password, user.password_hash);
      if (!isMatch) return fail(res, 401, 'Invalid email or password.');

      // 관리자 승인 흐름: 'approved' 이외의 계정 상태는 모두 차단합니다 (pending/rejected/deactivated).
      if (user.account_status !== 'approved') {
        return fail(res, 403, `Account is not approved (status: ${user.account_status}).`);
      }

      // Access Token: 30분 만료의 짧은 수명 토큰. 최소 클레임만 포함합니다.
      const accessToken = jwtUtils.signAccessToken({
        sub: user.id,
        role: user.role,
      });

      // Refresh Token: 충분한 엔트로피의 불투명 난수. 클라이언트엔 원문, DB엔 해시만 저장합니다.
      const refreshTokenPlain = jwtUtils.generateOpaqueToken();
      const refreshTokenHash = jwtUtils.hashOpaqueToken(refreshTokenPlain);
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

      await authModel.createRefreshToken({
        userId: user.id,
        tokenHash: refreshTokenHash,
        expiresAt,
        deviceInfo: req.headers['user-agent'] || null,
      });

      return success(res, {
        accessToken,
        refreshToken: refreshTokenPlain, // 원문은 응답 1회로 한정되며 이후 서버에서는 해시 기준으로만 검증합니다.
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function refresh
   * @description POST /api/auth/refresh — 유효한 Refresh Token으로 새로운 Access Token을 발급합니다.
   *              DB의 token_hash 비교 + revoked_at IS NULL + expires_at > now() 세 조건을 모두 충족해야 합니다.
   */
  refresh: async (req, res, next) => {
    try {
      const { refreshToken } = req.body || {};
      if (!refreshToken) return fail(res, 400, 'Missing refresh token.');

      // 클라이언트가 보낸 원문을 동일 알고리즘(SHA-256)으로 해시하여 DB에 저장된 해시와 대조합니다.
      const tokenHash = jwtUtils.hashOpaqueToken(refreshToken);
      const tokenRow = await authModel.findActiveRefreshTokenByHash(tokenHash);
      if (!tokenRow) return fail(res, 401, 'Invalid or expired refresh token.');

      // 신규 Access Token 발급 시점에 최신 role을 반영하기 위해 사용자 정보를 다시 조회합니다.
      const user = await authModel.findUserById(tokenRow.user_id);
      if (!user) return fail(res, 401, 'User no longer exists.');

      // 정책적으로 미승인 상태의 계정에는 토큰 재발급을 차단합니다.
      if (user.account_status !== 'approved') {
        return fail(res, 403, `Account is not approved (status: ${user.account_status}).`);
      }

      const accessToken = jwtUtils.signAccessToken({
        sub: user.id,
        role: user.role,
      });

      return success(res, { accessToken });
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function logout
   * @description POST /api/auth/logout — 전달받은 Refresh Token을 폐기(revoked_at 기록)합니다.
   *              Access Token은 짧은 수명을 가지므로 별도 블랙리스트 처리는 수행하지 않습니다.
   */
  logout: async (req, res, next) => {
    try {
      const { refreshToken } = req.body || {};
      if (!refreshToken) return fail(res, 400, 'Missing refresh token.');

      const tokenHash = jwtUtils.hashOpaqueToken(refreshToken);
      await authModel.revokeRefreshTokenByHash(tokenHash);

      // 토큰 존재 여부와 무관하게 동일한 성공 응답을 반환하여 토큰 정찰(Token Enumeration)을 방지합니다.
      return success(res, { revoked: true });
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function passwordResetRequest
   * @description POST /api/auth/password/reset-request — 이메일을 입력받아 비밀번호 재설정 토큰을 발급합니다.
   *              실제 이메일 발송 인프라는 본 구현 범위 밖이며, 운영 환경에서는 토큰 원문을 응답에 절대 포함시키지 말아야 합니다.
   *              사용자 존재 여부를 외부에 노출하지 않기 위해 동일한 성공 응답을 반환합니다(User Enumeration 방지).
   */
  passwordResetRequest: async (req, res, next) => {
    try {
      const { email } = req.body || {};
      if (!email) return fail(res, 400, 'Missing email.');

      const user = await usersModel.findByEmail(email);

      // 사용자가 존재하지 않더라도 동일한 success 응답을 반환합니다.
      if (!user) return success(res, { sent: true });

      const tokenPlain = jwtUtils.generateOpaqueToken();
      const tokenHash = jwtUtils.hashOpaqueToken(tokenPlain);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

      await authModel.createPasswordResetToken({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      // 개발 환경에서는 응답에 원문 토큰을 노출하여 수동 테스트를 돕습니다.
      // TODO: 운영 환경에서는 본 분기를 제거하고 이메일 발송 서비스를 통해 전달해야 합니다.
      const payload = { sent: true };
      if (process.env.NODE_ENV !== 'production') {
        payload.resetToken = tokenPlain;
      }
      return success(res, payload);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function passwordReset
   * @description POST /api/auth/password/reset — 재설정 토큰을 검증한 뒤 비밀번호를 변경하고 토큰을 사용 처리합니다.
   *              토큰 유효성(used_at IS NULL, expires_at > now())을 통과해야 비밀번호가 갱신됩니다.
   */
  passwordReset: async (req, res, next) => {
    try {
      const { token, newPassword } = req.body || {};
      if (!token || !newPassword) return fail(res, 400, 'Missing token or newPassword.');

      const tokenHash = jwtUtils.hashOpaqueToken(token);
      const tokenRow = await authModel.findActivePasswordResetTokenByHash(tokenHash);
      if (!tokenRow) return fail(res, 401, 'Invalid or expired reset token.');

      const passwordHash = await bcryptUtils.hashPassword(newPassword);

      // 1) 비밀번호 갱신 → 2) 토큰을 사용 처리하여 재사용을 차단합니다.
      await authModel.updateUserPassword(tokenRow.user_id, passwordHash);
      await authModel.markPasswordResetTokenUsed(tokenRow.id);

      return success(res, { reset: true });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = AuthController;
