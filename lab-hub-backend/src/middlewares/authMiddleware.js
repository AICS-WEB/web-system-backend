/**
 * @file authMiddleware.js
 * @description Authorization 헤더의 Bearer Access Token을 검증하여 req.user에 인증 컨텍스트를 주입하는 미들웨어 모듈입니다.
 *              역할(Role) 기반 인가는 requireRole(...roles) 헬퍼로 별도 제공합니다.
 */

const jwtUtils = require('../utils/jwt'); // Access Token 검증 유틸리티를 불러옵니다.
const { fail } = require('../utils/response'); // 표준 실패 응답 헬퍼를 불러옵니다.

/**
 * @function authMiddleware
 * @description "Authorization: Bearer <token>" 형식의 헤더를 파싱하고 JWT 서명/만료를 검증합니다.
 *              성공 시 req.user = { id, role }을 주입하고 next(), 실패 시 401을 반환합니다.
 */
const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  // Bearer 스키마 및 토큰 문자열 존재 여부를 1차 검증합니다.
  if (scheme !== 'Bearer' || !token) {
    return fail(res, 401, 'Missing or invalid Authorization header.');
  }

  try {
    // JWT 서명/만료 검증을 수행합니다. 실패 시 jsonwebtoken이 예외를 발생시킵니다.
    const payload = jwtUtils.verifyAccessToken(token);

    // 후속 라우트 핸들러에서 활용할 수 있도록 인증된 사용자 정보를 요청 객체에 주입합니다.
    req.user = {
      id: payload.sub,
      role: payload.role,
    };
    return next();
  } catch (err) {
    return fail(res, 401, 'Invalid or expired access token.');
  }
};

/**
 * @function requireRole
 * @description 특정 역할(들)을 가진 사용자만 통과시키는 인가(Authorization) 미들웨어를 생성합니다.
 *              authMiddleware 이후 체이닝하여 사용합니다. 예: router.post('/admin', authMiddleware, requireRole('admin'), handler)
 * @param  {...string} roles - 통과를 허용할 역할 목록 (예: 'admin', 'manager')
 * @returns {Function} Express 미들웨어 함수
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return fail(res, 401, 'Authentication required.');
  }
  if (!roles.includes(req.user.role)) {
    return fail(res, 403, 'Forbidden: insufficient role.');
  }
  return next();
};

module.exports = {
  authMiddleware,
  requireRole,
};
