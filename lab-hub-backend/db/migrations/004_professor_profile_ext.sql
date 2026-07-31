-- =====================================================================
-- 004_professor_profile_ext.sql
-- 목적: 외부 공개 홈페이지의 지도교수 프로필(professor_profile) 확장 마이그레이션
--       자유 서술형 career_history(TEXT)를 폐기하고, 화면에 구조적으로 노출할 수
--       있는 직위/소속/소개/학력/경력/연구관심 컬럼으로 대체합니다.
-- 대상 DB: aics_lab
-- 실행 방법:
--   ① psql:  psql -U postgres -d aics_lab -f db/migrations/004_professor_profile_ext.sql
--   ② npm:   npm run migrate:004   (package.json 스크립트 사용 시)
--   ③ 스크립트: node db/apply-migration.js db/migrations/004_professor_profile_ext.sql
--
-- 멱등성(idempotency):
--   · 전체를 하나의 트랜잭션(BEGIN/COMMIT)으로 묶어 중간 실패 시 완전 롤백을 보장합니다.
--   · DROP COLUMN IF EXISTS / ADD COLUMN IF NOT EXISTS 를 사용해
--     여러 번 재실행해도 스키마가 어긋나지 않도록 방어합니다.
-- =====================================================================

BEGIN;

-- =====================================================================
-- [1] 사용하지 않는 자유 서술형 컬럼 제거
--   · career_history(TEXT)는 아래 구조화된 career(JSONB)로 대체되어 폐기합니다.
-- =====================================================================
ALTER TABLE professor_profile
    DROP COLUMN IF EXISTS career_history;

-- =====================================================================
-- [2] 공개 프로필 표현용 구조화 컬럼 추가
--   · position/department/university: 단일 값 텍스트 필드
--   · introduction: 자기소개 본문(TEXT)
--   · education/career/research_focus: 항목 배열을 유연하게 담기 위한 JSONB
-- =====================================================================
ALTER TABLE professor_profile
    ADD COLUMN IF NOT EXISTS position        VARCHAR(120),
    ADD COLUMN IF NOT EXISTS department      VARCHAR(200),
    ADD COLUMN IF NOT EXISTS university      VARCHAR(200),
    ADD COLUMN IF NOT EXISTS introduction    TEXT,
    ADD COLUMN IF NOT EXISTS education       JSONB,
    ADD COLUMN IF NOT EXISTS career          JSONB,
    ADD COLUMN IF NOT EXISTS research_focus  JSONB;

COMMIT;

-- 마이그레이션 종료. 실패 시 위 BEGIN 이후 모든 변경사항이 자동 ROLLBACK 됩니다.
