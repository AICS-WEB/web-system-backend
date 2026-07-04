/**
 * @file notificationController.js
 * @description 시스템 알림 도메인의 요청/응답 처리를 담당하는 Controller 레이어입니다.
 *              모든 라우트는 authMiddleware 이후 도달하므로 req.user는 항상 존재합니다.
 *
 * 핵심 정책:
 *  - 목록/읽음 처리는 항상 req.user.id 기준(자기 자신의 알림만 다룸). 타인의 알림 접근은 원천 차단.
 *  - createNotification은 시스템 내부 이벤트 발신용이므로 HTTP 엔드포인트는 admin/manager 전용으로만 제한.
 *    (일반 도메인 컨트롤러는 model.createNotification을 직접 호출)
 *  - 소유권 검증은 SQL의 WHERE 절(user_id = $2)로 수행 — 애플리케이션 계층 조건문 누락 위험을 배제.
 */

const notificationModel = require('../models/notificationModel'); // 알림 도메인 DB 접근을 위임합니다.
const { success, fail } = require('../utils/response'); // 표준 응답 포맷 헬퍼.

// notification_type ENUM 유효값. schema.sql의 CREATE TYPE notification_type과 동기화해야 합니다.
const VALID_TYPES = [
  'leave_requested', 'leave_approved', 'leave_rejected',
  'purchase_requested', 'purchase_approved', 'purchase_rejected', 'purchase_delivered',
  'notice_created', 'recruit_received',
  'signup_requested', 'signup_approved', 'general',
];

// 입력 길이 상한 — DB 컬럼(VARCHAR(200) / TEXT) 및 UX 관점 상한선을 함께 반영합니다.
const TITLE_MAX = 200;
const MESSAGE_MAX = 5000;

const NotificationController = {
  /**
   * @function listMyNotifications
   * @description GET /api/notifications — 로그인한 사용자의 알림 목록을 최신순으로 반환합니다.
   *              ?isRead=true|false 쿼리로 읽음 상태 필터링을 지원합니다.
   */
  listMyNotifications: async (req, res, next) => {
    try {
      let isRead;
      if (req.query.isRead === 'true') isRead = true;
      else if (req.query.isRead === 'false') isRead = false;

      const rows = await notificationModel.findByUserId(req.user.id, { isRead });
      return success(res, rows);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function getUnreadCount
   * @description GET /api/notifications/unread-count — 미읽음 알림 개수만 반환합니다.
   *              헤더의 알림 뱃지 카운터 등 목록 전체를 로드할 필요 없는 UX에서 활용합니다.
   */
  getUnreadCount: async (req, res, next) => {
    try {
      const unreadCount = await notificationModel.countUnread(req.user.id);
      return success(res, { unreadCount });
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function createNotification
   * @description POST /api/notifications — 특정 사용자에게 알림을 발송합니다.
   *              관리자 전용 브로드캐스트/공지 발송 용도이며, 일반 시스템 이벤트 알림은
   *              각 도메인 컨트롤러가 model.createNotification을 직접 호출하는 방식으로 처리합니다.
   */
  createNotification: async (req, res, next) => {
    try {
      const { userId, type, title, message, relatedType, relatedId } = req.body || {};

      if (!userId || !type || !title || !message) {
        return fail(res, 400, 'Missing required fields (userId, type, title, message).');
      }
      if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) {
        return fail(res, 400, 'userId must be a positive integer.');
      }
      if (!VALID_TYPES.includes(type)) {
        return fail(res, 400, `Invalid type: ${type}`);
      }
      if (typeof title !== 'string' || title.length === 0 || title.length > TITLE_MAX) {
        return fail(res, 400, `title must be 1-${TITLE_MAX} characters.`);
      }
      if (typeof message !== 'string' || message.length === 0 || message.length > MESSAGE_MAX) {
        return fail(res, 400, `message must be 1-${MESSAGE_MAX} characters.`);
      }
      if (relatedId !== undefined && relatedId !== null && !Number.isInteger(Number(relatedId))) {
        return fail(res, 400, 'relatedId must be an integer when provided.');
      }

      const created = await notificationModel.createNotification({
        userId: Number(userId),
        type,
        title,
        message,
        relatedType,
        relatedId: relatedId === undefined || relatedId === null ? null : Number(relatedId),
      });

      return success(res, created, null, 201);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function markAsRead
   * @description PATCH /api/notifications/:id/read — 알림 단건 읽음 처리.
   *              소유권 검증은 Model의 WHERE(user_id = $2)에서 처리되어 타인의 알림에는 영향이 없습니다.
   *              이미 읽음 상태이거나 소유자가 아니면 404(대상 없음)로 응답합니다.
   */
  markAsRead: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid notification id.');

      const updated = await notificationModel.markAsRead(id, req.user.id);
      if (!updated) {
        // 미존재 · 소유자 불일치 · 이미 읽음 상태 → 어느 쪽이든 클라이언트 관점에서는 "대상 없음"으로 통일
        return fail(res, 404, 'Notification not found or already read.');
      }

      return success(res, updated);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function markAllAsRead
   * @description PATCH /api/notifications/read-all — 로그인 사용자의 미읽음 알림 전부를 읽음 처리하고,
   *              갱신된 개수를 응답합니다.
   */
  markAllAsRead: async (req, res, next) => {
    try {
      const updatedCount = await notificationModel.markAllAsRead(req.user.id);
      return success(res, { updatedCount });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = NotificationController;
