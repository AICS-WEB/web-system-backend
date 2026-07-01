/**
 * @file noticeModel.js
 * @description notices 및 notice_attachments 테이블에 무결성 제약조건을 만족하며 접근하는 데이터 액세스 레이어입니다.
 */

const db = require('../config/db'); // 데이터베이스 커넥션 풀 로드

const NoticeModel = {
  /**
   * @function createNotice
   * @description 신규 공지사항 마스터 레코드를 데이터베이스에 최초 삽입(INSERT)합니다.
   * @param {Object} noticeData - 공지사항 제목, 본문, 카테고리, 상단고정 여부를 포함한 DTO
   * @returns {Promise<Object>} 등록 완료된 공지사항 마스터 레코드 객체
   */
  createNotice: async (noticeData) => {
    const { authorId, title, content, category, isPinned } = noticeData;
    
    // 명세서에 따라 view_count의 기본값은 0이며, created_at/updated_at은 now()로 적재됩니다.
    const queryText = `
      INSERT INTO notices (
        author_id, title, content, category, is_pinned, view_count, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, 0, now(), now())
      RETURNING id, author_id, title, content, category, is_pinned, view_count, created_at;
    `;
    
    const values = [authorId, title, content, category, isPinned];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function insertAttachmentsBulk
   * @description [대량 삽입 알고리즘] 하나의 공지사항에 귀속된 다중 첨부파일 목록을 하나의 쿼리로 Bulk Insert 처리합니다.
   * @param {number} noticeId - 부모 공지사항 고유 식별 번호 (FK)
   * @param {Array} attachments - 첨부파일 메타데이터 객체 배열
   */
  insertAttachmentsBulk: async (noticeId, attachments) => {
    if (!attachments || attachments.length === 0) return [];

    // 동적 쿼리 생성을 위해 밸류 플레이스홀더($1, $2...)를 가변 배열 연산으로 전개합니다.
    const fields = ['notice_id', 'filename', 'mime_type', 'storage_type', 'file_url', 'filepath', 'filesize', 'created_at'];
    let queryText = `INSERT INTO notice_attachments (${fields.join(', ')}) VALUES `;
    
    const values = [];
    const valueExpressions = [];

    // 루프 연산을 돌며 다중 행(Multi-row) 파라미터 매핑 인덱스를 연쇄 산출합니다.
    attachments.forEach((file, index) => {
      const offset = index * fields.length;
      valueExpressions.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, now())`);
      
      values.push(
        noticeId,
        file.filename,
        file.mimeType || null,
        file.storageType, // 'drive' 또는 'nas'
        file.storageType === 'drive' ? file.fileUrl : null, // CHECK 제약 조건 연동 상호 배제
        file.storageType === 'nas' ? file.filepath : null,
        file.filesize || null
      );
    });

    queryText += valueExpressions.join(', ') + ' RETURNING id, notice_id, filename, storage_type;';
    
    const { rows } = await db.query(queryText, values);
    return rows;
  },

  /**
   * @function findNoticeDetailAndIncrementView
   * @description [동시성 방어 연산] 공지사항 조회 시 view_count를 원자적으로 즉시 1 증가시키고, 첨부파일 목록을 JOIN하여 반환합니다.
   * @param {number} noticeId - 조회 대상 공지사항 ID (PK)
   */
  findNoticeDetailAndIncrementView: async (noticeId) => {
    // 1. 다중 사용자가 접근할 때의 카운팅 누락(Lost Update)을 원천 차단하기 위해 원자적 UPDATE를 선행 단행합니다.
    const updateQuery = `
      UPDATE notices 
      SET view_count = view_count + 1, updated_at = now() 
      WHERE id = $1
      RETURNING id;
    `;
    const updateResult = await db.query(updateQuery, [noticeId]);
    if (updateResult.rows.length === 0) return null; // 게시글 미존재 시 조기 리턴(404)

    // 2. 마스터 데이터와 N개의 첨부파일 릴레이션을 1:N LEFT JOIN 연산으로 안전하게 병합 조율합니다.
    const selectQuery = `
      SELECT 
        n.id, n.title, n.content, n.category, n.is_pinned, n.view_count, n.created_at, n.updated_at,
        u.name as author_name,
        a.id as attachment_id, a.filename, a.mime_type, a.storage_type, a.file_url, a.filepath, a.filesize
      FROM notices n
      LEFT JOIN users u ON n.author_id = u.id
      LEFT JOIN notice_attachments a ON n.id = a.notice_id
      WHERE n.id = $1;
    `;
    const { rows } = await db.query(selectQuery, [noticeId]);
    return rows; // 데이터 가공(ORM 형태 디코딩)은 컨트롤러 계층에서 전담 수행합니다.
  }
};

module.exports = NoticeModel; // 컨트롤러 레이어에서 트랜잭션 세션으로 묶어 호출할 수 있도록 export합니다.