-- =====================================================================
-- AICS Lab 웹 시스템 — 통합 스키마 (PostgreSQL)
-- 25개 테이블 (다국어 제외)
-- ERDCloud Import → SQL (DBMS: PostgreSQL) 로 불러오기
-- 생성 순서: ENUM → 참조 대상 테이블 → 참조 테이블 순
-- =====================================================================

-- ---------- ENUM TYPES ----------
CREATE TYPE user_role          AS ENUM ('member', 'manager', 'admin');
CREATE TYPE account_status     AS ENUM ('pending', 'approved', 'rejected', 'deactivated');
CREATE TYPE program_type       AS ENUM ('undergrad', 'master', 'phd', 'professor', 'other');
CREATE TYPE lang_type          AS ENUM ('ko', 'en');
CREATE TYPE leave_type         AS ENUM ('annual', 'half', 'other');
CREATE TYPE half_period        AS ENUM ('am', 'pm');
CREATE TYPE leave_status       AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE event_type         AS ENUM ('meeting', 'deadline', 'event', 'trip', 'other');
CREATE TYPE event_scope        AS ENUM ('shared', 'personal');
CREATE TYPE attendance_status  AS ENUM ('present', 'late', 'absent', 'leave', 'half_leave');
CREATE TYPE notice_category    AS ENUM ('general', 'important', 'account_info', 'schedule');
CREATE TYPE storage_type       AS ENUM ('drive', 'nas');
CREATE TYPE fund_type          AS ENUM ('department', 'research', 'other');
CREATE TYPE budget_status      AS ENUM ('active', 'completed', 'pending');
CREATE TYPE expense_category   AS ENUM ('personnel', 'activity', 'material', 'other');
CREATE TYPE expense_status     AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE purchase_status    AS ENUM ('pending', 'approved', 'rejected', 'purchased', 'delivered');
CREATE TYPE credential_category AS ENUM ('wifi', 'server', 'cloud', 'license', 'other');
CREATE TYPE credential_action  AS ENUM ('view', 'copy');
CREATE TYPE pub_type           AS ENUM ('sci', 'kci', 'intl_conf', 'domestic_conf');
CREATE TYPE pub_status         AS ENUM ('writing', 'submitted', 'under_review', 'accepted', 'published');
CREATE TYPE recruit_status     AS ENUM ('pending', 'reviewing', 'accepted', 'rejected');
CREATE TYPE file_category      AS ENUM ('paper', 'presentation', 'template', 'software', 'other');
CREATE TYPE notification_type  AS ENUM (
    'leave_requested', 'leave_approved', 'leave_rejected',
    'purchase_requested', 'purchase_approved', 'purchase_rejected', 'purchase_delivered',
    'notice_created', 'recruit_received',
    'signup_requested', 'signup_approved', 'general'
);

-- =====================================================================
-- 1. 사용자 관리
-- =====================================================================
CREATE TABLE users (
    id                  SERIAL PRIMARY KEY,
    email               VARCHAR(255) UNIQUE NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,
    name                VARCHAR(100) NOT NULL,
    role                user_role NOT NULL DEFAULT 'member',
    account_status      account_status NOT NULL DEFAULT 'pending',
    student_id          VARCHAR(50) UNIQUE NOT NULL,
    department          VARCHAR(100) NOT NULL,
    program             program_type NOT NULL,
    enrollment_year     INT NOT NULL,
    graduation_year     INT,
    grade_override      VARCHAR(50),
    research_topic      TEXT,
    profile_image       VARCHAR(255),
    phone               VARCHAR(20),
    bio                 VARCHAR(255),
    github_url          VARCHAR(255),
    linkedin_url        VARCHAR(255),
    is_public_profile   BOOLEAN NOT NULL DEFAULT false,
    is_alumni           BOOLEAN NOT NULL DEFAULT false,
    last_login_at       TIMESTAMP,
    preferred_language  lang_type NOT NULL DEFAULT 'ko',
    created_at          TIMESTAMP NOT NULL DEFAULT now(),
    updated_at          TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_alumni_grad CHECK (
        (is_alumni = true  AND graduation_year IS NOT NULL) OR
        (is_alumni = false AND graduation_year IS NULL)
    )
);
CREATE INDEX idx_users_account_status ON users(account_status);
CREATE INDEX idx_users_alumni_grad   ON users(is_alumni, graduation_year);
CREATE INDEX idx_users_public        ON users(is_public_profile);

-- =====================================================================
-- 2. 인증 시스템
-- =====================================================================
CREATE TABLE refresh_tokens (
    id           SERIAL PRIMARY KEY,
    user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   VARCHAR(255) NOT NULL UNIQUE,
    expires_at   TIMESTAMP NOT NULL,
    device_info  VARCHAR(255),
    revoked_at   TIMESTAMP,
    created_at   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE password_reset_tokens (
    id           SERIAL PRIMARY KEY,
    user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   VARCHAR(255) NOT NULL UNIQUE,
    expires_at   TIMESTAMP NOT NULL,
    used_at      TIMESTAMP,
    created_at   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_reset_tokens_user ON password_reset_tokens(user_id);

-- =====================================================================
-- 3. 캘린더
-- =====================================================================
CREATE TABLE calendar_events (
    id               SERIAL PRIMARY KEY,
    created_by       INT REFERENCES users(id) ON DELETE SET NULL,
    title            VARCHAR(200) NOT NULL,
    description      TEXT,
    event_type       event_type NOT NULL,
    scope            event_scope NOT NULL,
    color_key        VARCHAR(20),
    start_datetime   TIMESTAMP NOT NULL,
    end_datetime     TIMESTAMP NOT NULL,
    is_all_day       BOOLEAN NOT NULL DEFAULT false,
    location         VARCHAR(255),
    is_recurring     BOOLEAN NOT NULL DEFAULT false,
    recurrence_rule  VARCHAR(255),
    created_at       TIMESTAMP NOT NULL DEFAULT now(),
    updated_at       TIMESTAMP NOT NULL DEFAULT now(),
    CHECK (start_datetime <= end_datetime)
);
CREATE INDEX idx_calendar_range   ON calendar_events(start_datetime, end_datetime);
CREATE INDEX idx_calendar_scope   ON calendar_events(scope);
CREATE INDEX idx_calendar_creator ON calendar_events(created_by);

CREATE TABLE calendar_event_participants (
    id          SERIAL PRIMARY KEY,
    event_id    INT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE(event_id, user_id)
);
CREATE INDEX idx_cal_participants_event ON calendar_event_participants(event_id);
CREATE INDEX idx_cal_participants_user  ON calendar_event_participants(user_id);

CREATE TABLE calendar_event_exceptions (
    id             SERIAL PRIMARY KEY,
    event_id       INT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    original_date  DATE NOT NULL,
    is_cancelled   BOOLEAN NOT NULL DEFAULT false,
    new_start      TIMESTAMP,
    new_end        TIMESTAMP,
    new_title      VARCHAR(200),
    created_at     TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE(event_id, original_date)
);
CREATE INDEX idx_cal_exceptions_event ON calendar_event_exceptions(event_id);

-- =====================================================================
-- 5. 휴가 관리  (출결보다 먼저 생성: attendance가 leave_requests를 참조)
-- =====================================================================
CREATE TABLE leave_balances (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    year        INT NOT NULL,
    total_days  DECIMAL(4,1) NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    updated_at  TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE(user_id, year)
);
CREATE INDEX idx_leave_balances_user_year ON leave_balances(user_id, year);

CREATE TABLE leave_requests (
    id            SERIAL PRIMARY KEY,
    user_id       INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    leave_type    leave_type NOT NULL,
    half_period   half_period,
    start_date    DATE NOT NULL,
    end_date      DATE NOT NULL,
    reason        TEXT,
    status        leave_status NOT NULL DEFAULT 'pending',
    reject_reason TEXT,
    reviewed_by   INT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at   TIMESTAMP,
    created_at    TIMESTAMP NOT NULL DEFAULT now(),
    updated_at    TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_half_logic CHECK (
        (leave_type = 'half' AND start_date = end_date AND half_period IS NOT NULL)
        OR
        (leave_type <> 'half' AND half_period IS NULL AND start_date <= end_date)
    )
);
CREATE INDEX idx_leave_requests_user   ON leave_requests(user_id);
CREATE INDEX idx_leave_requests_status ON leave_requests(status);

-- =====================================================================
-- 4. 출결
-- =====================================================================
CREATE TABLE attendance (
    id                SERIAL PRIMARY KEY,
    user_id           INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    date              DATE NOT NULL,
    check_in          TIMESTAMP,
    check_out         TIMESTAMP,
    status            attendance_status NOT NULL,
    leave_request_id  INT REFERENCES leave_requests(id) ON DELETE SET NULL,
    created_at        TIMESTAMP NOT NULL DEFAULT now(),
    updated_at        TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE(user_id, date)
);
CREATE INDEX idx_attendance_user_date ON attendance(user_id, date);
CREATE INDEX idx_attendance_date      ON attendance(date);
CREATE INDEX idx_attendance_status    ON attendance(status);

-- =====================================================================
-- 6. 공지사항
-- =====================================================================
CREATE TABLE notices (
    id          SERIAL PRIMARY KEY,
    author_id   INT REFERENCES users(id) ON DELETE SET NULL,
    title       VARCHAR(200) NOT NULL,
    content     TEXT NOT NULL,
    category    notice_category NOT NULL DEFAULT 'general',
    is_pinned   BOOLEAN NOT NULL DEFAULT false,
    view_count  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMP NOT NULL DEFAULT now(),
    updated_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_notices_pinned_created ON notices(is_pinned DESC, created_at DESC);
CREATE INDEX idx_notices_category       ON notices(category);

CREATE TABLE notice_attachments (
    id            SERIAL PRIMARY KEY,
    notice_id     INT NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
    filename      VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(100),
    storage_type  storage_type NOT NULL DEFAULT 'drive',
    file_url      VARCHAR(1000),
    filepath      VARCHAR(500),
    filesize      BIGINT,
    created_at    TIMESTAMP NOT NULL DEFAULT now(),
    CHECK (
        (storage_type = 'drive' AND file_url IS NOT NULL) OR
        (storage_type = 'nas'   AND filepath IS NOT NULL)
    )
);
CREATE INDEX idx_notice_attachments_notice ON notice_attachments(notice_id);

-- =====================================================================
-- 7. 회계 관리
-- =====================================================================
CREATE TABLE research_projects (
    id             SERIAL PRIMARY KEY,
    title          VARCHAR(300) NOT NULL,
    funding_agency VARCHAR(200),
    period         VARCHAR(100),
    role           VARCHAR(100),
    status         VARCHAR(50),
    created_at     TIMESTAMP NOT NULL DEFAULT now(),
    updated_at     TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE budgets (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(200) NOT NULL,
    fund_type     fund_type NOT NULL,
    project_id    INT REFERENCES research_projects(id) ON DELETE SET NULL,
    total_budget  DECIMAL(12,2) NOT NULL,
    start_date    DATE NOT NULL,
    end_date      DATE NOT NULL,
    status        budget_status NOT NULL DEFAULT 'active',
    created_at    TIMESTAMP NOT NULL DEFAULT now(),
    updated_at    TIMESTAMP NOT NULL DEFAULT now(),
    CHECK (start_date <= end_date)
);
CREATE INDEX idx_budgets_fund_type ON budgets(fund_type);
CREATE INDEX idx_budgets_project   ON budgets(project_id);

CREATE TABLE expenses (
    id            SERIAL PRIMARY KEY,
    budget_id     INT NOT NULL REFERENCES budgets(id) ON DELETE RESTRICT,
    user_id       INT REFERENCES users(id) ON DELETE SET NULL,
    category      expense_category NOT NULL,
    item_name     VARCHAR(200) NOT NULL,
    amount        DECIMAL(12,2) NOT NULL,
    date          DATE NOT NULL,
    status        expense_status NOT NULL DEFAULT 'pending',
    reject_reason TEXT,
    reviewed_by   INT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at   TIMESTAMP,
    created_at    TIMESTAMP NOT NULL DEFAULT now(),
    updated_at    TIMESTAMP NOT NULL DEFAULT now(),
    CHECK (amount > 0)
);
CREATE INDEX idx_expenses_budget ON expenses(budget_id);
CREATE INDEX idx_expenses_status ON expenses(status);
CREATE INDEX idx_expenses_date   ON expenses(date);

CREATE TABLE expense_receipts (
    id            SERIAL PRIMARY KEY,
    expense_id    INT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    filename      VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(100),
    storage_type  storage_type NOT NULL DEFAULT 'drive',
    file_url      VARCHAR(1000),
    filepath      VARCHAR(500),
    filesize      BIGINT,
    created_at    TIMESTAMP NOT NULL DEFAULT now(),
    CHECK (
        (storage_type = 'drive' AND file_url IS NOT NULL) OR
        (storage_type = 'nas'   AND filepath IS NOT NULL)
    )
);
CREATE INDEX idx_expense_receipts_expense ON expense_receipts(expense_id);

-- =====================================================================
-- 8. 물품 구매 신청
-- =====================================================================
CREATE TABLE purchase_requests (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    item_name       VARCHAR(200) NOT NULL,
    quantity        INT NOT NULL DEFAULT 1,
    estimated_price DECIMAL(12,2) NOT NULL,
    purchase_url    TEXT,
    reason          TEXT NOT NULL,
    status          purchase_status NOT NULL DEFAULT 'pending',
    reject_reason   TEXT,
    reviewed_by     INT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMP,
    purchased_by    INT REFERENCES users(id) ON DELETE SET NULL,
    purchased_at    TIMESTAMP,
    delivered_at    TIMESTAMP,
    expense_id      INT REFERENCES expenses(id) ON DELETE SET NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now(),
    CHECK (quantity > 0),
    CHECK (estimated_price >= 0)
);
CREATE INDEX idx_purchase_user    ON purchase_requests(user_id);
CREATE INDEX idx_purchase_status  ON purchase_requests(status);
CREATE INDEX idx_purchase_expense ON purchase_requests(expense_id);

-- =====================================================================
-- 9. 공용 비밀번호
-- =====================================================================
CREATE TABLE shared_credentials (
    id                 SERIAL PRIMARY KEY,
    title              VARCHAR(200) NOT NULL,
    category           credential_category NOT NULL,
    username           VARCHAR(255),
    password_encrypted TEXT NOT NULL,
    password_iv        VARCHAR(32) NOT NULL,
    password_auth_tag  VARCHAR(32),
    url                VARCHAR(1000),
    memo               TEXT,
    min_role           user_role NOT NULL DEFAULT 'member',
    last_rotated_at    TIMESTAMP NOT NULL DEFAULT now(),
    created_by         INT REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMP NOT NULL DEFAULT now(),
    updated_at         TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_credentials_category ON shared_credentials(category);
CREATE INDEX idx_credentials_min_role ON shared_credentials(min_role);

CREATE TABLE credential_access_logs (
    id            SERIAL PRIMARY KEY,
    credential_id INT NOT NULL REFERENCES shared_credentials(id) ON DELETE CASCADE,
    user_id       INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action        credential_action NOT NULL,
    accessed_at   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_cred_logs_credential ON credential_access_logs(credential_id);
CREATE INDEX idx_cred_logs_user       ON credential_access_logs(user_id);

-- =====================================================================
-- 10. 논문 성과 관리
-- =====================================================================
CREATE TABLE publications (
    id              SERIAL PRIMARY KEY,
    title           VARCHAR(500) NOT NULL,
    authors_text    VARCHAR(1000) NOT NULL,
    year            INT NOT NULL,
    published_date  DATE,
    pub_type        pub_type NOT NULL,
    status          pub_status NOT NULL DEFAULT 'published',
    venue           VARCHAR(500),
    doi             VARCHAR(255),
    is_public       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_publications_year ON publications(year DESC);
CREATE INDEX idx_publications_date ON publications(published_date DESC);
CREATE INDEX idx_publications_type ON publications(pub_type);
CREATE INDEX idx_publications_public ON publications(is_public);

CREATE TABLE publication_authors (
    id               SERIAL PRIMARY KEY,
    publication_id   INT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
    user_id          INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_order     INT,
    is_corresponding BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE(publication_id, user_id)
);
CREATE INDEX idx_pub_authors_pub  ON publication_authors(publication_id);
CREATE INDEX idx_pub_authors_user ON publication_authors(user_id);

CREATE TABLE publication_attachments (
    id              SERIAL PRIMARY KEY,
    publication_id  INT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
    filename        VARCHAR(255) NOT NULL,
    mime_type       VARCHAR(100),
    storage_type    storage_type NOT NULL DEFAULT 'drive',
    file_url        VARCHAR(1000),
    filepath        VARCHAR(500),
    filesize        BIGINT,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    CHECK (
        (storage_type = 'drive' AND file_url IS NOT NULL) OR
        (storage_type = 'nas'   AND filepath IS NOT NULL)
    )
);
CREATE INDEX idx_pub_attachments_pub ON publication_attachments(publication_id);

-- =====================================================================
-- (분리) 연구생 지원
-- =====================================================================
CREATE TABLE recruit_applications (
    id              SERIAL PRIMARY KEY,
    target_term     VARCHAR(50) NOT NULL,
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(255) NOT NULL,
    phone           VARCHAR(20),
    student_id      VARCHAR(50),
    department      VARCHAR(100),
    grade           VARCHAR(50),
    interest_area   TEXT,
    introduction    TEXT,
    github_url      VARCHAR(255),
    portfolio_url   VARCHAR(255),
    status          recruit_status NOT NULL DEFAULT 'pending',
    is_read         BOOLEAN NOT NULL DEFAULT false,
    internal_memo   TEXT,
    reviewed_by     INT REFERENCES users(id) ON DELETE SET NULL,
    privacy_consent BOOLEAN NOT NULL DEFAULT false,
    consent_at      TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now(),
    CHECK (privacy_consent = true)
);
CREATE INDEX idx_recruit_status  ON recruit_applications(status);
CREATE INDEX idx_recruit_term    ON recruit_applications(target_term);
CREATE INDEX idx_recruit_is_read ON recruit_applications(is_read);

CREATE TABLE recruit_application_attachments (
    id              SERIAL PRIMARY KEY,
    application_id  INT NOT NULL REFERENCES recruit_applications(id) ON DELETE CASCADE,
    filename        VARCHAR(255) NOT NULL,
    mime_type       VARCHAR(100),
    storage_type    storage_type NOT NULL DEFAULT 'drive',
    file_url        VARCHAR(1000),
    filepath        VARCHAR(500),
    filesize        BIGINT,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    CHECK (
        (storage_type = 'drive' AND file_url IS NOT NULL) OR
        (storage_type = 'nas'   AND filepath IS NOT NULL)
    )
);
CREATE INDEX idx_recruit_attachments_app ON recruit_application_attachments(application_id);

-- =====================================================================
-- 11. 파일 공유
-- =====================================================================
CREATE TABLE shared_files (
    id              SERIAL PRIMARY KEY,
    uploaded_by     INT REFERENCES users(id) ON DELETE SET NULL,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    category        file_category NOT NULL,
    min_role        user_role NOT NULL DEFAULT 'member',
    filename        VARCHAR(255) NOT NULL,
    mime_type       VARCHAR(100),
    storage_type    storage_type NOT NULL DEFAULT 'drive',
    file_url        VARCHAR(1000),
    filepath        VARCHAR(500),
    filesize        BIGINT,
    version         INT NOT NULL DEFAULT 1,
    download_count  INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP NOT NULL DEFAULT now(),
    CHECK (
        (storage_type = 'drive' AND file_url IS NOT NULL) OR
        (storage_type = 'nas'   AND filepath IS NOT NULL)
    )
);
CREATE INDEX idx_shared_files_category ON shared_files(category);
CREATE INDEX idx_shared_files_min_role ON shared_files(min_role);
CREATE INDEX idx_shared_files_uploader ON shared_files(uploaded_by);

-- =====================================================================
-- 12. 시스템 알림
-- =====================================================================
CREATE TABLE notifications (
    id            SERIAL PRIMARY KEY,
    user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type          notification_type NOT NULL,
    title         VARCHAR(200) NOT NULL,
    message       TEXT NOT NULL,
    related_type  VARCHAR(50),
    related_id    INT,
    is_read       BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created   ON notifications(created_at DESC);