/**
 * @file applicationController.js
<<<<<<< HEAD
 * @description 연구생 지원서 서식 벨리데이션 검증 및 등급별 심사 워크플로우를 통제하는 컨트롤러 레이어입니다.
 */

const ApplicationModel = require('../models/applicationModel');
const response = require('../utils/response'); // 팀 표준 공통 응답 유틸 연동
=======
 * @description 연구생 지원 도메인의 요청/응답 처리를 담당하는 Controller 레이어입니다.
 *
 * 핵심 정책:
 *  - submit(POST /api/public/applications): 인증 없이 공개된 지원자용 엔드포인트.
 *    → privacy_consent=true 강제, 이메일 형식/필수 필드/길이 검증, 이메일+target_term 중복 방지.
 *    → 응답에는 민감/내부 상태 절대 노출 금지. 접수 확인용 최소 페이로드만 반환.
 *  - list/getOne/update/remove: authMiddleware + requireRole(manager/admin) 보호. internal_memo 포함 가능.
 *  - internal_memo가 공개 응답에 새어나가지 않도록 submit 흐름은 응답 페이로드를 명시적으로 축소합니다.
 */

const applicationModel = require('../models/applicationModel'); // 지원 서류 도메인 DB 접근을 위임합니다.
const { success, fail } = require('../utils/response'); // 표준 응답 포맷 헬퍼.

// recruit_status ENUM 유효값. schema.sql의 CREATE TYPE recruit_status와 동기화해야 합니다.
const VALID_STATUSES = ['pending', 'reviewing', 'accepted', 'rejected'];

// RFC 5322 완전 준수는 과잉 검증이므로 실무에서 흔한 간이 형식(로컬@도메인.TLD)만 검증합니다.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 입력 길이 상한. DB 컬럼 크기(VARCHAR(100), TEXT) 및 UX 관점 상한선을 함께 반영합니다.
const NAME_MAX = 100;
const EMAIL_MAX = 255;
const TARGET_TERM_MAX = 50;
const INTRODUCTION_MAX = 5000;
const INTEREST_AREA_MAX = 2000;
>>>>>>> 4f6aecfa4d2c753ff8dc339628b5ec59389d9dc7

const ApplicationController = {
  /**
   * @function submitApplication
<<<<<<< HEAD
   * @description [인증 유저] 입단 필수 인적사항 및 하이브리드 증빙 경로를 필터링하여 지원서를 상신합니다.
   */
  submitApplication: async (req, res) => {
    try {
      const { studentName, studentId, email, introduction, portfolioUrl, attachedFilepath } = req.body;

      // [알고리즘 1단계] 필수 입력 항목 유효성 검증
      if (!studentName || !studentId || !email || !introduction) {
        return response.error(res, '지원자 성명, 학번, 이메일 및 자기소개 항목은 필수입니다.', 400);
      }

      // [알고리즘 2단계] 이메일 형식 무결성 검사 (Regex 가동)
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return response.error(res, '올바르지 않은 이메일 주소 포맷입니다.', 400);
      }

      // [알고리즘 3단계] 영속성 모델 레이어 호출 및 적재
      const application = await ApplicationModel.createApplication({
        studentName,
        studentId,
        email,
        introduction,
        portfolioUrl: portfolioUrl || null,
        attachedFilepath: attachedFilepath || null
      });

      return response.success(res, '연구실 입단 지원서가 성공적으로 접수되었습니다.', { application }, 201);

    } catch (error) {
      console.error('연구생 지원서 제출 중 서버 예외 에러:', error);
      return response.error(res, '서버 오류로 지원서 제출에 실패했습니다.', 500);
=======
   * @description POST /api/public/applications — 공개 지원 폼 제출(인증 불필요).
   *              privacy_consent=true 필수, 이메일 형식/필수 필드/길이 검증, 이메일+target_term 중복 방지 후 저장합니다.
   *              성공 응답은 접수번호(id) + 초기 상태만 반환하여 내부 상태/메모가 외부로 노출되지 않도록 합니다.
   */
  submitApplication: async (req, res, next) => {
    try {
      const {
        targetTerm, name, email, phone, studentId, department, grade,
        interestArea, introduction, githubUrl, portfolioUrl, privacyConsent,
      } = req.body || {};

      // ---- 필수 필드 존재 검증 ----
      if (!targetTerm || !name || !email) {
        return fail(res, 400, 'Missing required fields (targetTerm, name, email).');
      }

      // ---- 타입/길이 검증 ----
      if (typeof targetTerm !== 'string' || targetTerm.length === 0 || targetTerm.length > TARGET_TERM_MAX) {
        return fail(res, 400, `targetTerm must be 1-${TARGET_TERM_MAX} characters.`);
      }
      if (typeof name !== 'string' || name.length === 0 || name.length > NAME_MAX) {
        return fail(res, 400, `name must be 1-${NAME_MAX} characters.`);
      }
      if (typeof email !== 'string' || email.length > EMAIL_MAX || !EMAIL_REGEX.test(email)) {
        return fail(res, 400, 'email format is invalid.');
      }
      if (
        introduction !== undefined && introduction !== null &&
        (typeof introduction !== 'string' || introduction.length > INTRODUCTION_MAX)
      ) {
        return fail(res, 400, `introduction must be a string <= ${INTRODUCTION_MAX} characters.`);
      }
      if (
        interestArea !== undefined && interestArea !== null &&
        (typeof interestArea !== 'string' || interestArea.length > INTEREST_AREA_MAX)
      ) {
        return fail(res, 400, `interestArea must be a string <= ${INTEREST_AREA_MAX} characters.`);
      }

      // ---- 개인정보 동의 강제 (DB CHECK 제약과 이중 방어) ----
      if (privacyConsent !== true) {
        return fail(res, 400, 'privacyConsent must be true to submit an application.');
      }

      // ---- 중복 제출 방지 (같은 email + target_term 조합) ----
      const dup = await applicationModel.findByEmailAndTerm(email, targetTerm);
      if (dup) {
        return fail(res, 409, 'An application with this email already exists for the target term.');
      }

      // Model.create 내부에서 privacy_consent=true, consent_at=now()가 자동 세팅됩니다.
      const created = await applicationModel.create({
        targetTerm, name, email, phone, studentId, department, grade,
        interestArea, introduction, githubUrl, portfolioUrl,
      });

      // 공개 응답: 민감정보/내부 상태 노출 금지. 접수 확인용 최소 페이로드만 반환합니다.
      return success(
        res,
        { id: created.id, status: created.status },
        'Application received.',
        201
      );
    } catch (err) {
      next(err);
>>>>>>> 4f6aecfa4d2c753ff8dc339628b5ec59389d9dc7
    }
  },

  /**
<<<<<<< HEAD
   * @function reviewApplication
   * @description [관리자 전용] 접수된 지원서를 심사하여 최종 합격(approved) 또는 불합격(rejected)을 확정합니다.
   */
  reviewApplication: async (req, res) => {
    try {
      const appId = req.params.id;
      const reviewerId = req.user.id; // 결재를 단행한 관리자 고유 ID
      const { status, rejectReason } = req.body; // 'approved' 또는 'rejected'

      // 1. 필수 상태 파라미터 제약 확인
      if (!status || !['approved', 'rejected'].includes(status)) {
        return response.error(res, '올바른 심사 결과 상태값(approved/rejected)을 입력해 주세요.', 400);
      }

      // 2. 해당 지원서의 실존 및 결재 대기(pending) 상태 검증
      const application = await ApplicationModel.findApplicationById(appId);
      if (!application) {
        return response.error(res, '존재하지 않는 연구생 입단 지원 서류입니다.', 404);
      }

      if (application.status !== 'pending') {
        return response.error(res, '이미 심사 판정이 종결된 지원서입니다.', 400);
      }

      // 3. 모델 레이어를 호출하여 심사 상태 업데이트 원자적 반영
      const result = await ApplicationModel.updateApplicationStatus(appId, status, rejectReason || null, reviewerId);
      
      const outcomeMessage = status === 'approved'
        ? `[${result.student_name}] 지원자의 입단 신청을 최종 승인(합격) 처리했습니다.`
        : `[${result.student_name}] 지원자의 입단 신청을 반려(불합격) 처리했습니다.`;

      return response.success(res, outcomeMessage, { result }, 200);

    } catch (error) {
      console.error('연구생 지원 심사 처리 중 서버 예외 에러:', error);
      return response.error(res, '서버 오류로 지원 심사 처리에 실패했습니다.', 500);
    }
  }
};

module.exports = ApplicationController;
=======
   * @function listApplications
   * @description GET /api/applications — 관리자용 지원자 목록 조회.
   *              status, targetTerm, isRead 필터를 지원하며 internal_memo를 포함해 반환합니다.
   *              라우터 레이어에서 authMiddleware + requireRole('manager','admin')가 선행 적용됩니다.
   */
  listApplications: async (req, res, next) => {
    try {
      const { status, targetTerm } = req.query;

      let isRead;
      if (req.query.isRead === 'true') isRead = true;
      else if (req.query.isRead === 'false') isRead = false;

      if (status && !VALID_STATUSES.includes(status)) {
        return fail(res, 400, `Invalid status filter: ${status}`);
      }

      const rows = await applicationModel.findAll({ status, targetTerm, isRead });
      return success(res, rows);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function getApplication
   * @description GET /api/applications/:id — 관리자용 단건 상세.
   *              최초 열람 시 is_read=false → true로 원자적으로 갱신합니다(감사/UX 목적).
   *              이미 읽음 상태인 경우 markRead는 undefined를 반환하므로 기존 row를 그대로 사용합니다.
   */
  getApplication: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid application id.');

      let row = await applicationModel.findById(id);
      if (!row) return fail(res, 404, 'Application not found.');

      if (!row.is_read) {
        const updated = await applicationModel.markRead(id);
        if (updated) row = updated;
      }

      return success(res, row);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function updateApplication
   * @description PATCH /api/applications/:id — 상태 변경/내부 메모 수정.
   *              status 또는 internalMemo가 patch에 포함되면 reviewed_by를 req.user.id로 함께 갱신합니다.
   *              공개 폼 필드(name/email/phone 등)는 이 흐름에서 절대 변경되지 않습니다(Model 화이트리스트).
   */
  updateApplication: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid application id.');

      const existing = await applicationModel.findById(id);
      if (!existing) return fail(res, 404, 'Application not found.');

      const { status, internalMemo, isRead } = req.body || {};

      if (status !== undefined && !VALID_STATUSES.includes(status)) {
        return fail(res, 400, `Invalid status: ${status}`);
      }

      const patch = {};
      if (status !== undefined) patch.status = status;
      if (internalMemo !== undefined) patch.internalMemo = internalMemo;
      if (typeof isRead === 'boolean') patch.isRead = isRead;

      // 심사 관련 변경(status/internalMemo)이 있으면 검토자를 요청자로 갱신합니다.
      if (status !== undefined || internalMemo !== undefined) {
        patch.reviewedBy = req.user.id;
      }

      const updated = await applicationModel.update(id, patch);
      return success(res, updated);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function deleteApplication
   * @description DELETE /api/applications/:id — 지원 서류 완전 삭제.
   *              recruit_application_attachments는 ON DELETE CASCADE이므로 첨부도 함께 정리됩니다.
   */
  deleteApplication: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid application id.');

      const deleted = await applicationModel.remove(id);
      if (!deleted) return fail(res, 404, 'Application not found.');

      return success(res, { deleted: true, id: deleted.id });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = ApplicationController;
>>>>>>> 4f6aecfa4d2c753ff8dc339628b5ec59389d9dc7
