/**
 * @file authMiddleware.js
 * @description 요청 헤더의 JWT 토큰을 검증하여 인증(Authentication) 및 등급별 접근 권한 인가(Authorization)를 수행하는 미들웨어입니다.
 */

const jwt = require('jsonwebtoken');
const response = require('../utils/response'); // 친구가 만든 공통 응답 유틸 활용

const AuthMiddleware = {
  /**
   * @function authenticateToken
   * @description [인증 레이어] HTTP 요청 헤더의 Authorization 토큰을 검증하여 유효한 사용자인지 식별합니다.
   */
  authenticateToken: (req, res, next) => {
    try {
      // 1. HTTP 헤더에서 'Authorization' 필드를 추출합니다. (형식: Bearer <TOKEN>)
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1]; // 'Bearer' 문자열을 떼어내고 순수 토큰만 추출

      // 2. 토큰이 존재하지 않을 경우 인증 실패 처리 (401 Unauthorized)
      if (!token) {
        return response.error(res, '접근 권한이 없습니다. 인증 토큰이 누락되었습니다.', 401);
      }

      // 3. 토큰 서명의 유효성 및 만료 여부를 검증합니다.
      const secretKey = process.env.JWT_SECRET || 'aics_default_secret_key_2026';
      
      jwt.verify(token, secretKey, (error, decodedPayload) => {
        if (error) {
          // 토큰이 위조되었거나 만료시간이 지났을 경우 예외 처리 (403 Forbidden)
          return response.error(res, '유효하지 않거나 만료된 인증 토큰입니다.', 403);
        }

        // 4. 검증이 성공하면 토큰 디코딩 결과(id, email, role)를 req.user 객체에 주입합니다.
        // 이를 통해 다음 컨트롤러 로직에서 "req.user.id"로 로그인한 유저를 바로 식별할 수 있습니다.
        req.user = decodedPayload;
        
        // 5. 방어벽을 통과했으므로 다음 비즈니스 로직(Controller)으로 흐름을 넘겨줍니다.
        next();
      });

    } catch (error) {
      console.error('인증 미들웨어 내부 예외 발생:', error);
      return response.error(res, '서ver 인증 처리 중 오류가 발생했습니다.', 500);
    }
  },

  /**
   * @function authorizeRoles
   * @description [인가 레이어] 특정 등급(role) 이상의 권한을 가진 사용자만 접근할 수 있도록 동적으로 제한합니다.
   * @param {...string} allowedRoles - 허용할 권한 등급 목록 (예: 'manager', 'admin')
   */
  authorizeRoles: (...allowedRoles) => {
    return (req, res, next) => {
      // authenticateToken을 먼저 거쳐왔기 때문에 req.user가 반드시 존재해야 합니다.
      if (!req.user) {
        return response.error(res, '인증 정보가 존재하지 않습니다.', 401);
      }

      // 유저의 role이 허용된 등급에 포함되는지 확인합니다.
      const hasPermission = allowedRoles.includes(req.user.role);
      
      if (!hasPermission) {
        return response.error(res, '해당 자원에 접근할 수 있는 관리자 권한이 없습니다.', 403);
      }

      // 권한 검증 성공 시 진행
      next();
    };
  }
};

module.exports = AuthMiddleware;