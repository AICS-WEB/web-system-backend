/**
 * @file credentialModel.js
 * @description 연구실 공용 계정 및 크레덴셜 자산 테이블에 접근하여 SQL 질의를 수행하는 데이터 액세스 모델 레이어입니다.
 */

const db = require('../config/db'); // 데이터베이스 커넥션 풀 로드

const CredentialModel = {
  /**
   * @function findAllCredentials
   * @description 연구실 구성원들이 열람할 수 있는 공용 계정 목록 전체를 스캔합니다.
   * @returns {Promise<Array>} 공용 계정 레코드 배열
   */
  findAllCredentials: async () => {
    // 보안을 위해 비밀번호 노출 이력 추적이 가능하도록 최신 등록 순으로 정렬하여 반환합니다.
    const queryText = `
      SELECT id, platform_name, account_id, password_text, description, created_at, updated_at
      FROM shared_credentials
      ORDER BY updated_at DESC;
    `;
    const { rows } = await db.query(queryText);
    return rows;
  },

  /**
   * @function createCredential
   * @description [관리자] 신규 공용 계정 및 비밀번호 레코드를 데이터베이스에 최초 삽입(INSERT)합니다.
   * @param {Object} credentialData - 플랫폼명, 계정 ID, 비밀번호, 설명 등을 포함한 DTO
   * @returns {Promise<Object>} 등록 완료된 크레덴셜 레코드
   */
  createCredential: async (credentialData) => {
    const { platformName, accountId, passwordText, description } = credentialData;
    
    const queryText = `
      INSERT INTO shared_credentials (
        platform_name, account_id, password_text, description, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, now(), now())
      RETURNING id, platform_name, account_id, description, created_at;
    `;
    const values = [platformName, accountId, passwordText, description];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function findCredentialById
   * @description 수정 및 삭제 검증 조치를 위해 특정 크레덴셜 ID로 단건 조회를 수행합니다.
   */
  findCredentialById: async (id) => {
    const queryText = `SELECT id, platform_name FROM shared_credentials WHERE id = $1;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function updateCredential
   * @description [관리자] 특정 공용 계정의 정보 또는 비밀번호를 수정하고 updated_at 타임스탬프를 갱신합니다.
   */
  updateCredential: async (id, credentialData) => {
    const { platformName, accountId, passwordText, description } = credentialData;
    
    const queryText = `
      UPDATE shared_credentials
      SET platform_name = $2, account_id = $3, password_text = $4, description = $5, updated_at = now()
      WHERE id = $1
      RETURNING id, platform_name, account_id, updated_at;
    `;
    const values = [id, platformName, accountId, passwordText, description];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function deleteCredential
   * @description [관리자] 폐기되거나 유효기간이 만료된 공용 계정 레코드를 영구 삭제(DELETE)합니다.
   */
  deleteCredential: async (id) => {
    const queryText = `DELETE FROM shared_credentials WHERE id = $1 RETURNING id;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  }
};

module.exports = CredentialModel; // 컨트롤러 레이어에서 호출할 수 있도록 모듈을 내보냅니다.