# AICS Lab Central System - Leave Management API Specification

본 문서는 연구원들의 연도별 휴가 부여량 조회, 휴가 신청, 그리고 관리자 승인/반려에 따른 워크플로우를 정의한 백엔드 API 명세서입니다.

---

## 1. 휴가 신청 기안 (Create Leave Request)
- **Method:** `POST`
- **Endpoint:** `/api/leave/requests`
- **Content-Type:** `application/json`
- **Auth Required:** `True` (Bearer Token 필수 - 일반 연구원 이상)

### 1.1. Request Body JSON 스펙 (DTO)
```json
{
  "leaveType": "half",
  "halfPeriod": "pm",
  "startDate": "2026-07-15",
  "endDate": "2026-07-15",
  "reason": "개인 사유로 인한 오후 반차 신청합니다."
}