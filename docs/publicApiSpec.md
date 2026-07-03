1. 외부 홈페이지 도메인별 데이터베이스(DDL) 설계도

-- 1. [Users 확장 및 조건절] 기존 users 테이블이 있다면 아래 컬럼들이 반영되어 있는지 확인하거나 추가합니다.
-- 프론트엔드가 요청한 '사진, 이름, 학년, 학번, 졸업생 여부'가 모두 포함된 구조입니다.
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_alumni BOOLEAN DEFAULT false NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_public_profile BOOLEAN DEFAULT false NOT NULL;

-- 2. [논문 테이블] 사진, 제목, 부제목, 학회 이름, 논문 링크 명세
CREATE TABLE lab_publications (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    subtitle VARCHAR(255),
    conference_name VARCHAR(255) NOT NULL,
    publication_date DATE,
    paper_link VARCHAR(255),
    image_url VARCHAR(255), -- 논문 썸네일 또는 그래픽 초록 이미지
    created_at TIMESTAMP DEFAULT now() NOT NULL
);

-- 3. [다른 랩실 / 파트너 테이블] 파트너 대학 이미지, 링크, 랩실 이름 명세
CREATE TABLE partner_labs (
    id SERIAL PRIMARY KEY,
    lab_name VARCHAR(255) NOT NULL,
    university_name VARCHAR(255) NOT NULL,
    partner_link VARCHAR(255),
    logo_image_url VARCHAR(255), -- 파트너 대학/기관 로고 이미지
    created_at TIMESTAMP DEFAULT now() NOT NULL
);

-- 4. [교수 정보 테이블] 이름, 사진, 이메일, 경력, 시간표 명세
-- 논문(Publication)은 위의 'lab_publications' 테이블과 조인(Join)하거나 외래키로 매핑하여 재활용 가능하도록 유연성을 확보합니다.
CREATE TABLE professor_profile (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    profile_image_url VARCHAR(255),
    career_history TEXT, -- 경력 사항 (예: '2011 ~ 현재: 순천향대학교 교수')
    timetable_image_url VARCHAR(255), -- 교수님 오피스 아워 / 시간표 이미지 링크
    updated_at TIMESTAMP DEFAULT now() NOT NULL
);

-- 5. [이벤트 테이블] 날짜, 이름, 부연 설명, 이미지 명세
CREATE TABLE lab_events (
    id SERIAL PRIMARY KEY,
    event_name VARCHAR(255) NOT NULL,
    event_date DATE NOT NULL,
    description TEXT, -- 부연 설명
    event_image_url VARCHAR(255), -- 이벤트 현장 사진 또는 포스터 이미지
    created_at TIMESTAMP DEFAULT now() NOT NULL
);

2. 프론트엔드 공유용 API 명세 및 JSON 프로토콜

① 구성원(재학생 및 졸업생) 목록 조회 (GET /api/public/members)
특징: 개인정보 보호 및 외부 악성 스크랩 방지를 위해 비밀번호 해시, 전화번호 등은 전면 제외하고 is_public_profile = true인 구성원만 안전하게 필터링하여 반환합니다. 학번은 프론트엔드 노출 규칙에 맞춰 앞 2자리 기수(예: "21학번")로 가공하여 전달하기 용이하도록 정형화합니다.

{
  "success": true,
  "data": {
    "current_students": [
      {
        "name": "이현준",
        "student_id_prefix": "21학번",
        "program": "undergrad",
        "department": "컴퓨터소프트웨어공학과",
        "profile_image": "/uploads/profiles/dlgus.png"
      }
    ],
    "alumni": [
      {
        "name": "홍길동",
        "student_id_prefix": "18학번",
        "program": "master",
        "department": "컴퓨터소프트웨어공학과",
        "profile_image": "/uploads/profiles/alumni_hong.png"
      }
    ]
  }
}

② 연구실 논문 실적 목록 조회 (GET /api/public/publications)

{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "Deep Learning Based Object Detection in Traffic Simulation",
      "subtitle": "A SUMO and YOLO Convergence Approach",
      "conference_name": "IEEE International Conference on AI 2026",
      "paper_link": "https://ieeexplore.ieee.org/document/example",
      "image_url": "/uploads/papers/paper_thumb_01.png"
    }
  ]
}

③ 파트너 및 협력 랩실 현황 조회 (GET /api/public/partners)

{
  "success": true,
  "data": [
    {
      "id": 1,
      "lab_name": "오픈 오아시스 교통 연구소",
      "university_name": "한국도로공사 협력단",
      "partner_link": "https://www.ex.co.kr",
      "logo_image_url": "/uploads/partners/ex_logo.png"
    }
  ]
}

④ 지도 교수 프로필 정보 조회 (GET /api/public/professor)

{
  "success": true,
  "data": {
    "name": "홍길동 교수",
    "email": "professor@sch.ac.kr",
    "profile_image_url": "/uploads/professor/main.png",
    "career_history": "2011 ~ 현재: 순천향대학교 컴퓨터소프트웨어공학과 교수\n2005 ~ 2010: AI 국책연구소 수석연구원",
    "timetable_image_url": "/uploads/professor/timetable_2026_01.png"
  }
}

⑤ 연구실 주요 이벤트/행사 조회 (GET /api/public/events)

{
  "success": true,
  "data": [
    {
      "id": 1,
      "event_name": "2026년도 1학기 딥러닝 학술 세미나 완료",
      "event_date": "2026-06-15",
      "description": "학부 4학년 및 석사 과정 연구원들이 참여한 컴퓨터 비전 기반 포즈 에스티메이션 연구 성과 발표회입니다.",
      "event_image_url": "/uploads/events/seminar_2026.png"
    }
  ]
}