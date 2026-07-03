/**
 * @file applicationModel.js
 * @description 학부 연구생 입단 지원서 장부 적재 및 심사 상태 변경 SQL 질의를 전담하는 데이터 액세스 모델 레이어입니다.
 */

const db = require('../config/db'); // 데이터베이스 커넥션 풀 로드

const ApplicationModel = {
  /**
   * @function createApplication
   * @description 지원자가 상신한 연구생 입단 지원서 레코드를 최초 생성(INSERT)합니다.
   * @param {Object} appData - 지원자 이름, 학번, 자기소개, 포트폴리오 주소 등을 내포한 DTO 객체
   * @returns {Promise<Object>} 등록 완료된 지원서 레코드
   */
  createApplication: async (appData) => {
    const { studentName, studentId, email, introduction, portfolioUrl, attachedFilepath } = appData;
    
    // 명세서 제약에 따라 최초 지원서 접수 시 결재 상태(status)는 'pending'(대기중)으로 적재됩니다.
    const queryText = `
      INSERT INTO lab_applications (
        student_name, student_id, email, introduction, portfolio_url, attached_filepath, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', now(), now())
      RETURNING id, student_name, student_id, status, created_at;
    `;
    const values = [studentName, studentId, email, introduction, portfolioUrl, attachedFilepath];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function findApplicationById
   * @description 심사 및 검증 조치를 위해 특정 지원서 ID로 단건 조회를 수행합니다.
   */
  findApplicationById: async (id) => {
    const queryText = `
      SELECT id, student_name, student_id, email, status 
      FROM lab_applications 
      WHERE id = $1;
    `;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function updateApplicationStatus
   * @description [관리자] 기안된 연구생 지원서에 대해 최종 승인(approved) 또는 반려(rejected) 판정을 내립니다.
   */
  updateApplicationStatus: async (id, status, rejectReason, reviewerId) => {
    // 결재 완료 시각(reviewed_at)에 실시간 타임스탬프인 now()를 마운트합니다.
    const queryText = `
      UPDATE lab_applications
      SET status = $2, reject_reason = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now()
      WHERE id = $1
      RETURNING id, student_name, status, reviewed_by, reviewed_at;
    `;
    const values = [id, status, rejectReason, reviewerId];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  }
};

module.exports = ApplicationModel; // 컨트롤러 비즈니스 레이어에서 호출할 수 있도록 모듈을 내보냅니다.