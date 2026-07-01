/**
 * @file response.js
 * @description API 응답 포맷을 통일하기 위한 공통 응답 헬퍼 유틸리티입니다.
 *              전 도메인 표준 응답 스펙은 { success: boolean, data: any|null, message: string|null } 입니다.
 */

/**
 * 성공 응답을 표준 포맷으로 전송합니다.
 * @param {import('express').Response} res - Express 응답 객체
 * @param {*} data - 클라이언트에 반환할 데이터
 * @param {string|null} [message=null] - 부가 안내 메시지 (선택)
 * @param {number} [status=200] - HTTP 상태 코드 (선택, 기본 200)
 */
const success = (res, data, message = null, status = 200) => {
  return res.status(status).json({
    success: true,
    data: data,
    message: message,
  });
};

/**
 * 실패 응답을 표준 포맷으로 전송합니다.
 * @param {import('express').Response} res - Express 응답 객체
 * @param {number} status - HTTP 상태 코드
 * @param {string} message - 에러 메시지
 */
const fail = (res, status, message) => {
  return res.status(status).json({
    success: false,
    data: null,
    message: message,
  });
};

// 타 모듈(Controller 등)에서 공통 응답 포맷을 일관되게 사용할 수 있도록 내보냅니다.
module.exports = {
  success,
  fail,
};
