/**
 * @file noticeController.js
 * @description 공지사항 작성 시 하이브리드 스토리지 규격을 검증하고, 상세 조회 시 데이터를 포맷팅하는 컨트롤러 레이어입니다.
 */

const NoticeModel = require('../models/noticeModel');
const { success, fail } = require('../utils/response'); // 팀 표준 공통 응답 유틸 (success/fail)
const db = require('../config/db'); // 트랜잭션 BEGIN/COMMIT 제어용 DB 풀 로드

const NoticeController = {
  /**
   * @function createNotice
   * @description [관리자 전용] 공지사항 마스터를 생성하고, 첨부파일 스토리지 무결성을 검사한 뒤 Bulk Insert를 수행합니다. (트랜잭션 적용)
   */
  createNotice: async (req, res) => {
    // 트랜잭션 처리를 위해 풀에서 클라이언트를 독립적으로 대여합니다.
    const client = await db.connect();

    try {
      const authorId = req.user.id; // 토큰 인증 미들웨어에서 추출된 작성자 ID
      const { title, content, category, isPinned, attachments } = req.body;

      // [알고리즘 1단계] 필수 마스터 파라미터 유효성 검증
      if (!title || !content || !category) {
        return fail(res, 400, '공지사항 제목, 본문 및 카테고리는 필수 입력 항목입니다.');
      }

      // 명세서 ENUM 제약 조건 기출 대조 ('general', 'important', 'account_info', 'schedule')
      const allowedCategories = ['general', 'important', 'account_info', 'schedule'];
      if (!allowedCategories.includes(category)) {
        return fail(res, 400, '올바르지 않은 공지사항 카테고리 설정입니다.');
      }

      // [알고리즘 2단계] 하이브리드 스토리지 상호 배제 유효성 검증 (DB CHECK 제약 조건 시뮬레이션)
      if (attachments && attachments.length > 0) {
        for (const file of attachments) {
          if (!file.filename || !file.storageType) {
            return fail(res, 400, '첨부파일의 파일명 및 스토리지 타입(drive/nas)은 필수입니다.');
          }

          if (!['drive', 'nas'].includes(file.storageType)) {
            return fail(res, 400, '스토리지 타입은 drive 또는 nas만 허용됩니다.');
          }

          // 구글 드라이브 형태인데 링크가 누락되었거나, NAS 형태인데 절대경로가 누락된 경우를 하드 블록합니다.
          if (file.storageType === 'drive' && !file.fileUrl) {
            return fail(res, 400, '클라우드 드라이브(drive) 저장 방식은 fileUrl이 필수입니다.');
          }
          if (file.storageType === 'nas' && !file.filepath) {
            return fail(res, 400, '자체 스토리지(nas) 저장 방식은 filepath가 필수입니다.');
          }
        }
      }

      // [알고리즘 3단계] 데이터베이스 트랜잭션 가동 (All-or-Nothing 무결성 확보)
      await client.query('BEGIN');

      // 1. 공지사항 부모 레코드 삽입
      const notice = await NoticeModel.createNotice({
        authorId,
        title,
        content,
        category,
        isPinned: isPinned || false
      });

      // 2. 첨부파일이 존재할 경우 대량 삽입(Bulk Insert) 연동
      let savedAttachments = [];
      if (attachments && attachments.length > 0) {
        savedAttachments = await NoticeModel.insertAttachmentsBulk(notice.id, attachments);
      }

      // 예외 없이 도달 시 데이터베이스 최종 커밋 단행
      await client.query('COMMIT');

      return success(
        res,
        { notice, attachments: savedAttachments },
        '공지사항 및 첨부파일 메타데이터가 무결하게 등록되었습니다.',
        201
      );

    } catch (error) {
      // 트랜잭션 파이프라인 내부 예외 발생 시 전면 롤백하여 고스트 데이터 적재를 방어합니다.
      await client.query('ROLLBACK');
      console.error('공지사항 작성 중 트랜잭션 에러 발생:', error);
      return fail(res, 500, '서버 오류로 공지사항 등록에 실패했습니다.');
    } finally {
      // 대여한 커넥션 객체를 자원 회수를 위해 풀에 안전하게 반환합니다.
      client.release();
    }
  },

  /**
   * @function getNoticeDetail
   * @description [인증 유저] 특정 공지사항을 상세 조회하며 원자적으로 조회수를 올리고, JOIN된 로우 배열을 단건 DTO 객체로 가공 반환합니다.
   */
  getNoticeDetail: async (req, res) => {
    try {
      const noticeId = req.params.id;

      // 모델 레이어의 원자적 증가 및 LEFT JOIN 병합 질의 수행
      const rows = await NoticeModel.findNoticeDetailAndIncrementView(noticeId);

      if (!rows || rows.length === 0) {
        return fail(res, 404, '존재하지 않거나 삭제된 공지사항 게시글입니다.');
      }

      // [알고리즘 1단계] 조인 결과로 생성된 N개의 중복 마스터 로우를 단건 데이터 객체(DTO)로 포맷팅 정제합니다.
      const firstRow = rows[0];
      const noticeDetail = {
        id: firstRow.id,
        title: firstRow.title,
        content: firstRow.content,
        category: firstRow.category,
        isPinned: firstRow.is_pinned,
        viewCount: firstRow.view_count,
        authorName: firstRow.author_name,
        createdAt: firstRow.created_at,
        updatedAt: firstRow.updated_at,
        attachments: [] // 첨부파일 오브젝트 배열 서브 그룹 초기화
      };

      // [알고리즘 2단계] LEFT JOIN 연산 특성에 따라 널(NULL) 행 유무를 분기하여 배열 매핑을 완성합니다.
      rows.forEach(row => {
        if (row.attachment_id) {
          noticeDetail.attachments.push({
            id: row.attachment_id,
            filename: row.filename,
            mimeType: row.mime_type,
            storageType: row.storage_type,
            fileUrl: row.file_url,
            filepath: row.filepath,
            filesize: row.filesize
          });
        }
      });

      return success(res, { notice: noticeDetail }, '공지사항 상세 데이터 및 첨부파일 조회가 완료되었습니다.');

    } catch (error) {
      console.error('공지사항 상세 조회 중 예외 에러 발생:', error);
      return fail(res, 500, '서버 오류로 공지사항을 조회하지 못했습니다.');
    }
  }
};

module.exports = NoticeController;
