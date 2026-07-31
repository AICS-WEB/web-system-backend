/**
 * @file adminContentModel.js
 * @description 외부 홈페이지용 관리자 CRUD 대상 5개 리소스의 데이터 액세스 레이어입니다.
 *              대상 테이블: partner_labs, professor_profile, lab_events, research_areas, lectures
 *
 * 공통 원칙:
 *  - SELECT 절은 컬럼을 명시적으로 나열합니다(SELECT * 금지). 응답 유출을 원천 차단.
 *  - PATCH는 patch 객체에 명시된 필드만 SET 절에 포함하여 부분 갱신을 안전하게 처리.
 *  - professor_profile은 통상 1건만 존재하므로 findFirst/updateFirst/createOne 3개 함수로 단건 컨텍스트 제공.
 */

const db = require('../config/db'); // PostgreSQL 커넥션 풀 모듈.

// ---------------------------------------------------------------------
// [1] partner_labs — 공동 연구실/파트너 링크
// ---------------------------------------------------------------------
const Partners = {
  create: async ({ labName, universityName, partnerLink, logoImageUrl, displayOrder }) => {
    const q = `
      INSERT INTO partner_labs (
        lab_name, university_name, partner_link, logo_image_url, display_order
      ) VALUES ($1, $2, $3, $4, COALESCE($5, 0))
      RETURNING id, lab_name, university_name, partner_link, logo_image_url, display_order, created_at;
    `;
    const { rows } = await db.query(q, [
      labName, universityName, partnerLink || null, logoImageUrl || null,
      displayOrder === undefined || displayOrder === null ? null : displayOrder,
    ]);
    return rows[0];
  },

  findAll: async () => {
    const q = `
      SELECT id, lab_name, university_name, partner_link, logo_image_url, display_order, created_at
        FROM partner_labs
       ORDER BY display_order ASC, id ASC;
    `;
    const { rows } = await db.query(q);
    return rows;
  },

  update: async (id, patch) => {
    const fieldMap = {
      labName: 'lab_name',
      universityName: 'university_name',
      partnerLink: 'partner_link',
      logoImageUrl: 'logo_image_url',
      displayOrder: 'display_order',
    };
    const { sets, values, nextIdx } = buildPatch(fieldMap, patch);
    if (sets.length === 0) return await Partners.findById(id);

    values.push(id);
    const q = `
      UPDATE partner_labs
         SET ${sets.join(', ')}
       WHERE id = $${nextIdx}
      RETURNING id, lab_name, university_name, partner_link, logo_image_url, display_order, created_at;
    `;
    const { rows } = await db.query(q, values);
    return rows[0];
  },

  findById: async (id) => {
    const q = `
      SELECT id, lab_name, university_name, partner_link, logo_image_url, display_order, created_at
        FROM partner_labs WHERE id = $1;
    `;
    const { rows } = await db.query(q, [id]);
    return rows[0];
  },

  remove: async (id) => {
    const q = `DELETE FROM partner_labs WHERE id = $1 RETURNING id;`;
    const { rows } = await db.query(q, [id]);
    return rows[0];
  },
};

// ---------------------------------------------------------------------
// [2] professor_profile — 지도교수 프로필 (통상 1건 유지)
// ---------------------------------------------------------------------
const Professor = {
  /**
   * @function findFirst
   * @description 저장된 첫 번째(유일한) 프로필 레코드를 반환합니다. 없으면 undefined.
   */
  findFirst: async () => {
    const q = `
      SELECT id, user_id, name, email, profile_image_url,
             position, department, university, introduction,
             education, career, research_focus, updated_at
        FROM professor_profile
       ORDER BY id ASC
       LIMIT 1;
    `;
    const { rows } = await db.query(q);
    return rows[0];
  },

  /**
   * @function countAll
   * @description 프로필 존재 여부 판정을 위해 총 레코드 수를 반환합니다(1건 제약을 컨트롤러가 강제).
   */
  countAll: async () => {
    const q = `SELECT COUNT(*)::int AS cnt FROM professor_profile;`;
    const { rows } = await db.query(q);
    return rows[0].cnt;
  },

  createOne: async ({
    userId, name, email, profileImageUrl,
    position, department, university, introduction,
    education, career, researchFocus,
  }) => {
    const q = `
      INSERT INTO professor_profile (
        user_id, name, email, profile_image_url,
        position, department, university, introduction,
        education, career, research_focus
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
      RETURNING id, user_id, name, email, profile_image_url,
                position, department, university, introduction,
                education, career, research_focus, updated_at;
    `;
    // education/career/research_focus 는 배열/객체이므로 JSON 문자열로 직렬화해야
    // node-pg 가 Postgres 배열 리터럴로 오인하지 않고 jsonb 로 정상 저장됩니다.
    const asJson = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
    const { rows } = await db.query(q, [
      userId === undefined || userId === null ? null : userId,
      name, email,
      profileImageUrl || null,
      position || null,
      department || null,
      university || null,
      introduction || null,
      asJson(education),
      asJson(career),
      asJson(researchFocus),
    ]);
    return rows[0];
  },

  updateFirst: async (patch) => {
    // JSONB 필드는 배열/객체이므로 patch 에 존재하면 JSON 문자열로 직렬화합니다.
    // (node-pg 가 JS 배열을 Postgres 배열 리터럴로 변환하는 것을 방지)
    const normalized = { ...patch };
    for (const k of ['education', 'career', 'researchFocus']) {
      if (Object.prototype.hasOwnProperty.call(normalized, k)
          && normalized[k] !== null && normalized[k] !== undefined) {
        normalized[k] = JSON.stringify(normalized[k]);
      }
    }
    const fieldMap = {
      userId: 'user_id',
      name: 'name',
      email: 'email',
      profileImageUrl: 'profile_image_url',
      position: 'position',
      department: 'department',
      university: 'university',
      introduction: 'introduction',
      education: 'education',
      career: 'career',
      researchFocus: 'research_focus',
    };
    const { sets, values, nextIdx } = buildPatch(fieldMap, normalized);
    if (sets.length === 0) return await Professor.findFirst();

    sets.push(`updated_at = now()`);
    // 첫 번째 레코드 하나만 갱신. 서브쿼리로 최소 id 를 잠근 뒤 UPDATE 합니다.
    const q = `
      UPDATE professor_profile
         SET ${sets.join(', ')}
       WHERE id = (SELECT id FROM professor_profile ORDER BY id ASC LIMIT 1)
      RETURNING id, user_id, name, email, profile_image_url,
                position, department, university, introduction,
                education, career, research_focus, updated_at;
    `;
    const { rows } = await db.query(q, values);
    return rows[0];
  },
};

// ---------------------------------------------------------------------
// [3] lab_events — 학회/워크숍/랩 이벤트 배너
// ---------------------------------------------------------------------
const Events = {
  create: async ({ eventName, eventDate, location, description, eventImageUrl }) => {
    const q = `
      INSERT INTO lab_events (
        event_name, event_date, location, description, event_image_url
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id, event_name, event_date, location, description, event_image_url, created_at;
    `;
    const { rows } = await db.query(q, [
      eventName, eventDate,
      location || null, description || null, eventImageUrl || null,
    ]);
    return rows[0];
  },

  findAll: async () => {
    const q = `
      SELECT id, event_name, event_date, location, description, event_image_url, created_at
        FROM lab_events
       ORDER BY event_date DESC, id DESC;
    `;
    const { rows } = await db.query(q);
    return rows;
  },

  findById: async (id) => {
    const q = `
      SELECT id, event_name, event_date, location, description, event_image_url, created_at
        FROM lab_events WHERE id = $1;
    `;
    const { rows } = await db.query(q, [id]);
    return rows[0];
  },

  update: async (id, patch) => {
    const fieldMap = {
      eventName: 'event_name',
      eventDate: 'event_date',
      location: 'location',
      description: 'description',
      eventImageUrl: 'event_image_url',
    };
    const { sets, values, nextIdx } = buildPatch(fieldMap, patch);
    if (sets.length === 0) return await Events.findById(id);

    values.push(id);
    const q = `
      UPDATE lab_events
         SET ${sets.join(', ')}
       WHERE id = $${nextIdx}
      RETURNING id, event_name, event_date, location, description, event_image_url, created_at;
    `;
    const { rows } = await db.query(q, values);
    return rows[0];
  },

  remove: async (id) => {
    const q = `DELETE FROM lab_events WHERE id = $1 RETURNING id;`;
    const { rows } = await db.query(q, [id]);
    return rows[0];
  },
};

// ---------------------------------------------------------------------
// [4] research_areas — 연구 분야 카드
// ---------------------------------------------------------------------
const Research = {
  create: async ({ title, tag, description, imageUrl, displayOrder }) => {
    const q = `
      INSERT INTO research_areas (
        title, tag, description, image_url, display_order
      ) VALUES ($1, $2, $3, $4, COALESCE($5, 0))
      RETURNING id, title, tag, description, image_url, display_order, created_at, updated_at;
    `;
    const { rows } = await db.query(q, [
      title, tag || null, description || null, imageUrl || null,
      displayOrder === undefined || displayOrder === null ? null : displayOrder,
    ]);
    return rows[0];
  },

  findAll: async () => {
    const q = `
      SELECT id, title, tag, description, image_url, display_order, created_at, updated_at
        FROM research_areas
       ORDER BY display_order ASC, id ASC;
    `;
    const { rows } = await db.query(q);
    return rows;
  },

  findById: async (id) => {
    const q = `
      SELECT id, title, tag, description, image_url, display_order, created_at, updated_at
        FROM research_areas WHERE id = $1;
    `;
    const { rows } = await db.query(q, [id]);
    return rows[0];
  },

  update: async (id, patch) => {
    const fieldMap = {
      title: 'title',
      tag: 'tag',
      description: 'description',
      imageUrl: 'image_url',
      displayOrder: 'display_order',
    };
    const { sets, values, nextIdx } = buildPatch(fieldMap, patch);
    if (sets.length === 0) return await Research.findById(id);

    sets.push(`updated_at = now()`);
    values.push(id);
    const q = `
      UPDATE research_areas
         SET ${sets.join(', ')}
       WHERE id = $${nextIdx}
      RETURNING id, title, tag, description, image_url, display_order, created_at, updated_at;
    `;
    const { rows } = await db.query(q, values);
    return rows[0];
  },

  remove: async (id) => {
    const q = `DELETE FROM research_areas WHERE id = $1 RETURNING id;`;
    const { rows } = await db.query(q, [id]);
    return rows[0];
  },
};

// ---------------------------------------------------------------------
// [5] lectures — 지도교수 강의 과목
// ---------------------------------------------------------------------
const Lectures = {
  create: async ({
    courseCode, titleKo, titleEn, semester, academicYear,
    dayOfWeek, startTime, endTime, room, displayOrder,
  }) => {
    const q = `
      INSERT INTO lectures (
        course_code, title_ko, title_en, semester, academic_year,
        day_of_week, start_time, end_time, room, display_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 0))
      RETURNING id, course_code, title_ko, title_en, semester, academic_year,
                day_of_week, start_time, end_time, room, display_order, created_at, updated_at;
    `;
    const { rows } = await db.query(q, [
      courseCode || null, titleKo, titleEn || null,
      semester, academicYear,
      dayOfWeek || null, startTime || null, endTime || null, room || null,
      displayOrder === undefined || displayOrder === null ? null : displayOrder,
    ]);
    return rows[0];
  },

  findAll: async () => {
    const q = `
      SELECT id, course_code, title_ko, title_en, semester, academic_year,
             day_of_week, start_time, end_time, room, display_order, created_at, updated_at
        FROM lectures
       ORDER BY academic_year DESC, semester ASC, display_order ASC, id ASC;
    `;
    const { rows } = await db.query(q);
    return rows;
  },

  findById: async (id) => {
    const q = `
      SELECT id, course_code, title_ko, title_en, semester, academic_year,
             day_of_week, start_time, end_time, room, display_order, created_at, updated_at
        FROM lectures WHERE id = $1;
    `;
    const { rows } = await db.query(q, [id]);
    return rows[0];
  },

  update: async (id, patch) => {
    const fieldMap = {
      courseCode: 'course_code',
      titleKo: 'title_ko',
      titleEn: 'title_en',
      semester: 'semester',
      academicYear: 'academic_year',
      dayOfWeek: 'day_of_week',
      startTime: 'start_time',
      endTime: 'end_time',
      room: 'room',
      displayOrder: 'display_order',
    };
    const { sets, values, nextIdx } = buildPatch(fieldMap, patch);
    if (sets.length === 0) return await Lectures.findById(id);

    sets.push(`updated_at = now()`);
    values.push(id);
    const q = `
      UPDATE lectures
         SET ${sets.join(', ')}
       WHERE id = $${nextIdx}
      RETURNING id, course_code, title_ko, title_en, semester, academic_year,
                day_of_week, start_time, end_time, room, display_order, created_at, updated_at;
    `;
    const { rows } = await db.query(q, values);
    return rows[0];
  },

  remove: async (id) => {
    const q = `DELETE FROM lectures WHERE id = $1 RETURNING id;`;
    const { rows } = await db.query(q, [id]);
    return rows[0];
  },
};

// ---------------------------------------------------------------------
// 내부 유틸: 화이트리스트(fieldMap) 기반 부분 UPDATE SET 절 생성기
// ---------------------------------------------------------------------
function buildPatch(fieldMap, patch) {
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
  return { sets, values, nextIdx: i };
}

module.exports = { Partners, Professor, Events, Research, Lectures };
