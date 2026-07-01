/**
 * @file rrule.js
 * @description RRULE(RFC 5545) 문자열 검증 및 UNTIL/COUNT 편집 유틸리티 모듈입니다.
 *              - isValidRRule: 저장 전 RRULE 문법 검증
 *              - setUntil: 반복 시리즈에 종료 시각(UNTIL)을 부여 ("this-and-future" 분할용)
 *              - stripEnd: 기존 시리즈의 UNTIL/COUNT를 제거하여 새 시리즈에 재사용할 패턴을 만듭니다.
 *
 * 참고: 파싱은 rrule 패키지에 위임하되, UNTIL 편집은 문자열 조작으로 단순 처리합니다.
 *       rrule 내부 옵션 재직렬화에는 DTSTART 자동 삽입 등 사이드이펙트가 있어, 우리 스키마(recurrence_rule VARCHAR)에 맞도록
 *       순수 RRULE 파라미터 문자열만 유지하는 것이 안전합니다.
 */

const { rrulestr } = require('rrule');

const RRULE_PREFIX_RE = /^RRULE:/i;

// rrule 파싱기는 "RRULE:" 프리픽스를 요구할 수 있으므로 없으면 붙여줍니다.
const withPrefix = (rule) => (RRULE_PREFIX_RE.test(rule) ? rule : `RRULE:${rule}`);

/**
 * @function isValidRRule
 * @description 입력 문자열이 파싱 가능한 유효한 RRULE인지 검증합니다.
 * @param {string} rule - 검증 대상 RRULE 문자열 (예: 'FREQ=WEEKLY;BYDAY=MO')
 * @returns {boolean}
 */
const isValidRRule = (rule) => {
  if (typeof rule !== 'string' || rule.trim() === '') return false;
  try {
    rrulestr(withPrefix(rule));
    return true;
  } catch {
    return false;
  }
};

/**
 * @function toIcalUtcString
 * @description JS Date를 iCal UTC 포맷(YYYYMMDDTHHMMSSZ)으로 변환합니다.
 */
const toIcalUtcString = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
};

/**
 * @function stripEndTokens
 * @description RRULE 문자열에서 UNTIL/COUNT 토큰을 제거한 파트 배열을 반환하는 내부 헬퍼입니다.
 */
const stripEndTokens = (rule) => {
  const clean = rule.replace(RRULE_PREFIX_RE, '');
  return clean
    .split(';')
    .filter(Boolean)
    .filter((p) => {
      const key = p.split('=')[0].toUpperCase();
      return key !== 'UNTIL' && key !== 'COUNT';
    });
};

/**
 * @function setUntil
 * @description 기존 RRULE의 UNTIL/COUNT를 제거하고 지정한 시각을 UNTIL로 부여합니다.
 *              this-and-future 편집 시 "이 시점까지가 옛 시리즈"를 표현하는 데 사용합니다.
 * @param {string} rule - 원본 RRULE 문자열
 * @param {Date} untilDate - RRULE UNTIL로 사용할 시각 (UTC 기준으로 iCal 포맷화됨)
 * @returns {string} 편집된 RRULE 문자열 (DB 저장용, 프리픽스 없음)
 */
const setUntil = (rule, untilDate) => {
  const filtered = stripEndTokens(rule);
  filtered.push(`UNTIL=${toIcalUtcString(untilDate)}`);
  return filtered.join(';');
};

/**
 * @function stripEnd
 * @description RRULE 문자열의 UNTIL/COUNT를 제거하여 무한 반복 패턴만 남깁니다.
 *              분할 시 새 시리즈가 옛 시리즈의 종료 조건을 이어받지 않도록 정리하는 용도입니다.
 * @param {string} rule
 * @returns {string}
 */
const stripEnd = (rule) => stripEndTokens(rule).join(';');

module.exports = {
  isValidRRule,
  setUntil,
  stripEnd,
};
