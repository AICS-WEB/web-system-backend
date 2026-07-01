/**
 * @file role.js
 * @description user_role ENUM(member < manager < admin)의 등급 순서 비교 유틸리티 모듈입니다.
 *              파일 공유(min_role) 등 리소스별로 요구 권한이 달라 authMiddleware.requireRole처럼 고정 목록으로 표현할 수 없는
 *              동적 인가(Authorization) 판정에 사용됩니다.
 *
 *  member  : 1
 *  manager : 2
 *  admin   : 3
 */

// 각 역할의 서열을 숫자로 매핑합니다. 값이 클수록 상위 권한입니다.
const ROLE_RANK = {
  member: 1,
  manager: 2,
  admin: 3,
};

/**
 * @function hasRoleAtLeast
 * @description 요청자의 역할이 요구되는 최소 역할 이상인지 여부를 반환합니다.
 * @param {string} userRole - 요청자 역할 (member/manager/admin)
 * @param {string} requiredRole - 리소스가 요구하는 최소 역할
 * @returns {boolean}
 */
const hasRoleAtLeast = (userRole, requiredRole) => {
  const userRank = ROLE_RANK[userRole];
  const requiredRank = ROLE_RANK[requiredRole];
  if (userRank === undefined || requiredRank === undefined) return false;
  return userRank >= requiredRank;
};

/**
 * @function rolesUpTo
 * @description 요청자의 역할이 접근 가능한 모든 min_role 후보 목록을 반환합니다.
 *              목록 조회 시 "내가 볼 수 있는 min_role 집합"으로 DB WHERE 절 필터에 활용됩니다.
 *              예: admin → ['member','manager','admin'], manager → ['member','manager'], member → ['member']
 * @param {string} userRole
 * @returns {Array<string>} min_role 후보 배열 (권한 없으면 빈 배열)
 */
const rolesUpTo = (userRole) => {
  const userRank = ROLE_RANK[userRole];
  if (userRank === undefined) return [];
  return Object.keys(ROLE_RANK).filter((r) => userRank >= ROLE_RANK[r]);
};

module.exports = {
  ROLE_RANK,
  hasRoleAtLeast,
  rolesUpTo,
};
