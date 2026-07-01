/**
 * @file calendarModel.js
 * @description 캘린더 도메인의 데이터 액세스 레이어. calendar_events(마스터 이벤트),
 *              calendar_event_participants(참여자 N:M 연결테이블), calendar_event_exceptions(반복 회차 예외) 세 테이블에 대한 쿼리를 제공합니다.
 *
 * 설계 원칙:
 *  - 모든 일정은 전원 공개. scope('shared'/'personal')는 분류용 태그이므로 SELECT 시 절대 필터 조건에 사용하지 않습니다.
 *  - 참여자는 반드시 연결테이블로 관리합니다(콤마 문자열 저장 금지).
 *  - 반복 일정의 회차 수정/삭제는 마스터 이벤트를 건드리지 않고 exceptions 테이블에 예외 레코드로만 반영합니다.
 */

const db = require('../config/db'); // PostgreSQL 커넥션 풀 모듈을 불러옵니다.

const CalendarModel = {
  // ============================================================
  //  Event (calendar_events)
  // ============================================================

  /**
   * @function createEvent
   * @description 새로운 마스터 캘린더 이벤트를 삽입합니다. created_by는 SET NULL 정책이므로 미지정 시 NULL 저장을 허용합니다.
   * @param {Object} params - camelCase로 정규화된 이벤트 필드들
   * @returns {Object} 삽입된 이벤트 레코드 (RETURNING *)
   */
  createEvent: async ({
    createdBy,
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
  }) => {
    const queryText = `
      INSERT INTO calendar_events (
        created_by, title, description, event_type, scope, color_key,
        start_datetime, end_datetime, is_all_day, location, is_recurring, recurrence_rule
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `;
    const values = [
      createdBy || null,
      title,
      description || null,
      eventType,
      scope,
      colorKey || null,
      startDatetime,
      endDatetime,
      isAllDay === true,
      location || null,
      isRecurring === true,
      recurrenceRule || null,
    ];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function findEventById
   * @description 단일 이벤트를 PK로 조회합니다. 참여자/예외는 별도 함수에서 조회하여 결합합니다.
   * @param {number} id - calendar_events.id
   * @returns {Object|undefined}
   */
  findEventById: async (id) => {
    const queryText = `SELECT * FROM calendar_events WHERE id = $1;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  /**
   * @function findEventsInRange
   * @description 지정 기간과 겹치는 이벤트를 조회합니다.
   *              - 비반복 이벤트: [start_datetime, end_datetime] 구간이 [start, end]와 겹치는 것.
   *              - 반복 이벤트: 마스터 시작이 end 이전이면 모두 포함하여 프론트의 RRULE 확장 계산에 위임합니다.
   *              scope 필터링은 의도적으로 수행하지 않습니다(모든 일정은 전원 공개).
   * @param {string} startIso - 조회 시작 시각 (ISO 8601)
   * @param {string} endIso - 조회 종료 시각 (ISO 8601)
   * @returns {Array<Object>} 이벤트 레코드 배열
   */
  findEventsInRange: async (startIso, endIso) => {
    const queryText = `
      SELECT *
        FROM calendar_events
       WHERE (
              is_recurring = false
              AND start_datetime < $2
              AND end_datetime   > $1
             )
          OR (
              is_recurring = true
              AND start_datetime <= $2
             )
       ORDER BY start_datetime ASC;
    `;
    const { rows } = await db.query(queryText, [startIso, endIso]);
    return rows;
  },

  /**
   * @function updateEvent
   * @description 부분 업데이트(PATCH)를 수행합니다. patch 객체에 명시적으로 포함된 필드만 SET 절에 포함시켜 예상치 못한 컬럼 덮어쓰기를 방지합니다.
   * @param {number} id - 대상 이벤트 PK
   * @param {Object} patch - camelCase 부분 업데이트 객체
   * @returns {Object|undefined} 갱신된 이벤트 레코드
   */
  updateEvent: async (id, patch) => {
    // camelCase 입력 → snake_case 컬럼 매핑 테이블. 참여자(participants)는 별도 흐름이므로 여기에 포함하지 않습니다.
    const fieldMap = {
      title: 'title',
      description: 'description',
      eventType: 'event_type',
      scope: 'scope',
      colorKey: 'color_key',
      startDatetime: 'start_datetime',
      endDatetime: 'end_datetime',
      isAllDay: 'is_all_day',
      location: 'location',
      isRecurring: 'is_recurring',
      recurrenceRule: 'recurrence_rule',
    };

    const sets = [];
    const values = [];
    let i = 1;
    for (const [key, column] of Object.entries(fieldMap)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        sets.push(`${column} = $${i}`);
        values.push(patch[key]);
        i += 1;
      }
    }

    // 변경 대상 컬럼이 없다면 현재 레코드를 그대로 반환합니다(no-op).
    if (sets.length === 0) {
      return await CalendarModel.findEventById(id);
    }

    sets.push(`updated_at = now()`);
    values.push(id);
    const queryText = `
      UPDATE calendar_events
         SET ${sets.join(', ')}
       WHERE id = $${i}
      RETURNING *;
    `;
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },

  /**
   * @function deleteEvent
   * @description 이벤트를 삭제합니다. 참여자/예외 테이블은 ON DELETE CASCADE로 자동 정리됩니다.
   * @param {number} id - 삭제 대상 이벤트 PK
   * @returns {Object|undefined} 삭제된 레코드의 id
   */
  deleteEvent: async (id) => {
    const queryText = `DELETE FROM calendar_events WHERE id = $1 RETURNING id;`;
    const { rows } = await db.query(queryText, [id]);
    return rows[0];
  },

  // ============================================================
  //  Participants (calendar_event_participants) — 연결테이블
  // ============================================================

  /**
   * @function addParticipants
   * @description 여러 사용자를 이벤트의 참여자로 한번의 INSERT로 추가합니다.
   *              UNIQUE(event_id, user_id) 제약을 만족하도록 ON CONFLICT DO NOTHING으로 중복을 무시합니다.
   *              콤마 문자열로 사용자를 저장하지 않고 반드시 개별 행으로 관리합니다.
   * @param {number} eventId
   * @param {Array<number>} userIds - 사용자 PK 배열
   * @returns {Array<Object>} 실제로 삽입된 참여자 레코드들
   */
  addParticipants: async (eventId, userIds) => {
    if (!Array.isArray(userIds) || userIds.length === 0) return [];

    // (event_id, user_id) 다중 값 INSERT용 플레이스홀더를 동적으로 조립합니다.
    const placeholders = userIds.map((_, idx) => `($1, $${idx + 2})`).join(', ');
    const values = [eventId, ...userIds];
    const queryText = `
      INSERT INTO calendar_event_participants (event_id, user_id)
      VALUES ${placeholders}
      ON CONFLICT (event_id, user_id) DO NOTHING
      RETURNING id, event_id, user_id, created_at;
    `;
    const { rows } = await db.query(queryText, values);
    return rows;
  },

  /**
   * @function removeAllParticipants
   * @description 이벤트의 모든 참여자를 제거합니다. PATCH 시 참여자 배열이 오면 "전체 교체" 전략을 위해 사용합니다.
   * @param {number} eventId
   */
  removeAllParticipants: async (eventId) => {
    const queryText = `DELETE FROM calendar_event_participants WHERE event_id = $1;`;
    await db.query(queryText, [eventId]);
  },

  /**
   * @function getParticipants
   * @description 이벤트의 참여자 목록을 users 테이블과 조인하여 사용자 기본 정보와 함께 반환합니다.
   *              users에 대한 SELECT-only 접근으로 사용자 관리(usersModel) 책임과 충돌하지 않습니다.
   * @param {number} eventId
   * @returns {Array<Object>}
   */
  getParticipants: async (eventId) => {
    const queryText = `
      SELECT p.id, p.user_id, p.created_at,
             u.name, u.email
        FROM calendar_event_participants p
        LEFT JOIN users u ON u.id = p.user_id
       WHERE p.event_id = $1
       ORDER BY p.id ASC;
    `;
    const { rows } = await db.query(queryText, [eventId]);
    return rows;
  },

  // ============================================================
  //  Exceptions (calendar_event_exceptions) — 반복 회차 예외
  // ============================================================

  /**
   * @function findExceptionsByEventId
   * @description 단일 이벤트의 예외 회차 전체를 시간순으로 조회합니다.
   * @param {number} eventId
   * @returns {Array<Object>}
   */
  findExceptionsByEventId: async (eventId) => {
    const queryText = `
      SELECT * FROM calendar_event_exceptions
       WHERE event_id = $1
       ORDER BY original_date ASC;
    `;
    const { rows } = await db.query(queryText, [eventId]);
    return rows;
  },

  /**
   * @function findExceptionsForEventIds
   * @description 여러 이벤트의 예외를 한 번의 쿼리로 조회하여 목록 조회 시의 N+1 문제를 방지합니다.
   * @param {Array<number>} eventIds
   * @returns {Array<Object>}
   */
  findExceptionsForEventIds: async (eventIds) => {
    if (!Array.isArray(eventIds) || eventIds.length === 0) return [];
    const queryText = `
      SELECT * FROM calendar_event_exceptions
       WHERE event_id = ANY($1::int[])
       ORDER BY event_id ASC, original_date ASC;
    `;
    const { rows } = await db.query(queryText, [eventIds]);
    return rows;
  },

  /**
   * @function upsertException
   * @description 반복 일정의 특정 회차 예외를 추가 또는 병합(부분 업데이트)합니다.
   *              UNIQUE(event_id, original_date) 제약을 활용해 동일 회차 중복 요청을 UPDATE로 흡수하되,
   *              null로 전달된 필드는 "미지정"으로 간주하여 INSERT 시엔 기본값/NULL, UPDATE 시엔 기존 값을 유지합니다.
   *              이로써 컨트롤러가 요청 본문에 포함된 키만 병합할 수 있어, 부분 요청이 기존 예외를 덮어쓰는 사고를 방지합니다.
   *              마스터 이벤트(calendar_events)는 이 함수에서 절대 변경되지 않습니다.
   * @param {Object} params - 각 필드는 null이면 "미지정"으로 처리됩니다.
   * @returns {Object} 생성/갱신된 예외 레코드
   */
  upsertException: async ({ eventId, originalDate, isCancelled, newStart, newEnd, newTitle }) => {
    // INSERT: is_cancelled 미지정 시 DB 기본값(false), 나머지 미지정 시 NULL.
    // UPDATE: 미지정($N == NULL)이면 기존 컬럼값을 유지, 지정되면 새 값으로 갱신.
    const queryText = `
      INSERT INTO calendar_event_exceptions (
        event_id, original_date, is_cancelled, new_start, new_end, new_title
      ) VALUES (
        $1, $2,
        COALESCE($3::boolean, false),
        $4::timestamp,
        $5::timestamp,
        $6::varchar
      )
      ON CONFLICT (event_id, original_date) DO UPDATE
         SET is_cancelled = COALESCE($3::boolean,   calendar_event_exceptions.is_cancelled),
             new_start    = COALESCE($4::timestamp, calendar_event_exceptions.new_start),
             new_end      = COALESCE($5::timestamp, calendar_event_exceptions.new_end),
             new_title    = COALESCE($6::varchar,   calendar_event_exceptions.new_title)
      RETURNING *;
    `;
    // null / undefined는 "미지정"으로 통일하여 pg 드라이버가 NULL 파라미터로 전송하도록 합니다.
    const normalize = (v) => (v === undefined || v === null ? null : v);
    const values = [
      eventId,
      originalDate,
      isCancelled === undefined || isCancelled === null ? null : Boolean(isCancelled),
      normalize(newStart),
      normalize(newEnd),
      normalize(newTitle),
    ];
    const { rows } = await db.query(queryText, values);
    return rows[0];
  },
};

module.exports = CalendarModel;
