/**
 * @file crypto.js
 * @description [공용 크레덴셜 전용] 대칭키 양방향 암호화 유틸리티 모듈입니다.
 *              공용 비밀번호는 조회 시 평문 반환이 필요하므로 단방향 해시가 아닌 AES-256-GCM 인증 암호화를 사용합니다.
 *
 * 설계 결정:
 *  - 알고리즘: AES-256-GCM (기밀성 + 무결성 + 인증). CBC 대비 tampering 감지가 가능해 크레덴셜 저장에 적합합니다.
 *  - IV 길이: 12바이트(96비트) — NIST SP 800-38D 권장값. 매 암호화마다 crypto.randomBytes로 새로 생성합니다.
 *  - Auth Tag: 16바이트(128비트) — GCM 기본값. DB 컬럼 password_auth_tag VARCHAR(32)에 hex 문자열로 저장합니다.
 *  - 저장 포맷: 모든 바이너리를 hex 문자열로 직렬화하여 TEXT/VARCHAR 컬럼에 안전하게 저장합니다.
 *
 * 키 관리:
 *  - process.env.CREDENTIAL_ENC_KEY (64자 hex = 32바이트) 필수. 없으면 즉시 에러(하드코딩 fallback 절대 없음).
 *  - 키는 최초 사용 시 파싱 후 모듈 내부에 캐싱하여 매 호출마다 재파싱 비용을 배제합니다.
 *  - 키 생성 명령: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const crypto = require('crypto'); // Node.js 내장 crypto 모듈. 외부 종속성 없이 AES-GCM을 제공합니다.

// AES-256-GCM: 256비트(32바이트) 키를 사용하는 인증 암호화 모드.
const ALGORITHM = 'aes-256-gcm';

// NIST SP 800-38D가 권장하는 GCM IV 길이(96비트). 짧을수록 GCM 내부 처리 오버헤드가 작습니다.
const IV_LENGTH_BYTES = 12;

// 32바이트 키를 hex로 인코딩했을 때의 문자열 길이(2 hex char = 1 byte).
const KEY_HEX_LENGTH = 64;

// 모듈 스코프 캐시. 최초 getKey() 호출 시 파싱된 Buffer를 저장합니다.
let cachedKey = null;

/**
 * @function getKey
 * @description 환경 변수에서 대칭키를 로드해 Buffer로 반환합니다.
 *              누락/포맷 불일치 시 명확한 에러 메시지로 즉시 실패시켜 하드코딩 fallback을 원천 차단합니다.
 * @returns {Buffer} 32바이트 대칭키
 */
const getKey = () => {
  if (cachedKey) return cachedKey;

  const raw = process.env.CREDENTIAL_ENC_KEY;
  if (!raw) {
    throw new Error(
      'CREDENTIAL_ENC_KEY environment variable is not set. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  // 정확히 64자 hex 문자열이어야만 32바이트 키로 사용 가능합니다.
  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length !== KEY_HEX_LENGTH) {
    throw new Error(
      `CREDENTIAL_ENC_KEY must be a ${KEY_HEX_LENGTH}-character hex string (32 bytes). ` +
      `Got length ${raw.length}.`
    );
  }

  cachedKey = Buffer.from(raw, 'hex');
  return cachedKey;
};

/**
 * @function encrypt
 * @description 평문 문자열을 AES-256-GCM으로 암호화합니다.
 *              반환된 3개 값(encrypted / iv / authTag)은 각각 DB의 password_encrypted / password_iv / password_auth_tag에 대응됩니다.
 * @param {string} plaintext - 암호화할 평문(비밀번호).
 * @returns {{ encrypted: string, iv: string, authTag: string }} 모두 hex 문자열.
 */
const encrypt = (plaintext) => {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encrypt: plaintext must be a string.');
  }

  const key = getKey();

  // 매 암호화마다 새 IV를 생성해야 GCM의 안전성이 보장됩니다(동일 키/IV 재사용은 치명적 취약점).
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  // Auth tag는 final() 호출 이후에 확정됩니다. 복호화 시 setAuthTag로 검증에 사용됩니다.
  const authTag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
};

/**
 * @function decrypt
 * @description DB에서 읽어온 (encrypted / iv / authTag) 3-튜플을 복호화하여 평문 문자열을 반환합니다.
 *              Auth tag 검증 실패 시(변조 감지) crypto.final()에서 예외가 발생하고 상위 컨트롤러가 500으로 매핑합니다.
 * @param {{ encrypted: string, iv: string, authTag: string }} params - 모두 hex 문자열.
 * @returns {string} 복호화된 평문.
 */
const decrypt = ({ encrypted, iv, authTag }) => {
  if (typeof encrypted !== 'string' || typeof iv !== 'string' || typeof authTag !== 'string') {
    throw new TypeError('decrypt: encrypted, iv, and authTag must all be hex strings.');
  }

  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'hex')),
    decipher.final(), // 무결성 검증 실패 시 여기서 예외가 발생합니다.
  ]);

  return decrypted.toString('utf8');
};

module.exports = {
  encrypt,
  decrypt,
};
