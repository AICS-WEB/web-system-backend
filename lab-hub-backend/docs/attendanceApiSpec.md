# AICS Lab Central System - Attendance API Specification

본 문서는 연구원들의 일일 출결(체크인/체크아웃) 처리 및 연구실 내부 IP 검증 알고리즘에 대한 백엔드 명세서입니다.

---

## 1. 출근 체크인 (Check-In)
- **Method:** `POST`
- **Endpoint:** `/api/attendance/check-in`
- **Content-Type:** `application/json`
- **Auth Required:** `True` (Bearer Token 필수 - 일반 연구원 이상)

### 1.1. 비즈니스 로직 및 예외 처리 알고리즘
1. **연구실 IP 대조 검증 (IP Access Control):**
   - 클라이언트의 요청 IP(`req.ip` 또는 `X-Forwarded-For`)를 확인하여, 연구실 내부 공인 IP 주소와 일치하는지 검사합니다.
   - **반환 에러:** `403 Forbidden` | `{"status": "error", "message": "연구실 외부에서는 출근 체크가 불가능합니다."}`

2. **당일 중복 출근 방지 (Duplicate Check):**
   - `attendance` 테이블에서 `user_id`와 현재 날짜(`current_date`)로 이미 생성된 레코드가 있는지 복합키 무결성을 검사합니다.
   - **반환 에러:** `409 Conflict` | `{"status": "error", "message": "오늘 이미 출근 체크를 완료하셨습니다."}`

3. **지각 여부 판별 (Late Decision Logic):**
   - 체크인 수행 시각이 연구실 규정 시각(예: 오전 09:00:00)을 초과했는지 비교 연산합니다.
   - **결과 매핑:** - 09:00 이전: `status = 'present'` (정상 출근)
     - 09:00 이후: `status = 'late'` (지각)

---

## 2. 퇴근 체크아웃 (Check-Out)
- **Method:** `POST`
- **Endpoint:** `/api/attendance/check-out`
- **Auth Required:** `True`

### 2.1. 비즈니스 로직 및 예외 처리 알고리즘
1. **출근 기록 존재 여부 검증 (Pre-requisite Check):**
   - 당일 날짜로 된 해당 유저의 출근 레코드(`check_in`이 존재하고 `check_out`이 NULL인 레코드)를 먼저 조회합니다.
   - **반환 에러:** `404 Not Found` | `{"status": "error", "message": "오늘 출근한 기록이 존재하지 않아 퇴근 처리가 불가능합니다."}`

2. **퇴근 데이터 업데이트 (Atomic Update):**
   - 해당 레코드의 `check_out` 컬럼에 현재 `TIMESTAMP`를 주입하여 갱신합니다.

---