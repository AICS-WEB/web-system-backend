/**
 * @file bcryptUtils.js
 * @description 사용자 비밀번호의 단방향 해시 암호화 및 로그인 검증을 담당하는 보안 유틸리티 모듈입니다.
 */

const bcrypt = require('bcryptjs'); // 암호화 연산을 수행할 bcryptjs 라이브러리를 로드합니다.

/**
 * 보안성과 연산 속도의 균형을 맞추기 위한 솔트 라운드(Salt Rounds) 횟수 설정입니다.
 * 수치가 높을수록 암호화 연산이 복잡해져 해킹(레인보우 테이블 공격)이 어려워지지만, 서버 CPU 소모가 커집니다.
 * 현업 표준 및 학계 권장 스펙인 '10' 라운드를 상수로 지정합니다.
 */
const SALT_ROUNDS = 10;

const BcryptUtils = {
  /**
   * @function hashPassword
   * @description 사용자가 가입 양식에 입력한 평문 비밀번호를 무작위 솔트와 결합하여 단방향 해시 코드로 변환합니다.
   * @param {string} plainPassword - 사용자가 입력한 순수 문자열 비밀번호
   * @returns {Promise<string>} 암호화가 완료되어 안전해진 해시 문자열
   */
  hashPassword: async (plainPassword) => {
    try {
      // 1. 무작위 난수 문자열인 Salt를 생성합니다.
      const salt = await bcrypt.genSalt(SALT_ROUNDS);
      
      // 2. 평문 비밀번호와 Salt를 결합하여 역추적이 불가능한 단방향 해시 값을 생성한 뒤 반환합니다.
      const hashedPassword = await bcrypt.hash(plainPassword, salt);
      return hashedPassword;
    } catch (error) {
      console.error('비밀번호 암호화 연산 중 치명적 에러 발생:', error);
      throw new Error('Security hashing processing failed.'); // 시스템 내부 에러를 상위 레이어로 전집합니다.
    }
  },

  /**
   * @function comparePassword
   * @description 로그인 요청 시 입력된 평문 비밀번호와 DB에 저장된 복호화 불가능한 해시 값을 안전하게 비교 검증합니다.
   * @param {string} plainPassword - 로그인 폼에 사용자가 새로 입력한 평문 비밀번호
   * @param {string} hashedPassword - 과거 회원가입 승인 시 DB(users 테이블)에 보관된 해시 암호문
   * @returns {Promise<boolean>} 일치 여부 결과 (true / false)
   */
  comparePassword: async (plainPassword, hashedPassword) => {
    try {
      // bcrypt 내부에 구현된 타이밍 어택 방지 알고리즘을 통해 두 암호의 일치 여부를 안전하게 대조합니다.
      const isMatch = await bcrypt.compare(plainPassword, hashedPassword);
      return isMatch;
    } catch (error) {
      console.error('비밀번호 검증 연산 중 치명적 에러 발생:', error);
      throw new Error('Security password comparison failed.');
    }
  }
};

module.exports = BcryptUtils; // 추후 usersController.js에서 가입 및 로그인 처리 시 호출할 수 있도록 모듈을 내보냅니다.