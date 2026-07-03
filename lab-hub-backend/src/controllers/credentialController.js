/**
 * @file credentialController.js
 * @description 공용 비밀번호 자산 조회 및 권한별 쓰기/수정/삭제 비즈니스 로직을 통제하는 컨트롤러 레이어입니다.
 */

const CredentialModel = require('../models/credentialModel');
const response = require('../utils/response'); // 팀 표준 공통 응답 유틸 연동

const CredentialController = {
  /**
   * @function getAllCredentials
   * @description [인증 유저] 연구실 승인원 전체에게 공용 계정 및 패스워드 장부 목록을 개방 조회합니다.
   */
  getAllCredentials: async (req, res) => {
    try {
      const credentials = await CredentialModel.findAllCredentials();
      return response.success(res, '연구실 공용 계정 및 비밀번호 자산 목록 조회가 완료되었습니다.', { credentials }, 200);
    } catch (error) {
      console.error('공용 계정 조회 중 서버 예외 에러:', error);
      return response.error(res, '서버 오류로 공용 계정 목록을 조회하지 못했습니다.', 500);
    }
  },

  /**
   * @function addCredential
   * @description [관리자 전용] 필수 서식 파라미터를 유효성 검사한 뒤 신규 공용 크레덴셜 자산을 등록합니다.
   */
  addCredential: async (req, res) => {
    try {
      const { platformName, accountId, passwordText, description } = req.body;

      // [알고리즘 1단계] 필수 입력 항목 필터링
      if (!platformName || !accountId || !passwordText) {
        return response.error(res, '플랫폼명, 계정 ID, 비밀번호 문장 정보는 필수 입력 항목입니다.', 400);
      }

      // [알고리즘 2단계] 영속성 모델 레이어 호출
      const credential = await CredentialModel.createCredential({
        platformName,
        accountId,
        passwordText,
        description: description || null
      });

      return response.success(res, '신규 공용 계정 자산이 성공적으로 등록되었습니다.', { credential }, 201);
    } catch (error) {
      console.error('공용 계정 등록 중 서버 예외 에러:', error);
      return response.error(res, '서버 오류로 공용 계정 등록에 실패했습니다.', 500);
    }
  },

  /**
   * @function modifyCredential
   * @description [관리자 전용] 지정한 ID의 공용 크레덴셜 레코드 존재 여부를 판별한 후 내용을 수정합니다.
   */
  modifyCredential: async (req, res) => {
    try {
      const { id } = req.params;
      const { platformName, accountId, passwordText, description } = req.body;

      if (!platformName || !accountId || !passwordText) {
        return response.error(res, '수정할 플랫폼명, 계정 ID, 비밀번호는 필수입니다.', 400);
      }

      const existing = await CredentialModel.findCredentialById(id);
      if (!existing) {
        return response.error(res, '존재하지 않거나 이미 폐기된 공용 계정 자산입니다.', 404);
      }

      const updated = await CredentialModel.updateCredential(id, {
        platformName, accountId, passwordText, description: description || null
      });

      return response.success(res, '공용 계정 정보가 무결하게 수정 업데이트되었습니다.', { credential: updated }, 200);
    } catch (error) {
      console.error('공용 계정 수정 중 서버 예외 에러:', error);
      return response.error(res, '서버 오류로 공용 계정 수정에 실패했습니다.', 500);
    }
  },

  /**
   * @function removeCredential
   * @description [관리자 전용] 특정 공용 계정 레코드를 장부에서 영구 격리 삭제합니다.
   */
  removeCredential: async (req, res) => {
    try {
      const { id } = req.params;

      const existing = await CredentialModel.findCredentialById(id);
      if (!existing) {
        return response.error(res, '존재하지 않거나 이미 삭제된 공용 계정 자산입니다.', 404);
      }

      await CredentialModel.deleteCredential(id);
      return response.success(res, '선택하신 연구실 공용 계정 자산이 장부에서 영구 삭제되었습니다.', null, 200);
    } catch (error) {
      console.error('공용 계정 삭제 중 서버 예외 에러:', error);
      return response.error(res, '서버 오류로 공용 계정 삭제에 실패했습니다.', 500);
    }
  }
};

module.exports = CredentialController;