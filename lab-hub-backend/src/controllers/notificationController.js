/**
 * @file notificationController.js
 * @description 알림 목록 열람 제어 및 등급별/카테고리별 알림 포맷터 조율을 담당하는 비즈니스 컨트롤러 레이어입니다.
 */

const NotificationModel = require('../models/notificationModel');
const response = require('../utils/response'); // 팀 표준 공통 응답 유틸 연동

const NotificationController = {
  /**
   * @function getMyNotifications
   * @description [인증 유저] 현재 세션 토큰의 소유자에게 귀속된 모든 알림 센터 내역을 조회하여 반환합니다.
   */
  getMyNotifications: async (req, res) => {
    try {
      const userId = req.user.id; // 토큰 인증 미들웨어 레이어에서 파싱된 고유 식별자

      const credentials = await NotificationModel.findByUserId(userId);
      return response.success(res, '개인 알림 센터 내역 조회가 정상 완료되었습니다.', { notifications: credentials }, 200);
    } catch (error) {
      console.error('알림 목록 조회 중 서버 내부 런타임 에러:', error);
      return response.error(res, '서버 오류로 알림 리스트를 열람하지 못했습니다.', 500);
    }
  },

  /**
   * @function readNotification
   * @description [인증 유저] 특정 단건 알림에 대해 읽음(is_read = true) 플래그를 동기화 반영합니다.
   */
  readNotification: async (req, res) => {
    try {
      const notiId = req.params.id;
      const userId = req.user.id;

      const result = await NotificationModel.markAsRead(notiId, userId);
      
      // 타인의 알림을 위조 조작하려 하거나 이미 유실된 행일 경우 404 예외 필터링을 단행합니다.
      if (!result) {
        return response.error(res, '조회 대상 알림이 실존하지 않거나 본인 계정 자산이 아닙니다.', 404);
      }

      return response.success(res, '해당 시스템 알림을 읽음 처리 완료했습니다.', { result }, 200);
    } catch (error) {
      console.error('단건 알림 읽음 처리 중 서버 예외 에러:', error);
      return response.error(res, '서버 오류로 알림 읽음 플래그 갱신에 실패했습니다.', 500);
    }
  },

  /**
   * @function readAllNotifications
   * @description [인증 유저] 자신에게 귀속된 모든 미읽음 시스템 알림을 일괄적으로 읽음 확정 상태로 변환합니다.
   */
  readAllNotifications: async (req, res) => {
    try {
      const userId = req.user.id;

      await NotificationModel.markAllAsRead(userId);
      return response.success(res, '미읽음 상태의 모든 시스템 알림이 일괄 읽음 처리 완료되었습니다.', null, 200);
    } catch (error) {
      console.error('전체 알림 일괄 읽음 처리 중 서버 예외 에러:', error);
      return response.error(res, '서버 오류로 알림 일괄 갱신 조치에 실패했습니다.', 500);
    }
  }
};

module.exports = NotificationController;