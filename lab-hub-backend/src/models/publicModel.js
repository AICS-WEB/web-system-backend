/**
 * @file publicModel.js
 * @description 외부 홈페이지(비로그인) 공개 조회 API용 데이터 액세스 레이어입니다.
 *              모든 쿼리는 SELECT 절에서 컬럼을 명시적으로 나열하여 password_hash / phone / email 등
 *              민감 정보가 응답 페이로드로 새어나가지 않도록 원천 차단합니다.
 *
 * 대상 리소스:
 *  - 멤버(users)         : is_public_profile=true AND account_status='approved'
 *  - 논문(publications)  : is_public=true
 *  - 파트너(partner_labs)
 *  - 지도교수(professor_profile) + 해당 user_id 저자 논문 조인
 *  - 이벤트(lab_events)
 *  - 연구 분야(research_areas)
 *  - 강의(lectures)      : ?semester=&year= 필터
 */

const db = require('../config/db'); // PostgreSQL 커넥션 풀 모듈.

const PublicModel = {
  /**
   * @function listMembers
   * @description 공개 프로필 노출을 허용한(is_public_profile=true) 승인 계정만 반환합니다.
   *              student_id는 SQL 레벨에서 "앞 2자리 잘라내고 뒤 2자리 + '학번'" 표기로 가공하여 grade_display 컬럼으로 제공합니다.
   *              (예: 20210001 → '21학번')
   *              민감 컬럼(password_hash / phone / email / role / account_status / last_login_at) 은 SELECT 절에 절대 포함되지 않습니다.
   */
  listMembers: async () => {
    const q = `
      SELECT
        id,
        name,
        department,
        program,
        enrollment_year,
        graduation_year,
        grade_override,
        research_topic,
        profile_image,
        bio,
        github_url,
        linkedin_url,
        is_alumni,
        SUBSTRING(student_id FROM 3 FOR 2) || '학번' AS grade_display
      FROM users
      WHERE is_public_profile = true
        AND account_status = 'approved'
      ORDER BY is_alumni ASC, enrollment_year DESC, name ASC;
    `;
    const { rows } = await db.query(q);
    return rows;
  },

  /**
   * @function listPublications
   * @description 공개 표시가 허용된(is_public=true) 논문만 반환합니다.
   *              프론트 카드 뷰용 요약 컬럼만 노출합니다. authors_text 등 상세는 제외.
   */
  listPublications: async () => {
    const q = `
      SELECT
        id, title, subtitle, venue, doi, image_url,
        published_date, year, pub_type
      FROM publications
      WHERE is_public = true
      ORDER BY published_date DESC NULLS LAST, year DESC, id DESC;
    `;
    const { rows } = await db.query(q);
    return rows;
  },

  /**
   * @function listPartners
   * @description 파트너 랩 배너 목록. display_order 오름차순, 동률은 id 오름차순으로 안정 정렬.
   */
  listPartners: async () => {
    const q = `
      SELECT id, lab_name, university_name, partner_link, logo_image_url, display_order
        FROM partner_labs
       ORDER BY display_order ASC, id ASC;
    `;
    const { rows } = await db.query(q);
    return rows;
  },

  /**
   * @function findProfessor
   * @description 저장된 첫 번째 프로필 레코드를 반환합니다.
   *              user_id 는 후속 논문 조인용으로만 사용하며 응답에 포함할지는 컨트롤러가 결정.
   *              email 은 공개 프로필 특성상 노출 허용(교수 연락처 표기 목적).
   */
  findProfessor: async () => {
    const q = `
      SELECT id, user_id, name, email, profile_image_url, career_history, updated_at
        FROM professor_profile
       ORDER BY id ASC
       LIMIT 1;
    `;
    const { rows } = await db.query(q);
    return rows[0];
  },

  /**
   * @function findProfessorPublications
   * @description 지도교수의 user_id 로 publication_authors 를 조인해 공개 논문만 반환합니다.
   *              user_id 가 null 이면 조인이 성립하지 않으므로 컨트롤러가 이 함수를 호출하기 전에 분기 처리합니다.
   */
  findProfessorPublications: async (userId) => {
    const q = `
      SELECT
        p.id, p.title, p.subtitle, p.venue, p.doi, p.image_url,
        p.published_date, p.year, p.pub_type,
        pa.author_order, pa.is_corresponding
      FROM publications p
      JOIN publication_authors pa ON pa.publication_id = p.id
      WHERE pa.user_id = $1 AND p.is_public = true
      ORDER BY p.published_date DESC NULLS LAST, p.year DESC, p.id DESC;
    `;
    const { rows } = await db.query(q, [userId]);
    return rows;
  },

  /**
   * @function listEvents
   * @description 랩 이벤트 목록. 최신순(event_date DESC).
   */
  listEvents: async () => {
    const q = `
      SELECT id, event_name, event_date, location, description, event_image_url, created_at
        FROM lab_events
       ORDER BY event_date DESC, id DESC;
    `;
    const { rows } = await db.query(q);
    return rows;
  },

  /**
   * @function listResearchAreas
   * @description 연구 분야 카드 목록. display_order 오름차순.
   */
  listResearchAreas: async () => {
    const q = `
      SELECT id, title, tag, description, image_url, display_order
        FROM research_areas
       ORDER BY display_order ASC, id ASC;
    `;
    const { rows } = await db.query(q);
    return rows;
  },

  /**
   * @function listLectures
   * @description 강의 목록. semester / academic_year 선택 필터 지원.
   *              정렬은 요구사항대로 day_of_week → start_time 오름차순.
   *              (요일 문자열은 자연 정렬이 안 되므로 CASE 표현식으로 월~일 순서를 강제)
   */
  listLectures: async ({ semester, academicYear } = {}) => {
    const conditions = [];
    const values = [];

    if (semester) {
      values.push(semester);
      conditions.push(`semester = $${values.length}`);
    }
    if (academicYear !== undefined && academicYear !== null) {
      values.push(academicYear);
      conditions.push(`academic_year = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const q = `
      SELECT
        id, course_code, title_ko, title_en, semester, academic_year,
        day_of_week, start_time, end_time, room, display_order
      FROM lectures
      ${where}
      ORDER BY
        CASE day_of_week
          WHEN 'Mon' THEN 1 WHEN '월' THEN 1
          WHEN 'Tue' THEN 2 WHEN '화' THEN 2
          WHEN 'Wed' THEN 3 WHEN '수' THEN 3
          WHEN 'Thu' THEN 4 WHEN '목' THEN 4
          WHEN 'Fri' THEN 5 WHEN '금' THEN 5
          WHEN 'Sat' THEN 6 WHEN '토' THEN 6
          WHEN 'Sun' THEN 7 WHEN '일' THEN 7
          ELSE 99
        END ASC,
        start_time ASC NULLS LAST,
        display_order ASC,
        id ASC;
    `;
    const { rows } = await db.query(q, values);
    return rows;
  },
};

module.exports = PublicModel;
