-- =====================================================================
-- 003_public_site_v2.sql
-- 목적: 외부 공개용 랩 사이트(v2) 도메인 확장 마이그레이션
--       졸업생 프로필/학위논문/이벤트 다중이미지/연구분야 topics/
--       연구프로젝트·강의 공개 확장/사이트 전역 설정을 반영합니다.
-- 대상 DB: aics_lab
-- 실행 방법:
--   ① psql:  psql -U postgres -d aics_lab -f db/migrations/003_public_site_v2.sql
--   ② npm:   npm run migrate:003   (package.json 스크립트 사용 시)
--   ③ 스크립트: node db/apply-migration.js db/migrations/003_public_site_v2.sql
--
-- 멱등성(idempotency):
--   · 전체를 하나의 트랜잭션(BEGIN/COMMIT)으로 묶어 중간 실패 시 완전 롤백을 보장합니다.
--   · ALTER TABLE ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS 를 사용해
--     여러 번 재실행해도 스키마가 어긋나지 않도록 방어합니다.
--
-- 참고:
--   · 기존 계획에 있던 003_public_site_content.sql / 004_public_site_content_ext.sql 이
--     만들던 lab_publications, lab_professor, lab_lectures, lab_members,
--     home_projects, home_highlight_pubs, home_activities 테이블은 내부 테이블과의
--     이중 관리 문제로 폐기되었으며, 본 파일이 이를 대체합니다.
-- =====================================================================

BEGIN;

-- =====================================================================
-- [1] alumni_profiles — 졸업생 상세 프로필
--   · user_id 는 SET NULL 정책: 계정이 삭제돼도 프로필 자체는 남아있도록.
--   · history/interests 는 유연한 구조를 위해 JSONB 로 저장.
-- =====================================================================
CREATE TABLE IF NOT EXISTS alumni_profiles (
    id             SERIAL PRIMARY KEY,
    user_id        INT REFERENCES users(id) ON DELETE SET NULL,
    name           VARCHAR(100) NOT NULL,
    degree         VARCHAR(100),
    history        JSONB,
    interests      JSONB,
    display_order  INT DEFAULT 0,
    created_at     TIMESTAMP NOT NULL DEFAULT now()
);

-- 노출 순서로 정렬해 조회하는 경우가 많으므로 인덱스 부여
CREATE INDEX IF NOT EXISTS idx_alumni_profiles_display_order
    ON alumni_profiles(display_order);

-- =====================================================================
-- [2] theses — 학위논문 목록
-- =====================================================================
CREATE TABLE IF NOT EXISTS theses (
    id             SERIAL PRIMARY KEY,
    year           VARCHAR(10) NOT NULL,
    author         VARCHAR(100) NOT NULL,
    title          VARCHAR(500) NOT NULL,
    display_order  INT DEFAULT 0,
    created_at     TIMESTAMP NOT NULL DEFAULT now()
);

-- 노출 순서 정렬용
CREATE INDEX IF NOT EXISTS idx_theses_display_order
    ON theses(display_order);

-- =====================================================================
-- [3] lab_events 확장 + 다중 이미지
--   · event_type: 학회/워크숍/세미나 등 이벤트 유형 태그
--   · event_date_end: 기간형 이벤트의 종료일
--   · display_order: 노출 순서
-- =====================================================================
ALTER TABLE lab_events
    ADD COLUMN IF NOT EXISTS event_type     VARCHAR(100),
    ADD COLUMN IF NOT EXISTS event_date_end DATE,
    ADD COLUMN IF NOT EXISTS display_order  INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_lab_events_display_order
    ON lab_events(display_order);

-- 이벤트별 다중 이미지 — 이벤트 삭제 시 함께 제거(CASCADE)
CREATE TABLE IF NOT EXISTS lab_event_images (
    id             SERIAL PRIMARY KEY,
    event_id       INT NOT NULL REFERENCES lab_events(id) ON DELETE CASCADE,
    image_url      VARCHAR(255) NOT NULL,
    display_order  INT DEFAULT 0
);

-- 특정 이벤트의 이미지들을 순서대로 조회하기 위한 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_lab_event_images_event
    ON lab_event_images(event_id, display_order);

-- =====================================================================
-- [4] research_areas 확장 — 세부 연구 주제 배열
--   · topics: 카드 하위에 노출되는 세부 주제 목록을 JSONB 배열로 저장.
-- =====================================================================
ALTER TABLE research_areas
    ADD COLUMN IF NOT EXISTS topics JSONB;

-- =====================================================================
-- [5] research_projects 확장 — 외부 공개 가능하게
--   · 기존 회계용 테이블을 재사용(새로 CREATE 하지 않음).
--   · is_public 이 true 인 행만 공개 사이트에 노출.
-- =====================================================================
ALTER TABLE research_projects
    ADD COLUMN IF NOT EXISTS is_public     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;

-- 공개 목록을 노출 순서대로 조회하기 위한 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_research_projects_public_order
    ON research_projects(display_order)
    WHERE is_public;

-- =====================================================================
-- [6] lectures 확장 — 색상 태그
--   · 기존 테이블을 재사용(새로 CREATE 하지 않음).
--   · tone: 공개 사이트에서 강의 카드에 적용할 색상 태그.
-- =====================================================================
ALTER TABLE lectures
    ADD COLUMN IF NOT EXISTS tone VARCHAR(20);

-- =====================================================================
-- [7] site_settings — 사이트 전역 설정 (1행만 관리)
-- =====================================================================
CREATE TABLE IF NOT EXISTS site_settings (
    id               SERIAL PRIMARY KEY,
    lab_name         VARCHAR(255),
    contact_email    VARCHAR(255),
    university_name  VARCHAR(255),
    university_url   VARCHAR(255),
    copyright_text   VARCHAR(255),
    hero_video_url   VARCHAR(255),
    hero_poster_url  VARCHAR(255),
    address          VARCHAR(255),
    updated_at       TIMESTAMP NOT NULL DEFAULT now()
);

COMMIT;

-- 마이그레이션 종료. 실패 시 위 BEGIN 이후 모든 변경사항이 자동 ROLLBACK 됩니다.
