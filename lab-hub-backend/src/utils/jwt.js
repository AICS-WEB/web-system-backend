/**
 * @file jwt.js
 * @description JWT(Access Token) 발급/검증 및 불투명(Opaque) Refresh/Reset 토큰 생성·해시 유틸리티 모듈입니다.
 *              Refresh/Reset 토큰은 원문을 DB에 절대 저장하지 않으며, SHA-256 해시값만 보관합니다.
 */

const crypto = require('crypto'); // 난수 토큰 생성 및 단방향 해시(sha256) 연산을 위한 Node.js 내장 모듈입니다.
const jsonwebtoken = require('jsonwebtoken'); // RFC 7519 표준의 JWT 발급/검증 라이브러리입니다.

// JWT 서명에 사용되는 비밀키. 실제 운영 환경에서는 반드시 .env에서 안전하게 주입되어야 합니다.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';

// Access Token의 기본 만료 시간(30분). .env에서 JWT_ACCESS_EXPIRES_IN으로 재정의 가능합니다.
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '30m';

const JwtUtils = {
  /**
   * @function signAccessToken
   * @description 사용자 식별자와 권한 정보를 담은 Access Token(JWT)을 발급합니다. 기본 만료 30분.
   * @param {Object} payload - 토큰에 직렬화할 클레임 (예: { sub, role })
   * @returns {string} 서명이 완료된 JWT 문자열
   */
  signAccessToken: (payload) => {
    return jsonwebtoken.sign(payload, JWT_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
  },

  /**
   * @function verifyAccessToken
   * @description Authorization 헤더에서 추출한 Access Token의 서명/만료를 검증한 뒤 페이로드를 반환합니다.
   * @param {string} token - 검증 대상 JWT 문자열
   * @returns {Object} 디코딩된 페이로드 객체
   * @throws {Error} 서명 불일치 또는 만료된 토큰일 경우 예외를 발생시킵니다.
   */
  verifyAccessToken: (token) => {
    return jsonwebtoken.verify(token, JWT_SECRET);
  },

  /**
   * @function generateOpaqueToken
   * @description Refresh Token / Password Reset Token으로 사용할 충분한 엔트로피를 가진 난수 문자열을 생성합니다.
   *              JWT가 아닌 불투명 토큰을 선택하는 이유는, 페이로드를 외부에 노출하지 않고 DB 조회로 무효화(revoke)를 강제할 수 있기 때문입니다.
   * @returns {string} 64바이트(512비트) 길이의 16진수 문자열
   */
  generateOpaqueToken: () => {
    return crypto.randomBytes(64).toString('hex');
  },

  /**
   * @function hashOpaqueToken
   * @description 클라이언트에 전달된 원문 토큰을 DB 저장/조회용 SHA-256 해시 문자열로 변환합니다.
   *              비밀번호와 달리 토큰은 엔트로피가 매우 높으므로 bcrypt가 아닌 SHA-256으로 충분하며 비교 비용도 낮습니다.
   * @param {string} token - 원문 불투명 토큰
   * @returns {string} 단방향 해시된 16진수 문자열
   */
  hashOpaqueToken: (token) => {
    return crypto.createHash('sha256').update(token).digest('hex');
  },
};

module.exports = JwtUtils; // Controller 및 Middleware 레이어에서 토큰 유틸리티를 재사용할 수 있도록 내보냅니다.
