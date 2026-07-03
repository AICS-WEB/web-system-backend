/**
 * @file applicationController.js
 * @description 연구생 지원서 서식 벨리데이션 검증 및 등급별 심사 워크플로우를 통제하는 컨트롤러 레이어입니다.
 */

const ApplicationModel = require('../models/applicationModel');
const response = require('../utils/response'); // 팀 표준 공통 응답 유틸 연동

const ApplicationController = {
  /**
   * @function submitApplication
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
    }
  },

  /**
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