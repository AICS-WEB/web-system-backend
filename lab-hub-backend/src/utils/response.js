/**
 * @file response.js
 * @description API 응답 포맷을 통일하기 위한 공통 응답 헬퍼 유틸리티입니다.
 */

/**
 * 성공 응답을 표준 포맷으로 전송합니다.
 * @param {import('express').Response} res - Express 응답 객체
 * @param {*} data - 클라이언트에 반환할 데이터
 */
const success = (res, data) => {
  return res.status(200).json({
    success: true,
    data: data,
    message: null,
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
