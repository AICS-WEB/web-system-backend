-- =====================================================================
-- 002_public_site_tables.sql
-- 목적: 외부 공개용 랩 사이트(연구실 소개 페이지) 리소스 도메인 확장 마이그레이션
-- 대상 DB: aics_lab
-- 실행 방법:
--   ① psql:  psql -U postgres -d aics_lab -f db/migrations/002_public_site_tables.sql
--   ② npm:   npm run migrate:002   (package.json 스크립트 사용 시)
--   ③ 스크립트: node db/apply-migration.js db/migrations/002_public_site_tables.sql
--
-- 멱등성(idempotency):
--   · 전체를 하나의 트랜잭션(BEGIN/COMMIT)으로 묶어 중간 실패 시 완전 롤백을 보장합니다.
--   · ALTER TABLE ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS 를 사용해
--     여러 번 재실행해도 스키마가 어긋나지 않도록 방어합니다.
-- =====================================================================

BEGIN;

-- =====================================================================
-- [1] publications 확장 — 공개 사이트 카드 뷰에 필요한 부제/썸네일 컬럼
-- =====================================================================
ALTER TABLE publications
    ADD COLUMN IF NOT EXISTS subtitle  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS image_url VARCHAR(255);

-- 공개 연구 프로젝트 표시에 필요한 확장 컬럼
ALTER TABLE research_projects
    ADD COLUMN IF NOT EXISTS program       VARCHAR(255),
    ADD COLUMN IF NOT EXISTS is_public     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;

-- =====================================================================
-- [2] partner_labs — 공동 연구실/파트너 링크 배너
-- =====================================================================
CREATE TABLE IF NOT EXISTS partner_labs (
    id                SERIAL PRIMARY KEY,
    lab_name          VARCHAR(255) NOT NULL,
    university_name   VARCHAR(255) NOT NULL,
    partner_link      VARCHAR(255),
    logo_image_url    VARCHAR(255),
    display_order     INT DEFAULT 0,
    created_at        TIMESTAMP NOT NULL DEFAULT now()
);

-- 노출 순서로 정렬해 조회하는 경우가 많으므로 인덱스 부여
CREATE INDEX IF NOT EXISTS idx_partner_labs_display_order
    ON partner_labs(display_order);

-- =====================================================================
-- [3] professor_profile — 지도교수 프로필 (내부 users 와 선택적 연결)
--   · user_id 는 SET NULL 정책: 계정이 삭제돼도 프로필 자체는 남아있도록.
--   · 단수형 테이블명은 요구사항에 따른 것.
-- =====================================================================
CREATE TABLE IF NOT EXISTS professor_profile (
    id                 SERIAL PRIMARY KEY,
    user_id            INT REFERENCES users(id) ON DELETE SET NULL,
    name               VARCHAR(100) NOT NULL,
    email              VARCHAR(255) NOT NULL,
    profile_image_url  VARCHAR(255),
    career_history     TEXT,
    updated_at         TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_professor_profile_user
    ON professor_profile(user_id);

-- =====================================================================
-- [4] lab_events — 학회/워크숍/랩 이벤트 배너
-- =====================================================================
CREATE TABLE IF NOT EXISTS lab_events (
    id                SERIAL PRIMARY KEY,
    event_name        VARCHAR(255) NOT NULL,
    event_date        DATE NOT NULL,
    location          VARCHAR(255),
    description       TEXT,
    event_image_url   VARCHAR(255),
    created_at        TIMESTAMP NOT NULL DEFAULT now()
);

-- 최신순 정렬용
CREATE INDEX IF NOT EXISTS idx_lab_events_event_date
    ON lab_events(event_date DESC);

-- =====================================================================
-- [5] research_areas — 연구 분야 카드 (홈페이지 소개 섹션)
-- =====================================================================
CREATE TABLE IF NOT EXISTS research_areas (
    id             SERIAL PRIMARY KEY,
    title          VARCHAR(255) NOT NULL,
    tag            VARCHAR(100),
    description    VARCHAR(500),
    image_url      VARCHAR(255),
    display_order  INT DEFAULT 0,
    created_at     TIMESTAMP NOT NULL DEFAULT now(),
    updated_at     TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE research_areas
    ADD COLUMN IF NOT EXISTS topics JSONB;

CREATE INDEX IF NOT EXISTS idx_research_areas_display_order
    ON research_areas(display_order);

-- =====================================================================
-- [6] lectures — 지도교수 강의 과목 목록 (학기별)
-- =====================================================================
CREATE TABLE IF NOT EXISTS lectures (
    id              SERIAL PRIMARY KEY,
    course_code     VARCHAR(20),
    title_ko        VARCHAR(200) NOT NULL,
    title_en        VARCHAR(200),
    semester        VARCHAR(20) NOT NULL,
    academic_year   INT NOT NULL,
    day_of_week     VARCHAR(10),
    start_time      TIME,
    end_time        TIME,
    room            VARCHAR(50),
    display_order   INT DEFAULT 0,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now()
);

-- 학기 + 학년도 조합으로 자주 필터링하므로 복합 인덱스 부여
CREATE INDEX IF NOT EXISTS idx_lectures_year_semester
    ON lectures(academic_year DESC, semester);

COMMIT;

-- 마이그레이션 종료. 실패 시 위 BEGIN 이후 모든 변경사항이 자동 ROLLBACK 됩니다.
