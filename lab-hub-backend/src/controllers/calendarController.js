/**
 * @file calendarController.js
 * @description 캘린더 도메인의 요청/응답 처리를 담당하는 Controller 레이어입니다.
 *              모든 라우트는 authMiddleware를 통과한 뒤 도달하므로 req.user는 항상 존재한다고 가정합니다.
 *
 * 핵심 정책:
 *  - scope는 분류용 태그이며 접근 권한이 아닙니다. 조회 시 scope로 응답을 필터링하지 않습니다.
 *  - 참여자 목록(participants)은 반드시 연결테이블(calendar_event_participants)을 통해 관리합니다.
 *  - 반복 일정의 회차 수정/삭제는 exceptions 테이블에만 반영하고 마스터 이벤트는 건드리지 않습니다.
 */

const calendarModel = require('../models/calendarModel'); // 캘린더 도메인의 DB 접근을 위임합니다.
const rruleUtils = require('../utils/rrule'); // RRULE 검증 및 UNTIL 편집 유틸리티.
const { success, fail } = require('../utils/response'); // 표준 응답 포맷 헬퍼.

// event_type ENUM 유효값. schema.sql의 CREATE TYPE event_type과 반드시 동기화해야 합니다.
const VALID_EVENT_TYPES = ['meeting', 'deadline', 'event', 'trip', 'other'];

// event_scope ENUM 유효값. 조회 필터에는 사용하지 않으며 INSERT/UPDATE 입력 검증에만 사용합니다.
const VALID_SCOPES = ['shared', 'personal'];

const CalendarController = {
  /**
   * @function createEvent
   * @description POST /api/calendar/events — 신규 이벤트 생성.
   *              created_by는 authMiddleware가 주입한 req.user.id 값을 사용합니다.
   *              body.participants 배열이 오면 연결테이블에 함께 INSERT합니다.
   */
  createEvent: async (req, res, next) => {
    try {
      const {
        title,
        description,
        eventType,
        scope,
        colorKey,
        startDatetime,
        endDatetime,
        isAllDay,
        location,
        isRecurring,
        recurrenceRule,
        participants,
      } = req.body || {};

      // 필수 입력 검증
      if (!title || !eventType || !scope || !startDatetime || !endDatetime) {
        return fail(res, 400, 'Missing required fields (title, eventType, scope, startDatetime, endDatetime).');
      }
      if (!VALID_EVENT_TYPES.includes(eventType)) {
        return fail(res, 400, `Invalid eventType: ${eventType}`);
      }
      if (!VALID_SCOPES.includes(scope)) {
        return fail(res, 400, `Invalid scope: ${scope}`);
      }
      if (new Date(startDatetime) > new Date(endDatetime)) {
        return fail(res, 400, 'startDatetime must be <= endDatetime.');
      }
      // 반복 이벤트에 대해 RRULE 문법을 저장 전에 검증합니다. 오타/잘못된 값은 400으로 즉시 거부.
      if (isRecurring && recurrenceRule && !rruleUtils.isValidRRule(recurrenceRule)) {
        return fail(res, 400, 'Invalid recurrenceRule (RRULE syntax).');
      }

      // 마스터 이벤트 INSERT. created_by는 미들웨어가 주입한 사용자 PK를 그대로 사용합니다.
      const event = await calendarModel.createEvent({
        createdBy: req.user.id,
        title,
        description,
        eventType,
        scope,
        colorKey,
        startDatetime,
        endDatetime,
        isAllDay,
        location,
        isRecurring,
        recurrenceRule,
      });

      // 참여자 배열이 함께 전달되었다면 연결테이블에 한번의 다중값 INSERT로 반영합니다.
      if (Array.isArray(participants) && participants.length > 0) {
        await calendarModel.addParticipants(event.id, participants);
      }
      const participantRows = await calendarModel.getParticipants(event.id);

      return success(res, { ...event, participants: participantRows });
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function listEvents
   * @description GET /api/calendar/events?start=...&end=... — 기간 조회.
   *              반복 이벤트는 마스터 + exceptions를 함께 반환하여 프론트가 rrule.js 등으로 회차를 확장합니다.
   *              모든 일정은 전원 공개이므로 scope 필터는 적용하지 않습니다.
   */
  listEvents: async (req, res, next) => {
    try {
      const { start, end } = req.query;
      if (!start || !end) {
        return fail(res, 400, 'Missing start/end query parameters (ISO 8601 datetime).');
      }

      // scope 필터를 걸지 않는다 — 모든 일정은 전원 공개이며 scope는 프론트 표시용 태그.
      const events = await calendarModel.findEventsInRange(start, end);

      // 목록 조회 시 N+1 방지를 위해 예외 레코드는 한 번의 쿼리로 일괄 조회한 뒤 이벤트별로 그룹핑합니다.
      const eventIds = events.map((ev) => ev.id);
      const allExceptions = await calendarModel.findExceptionsForEventIds(eventIds);
      const exceptionsByEvent = new Map();
      for (const ex of allExceptions) {
        if (!exceptionsByEvent.has(ex.event_id)) exceptionsByEvent.set(ex.event_id, []);
        exceptionsByEvent.get(ex.event_id).push(ex);
      }

      const enriched = events.map((ev) => ({
        ...ev,
        exceptions: exceptionsByEvent.get(ev.id) || [],
      }));

      return success(res, enriched);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function getEvent
   * @description GET /api/calendar/events/:id — 단일 이벤트 상세. 참여자와 예외 목록을 함께 반환합니다.
   */
  getEvent: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid event id.');

      const event = await calendarModel.findEventById(id);
      if (!event) return fail(res, 404, 'Event not found.');

      // 참여자/예외는 독립적으로 조회 가능하므로 병렬 실행하여 지연을 최소화합니다.
      const [participants, exceptions] = await Promise.all([
        calendarModel.getParticipants(id),
        calendarModel.findExceptionsByEventId(id),
      ]);

      return success(res, { ...event, participants, exceptions });
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function updateEvent
   * @description PATCH /api/calendar/events/:id — 이벤트 부분 수정.
   *              patch.participants 배열이 오면 기존 참여자를 전량 삭제한 뒤 재삽입(전체 교체) 방식으로 동기화합니다.
   */
  updateEvent: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid event id.');

      const existing = await calendarModel.findEventById(id);
      if (!existing) return fail(res, 404, 'Event not found.');

      const patch = req.body || {};

      // ENUM/시간 관계 등 최소한의 무결성 검증 수행.
      if (patch.eventType && !VALID_EVENT_TYPES.includes(patch.eventType)) {
        return fail(res, 400, `Invalid eventType: ${patch.eventType}`);
      }
      if (patch.scope && !VALID_SCOPES.includes(patch.scope)) {
        return fail(res, 400, `Invalid scope: ${patch.scope}`);
      }
      const nextStart = patch.startDatetime || existing.start_datetime;
      const nextEnd = patch.endDatetime || existing.end_datetime;
      if (new Date(nextStart) > new Date(nextEnd)) {
        return fail(res, 400, 'startDatetime must be <= endDatetime.');
      }
      // RRULE 문자열이 갱신 대상이면 저장 전에 문법을 검증합니다.
      if (patch.recurrenceRule !== undefined && patch.recurrenceRule && !rruleUtils.isValidRRule(patch.recurrenceRule)) {
        return fail(res, 400, 'Invalid recurrenceRule (RRULE syntax).');
      }

      const updated = await calendarModel.updateEvent(id, patch);

      // 참여자 재설정: patch.participants가 배열이면 전량 교체.
      // patch.participants 자체가 없으면 참여자 목록은 건드리지 않습니다.
      if (Array.isArray(patch.participants)) {
        await calendarModel.removeAllParticipants(id);
        if (patch.participants.length > 0) {
          await calendarModel.addParticipants(id, patch.participants);
        }
      }

      const participants = await calendarModel.getParticipants(id);
      return success(res, { ...updated, participants });
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function deleteEvent
   * @description DELETE /api/calendar/events/:id — 이벤트 삭제.
   *              참여자/예외 테이블은 ON DELETE CASCADE 제약으로 자동 정리됩니다.
   */
  deleteEvent: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid event id.');

      const deleted = await calendarModel.deleteEvent(id);
      if (!deleted) return fail(res, 404, 'Event not found.');

      return success(res, { deleted: true, id: deleted.id });
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function createException
   * @description POST /api/calendar/events/:id/exceptions — 반복 일정의 특정 회차에 대해 예외를 추가/갱신합니다.
   *              동일 (event_id, original_date) 예외가 이미 존재하면 UPSERT로 흡수합니다.
   *              마스터 이벤트는 절대 수정하지 않는다는 설계 원칙을 코드로 강제합니다.
   */
  createException: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid event id.');

      const existing = await calendarModel.findEventById(id);
      if (!existing) return fail(res, 404, 'Event not found.');
      // 마스터가 반복 이벤트가 아닐 경우 예외 처리는 논리적으로 성립하지 않으므로 거부합니다.
      if (!existing.is_recurring) {
        return fail(res, 400, 'Cannot add exception to a non-recurring event.');
      }

      const body = req.body || {};
      if (!body.originalDate) return fail(res, 400, 'Missing originalDate (YYYY-MM-DD).');

      // 부분 업데이트 시맨틱: 요청 본문에 명시된 키만 값을 전달하고, 나머지는 null로 넘겨 모델의 COALESCE가 기존 값을 유지하게 합니다.
      // 이로써 "취소만" 걸어놨다가 나중에 "시간만 조정" 요청이 와도 is_cancelled 등이 리셋되지 않습니다.
      const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
      const exception = await calendarModel.upsertException({
        eventId: id,
        originalDate: body.originalDate,
        isCancelled: has('isCancelled') ? Boolean(body.isCancelled) : null,
        newStart: has('newStart') ? body.newStart : null,
        newEnd: has('newEnd') ? body.newEnd : null,
        newTitle: has('newTitle') ? body.newTitle : null,
      });

      return success(res, exception);
    } catch (err) {
      next(err);
    }
  },

  /**
   * @function splitRecurrence
   * @description POST /api/calendar/events/:id/split — "이번 회차부터 앞으로 계속" 변경을 지원하기 위한 시리즈 분할 헬퍼입니다.
   *              1) 기존 마스터의 RRULE에 UNTIL을 부여하여 옛 시리즈의 종료 시점을 명시하고,
   *              2) 지정된 startDatetime/endDatetime을 첫 회차로 하는 새 반복 이벤트를 생성한 뒤,
   *              3) 참여자를 복사(또는 요청 배열로 대체)합니다.
   *              마스터의 다른 필드(제목/장소 등)는 명시된 것만 새 시리즈에서 오버라이드하고, 나머지는 상속합니다.
   *
   * Body:
   *   - untilDatetime (필수, ISO): 옛 시리즈의 RRULE UNTIL로 저장할 시각
   *   - startDatetime (필수, ISO): 새 시리즈 첫 회차 시작
   *   - endDatetime   (필수, ISO): 새 시리즈 첫 회차 종료
   *   - title, description, colorKey, location, isAllDay, recurrenceRule, participants (선택)
   */
  splitRecurrence: async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Invalid event id.');

      const existing = await calendarModel.findEventById(id);
      if (!existing) return fail(res, 404, 'Event not found.');
      if (!existing.is_recurring) return fail(res, 400, 'Can only split a recurring event.');
      if (!existing.recurrence_rule) return fail(res, 400, 'Master event has no recurrence rule to split.');

      const body = req.body || {};
      const { untilDatetime, startDatetime, endDatetime } = body;
      if (!untilDatetime || !startDatetime || !endDatetime) {
        return fail(res, 400, 'Missing required fields (untilDatetime, startDatetime, endDatetime).');
      }
      if (new Date(startDatetime) > new Date(endDatetime)) {
        return fail(res, 400, 'startDatetime must be <= endDatetime.');
      }

      // 새 시리즈의 RRULE 결정: 명시되면 검증 후 사용, 미명시면 기존 패턴에서 UNTIL/COUNT만 벗겨 재사용.
      let newRuleString;
      if (body.recurrenceRule !== undefined) {
        if (body.recurrenceRule && !rruleUtils.isValidRRule(body.recurrenceRule)) {
          return fail(res, 400, 'Invalid recurrenceRule (RRULE syntax).');
        }
        newRuleString = body.recurrenceRule || null;
      } else {
        newRuleString = rruleUtils.stripEnd(existing.recurrence_rule);
      }

      // 1) 옛 시리즈 종료: 기존 마스터 RRULE에 UNTIL을 부여하여 갱신합니다. 마스터의 다른 컬럼은 건드리지 않습니다.
      const oldRuleWithUntil = rruleUtils.setUntil(existing.recurrence_rule, new Date(untilDatetime));
      await calendarModel.updateEvent(id, { recurrenceRule: oldRuleWithUntil });

      // 2) 새 시리즈 생성: 명시된 필드는 오버라이드, 미명시 필드는 마스터 값을 상속합니다.
      const inherit = (key, existingValue) =>
        Object.prototype.hasOwnProperty.call(body, key) ? body[key] : existingValue;

      const newEvent = await calendarModel.createEvent({
        createdBy: req.user.id,
        title: inherit('title', existing.title),
        description: inherit('description', existing.description),
        eventType: existing.event_type,
        scope: existing.scope,
        colorKey: inherit('colorKey', existing.color_key),
        startDatetime,
        endDatetime,
        isAllDay: inherit('isAllDay', existing.is_all_day),
        location: inherit('location', existing.location),
        isRecurring: true,
        recurrenceRule: newRuleString,
      });

      // 3) 참여자 처리: 배열이 명시되면 그것으로, 아니면 마스터 참여자를 그대로 복사합니다.
      let participantIds;
      if (Array.isArray(body.participants)) {
        participantIds = body.participants;
      } else {
        const masterRows = await calendarModel.getParticipants(id);
        participantIds = masterRows.map((r) => r.user_id);
      }
      if (participantIds.length > 0) {
        await calendarModel.addParticipants(newEvent.id, participantIds);
      }

      // 4) 응답: 갱신된 마스터와 새 시리즈를 참여자 목록과 함께 반환합니다.
      const [masterAfter, masterParticipants, newParticipants] = await Promise.all([
        calendarModel.findEventById(id),
        calendarModel.getParticipants(id),
        calendarModel.getParticipants(newEvent.id),
      ]);

      return success(res, {
        master: { ...masterAfter, participants: masterParticipants },
        newEvent: { ...newEvent, participants: newParticipants },
      });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = CalendarController;
