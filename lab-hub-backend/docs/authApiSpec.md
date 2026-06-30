# AICS Lab Central System - Authentication API Specification

본 문서는 AI융합소프트웨어 연구실(AICS Lab) 중앙 관리 시스템의 회원가입 요청 데이터 규격 및 백엔드 1차 유효성 검사(Validation) 프로세스를 정의한 현업 표준 사양서입니다.

---

## 1. 회원가입 신청 (Request Registration)
- **Method:** `POST`
- **Endpoint:** `/api/auth/register`
- **Content-Type:** `application/json`
- **Auth Required:** `False` (공개 엔드포인트)

### 1.1. Request Body JSON 스펙 (DTO 데이터 구조)
```json
{
  "email": "hyeonjun@sch.ac.kr",
  "password": "SecurePassword123!",
  "name": "이현준",
  "studentId": "20214010",
  "department": "컴퓨터소프트웨어공학과",
  "program": "undergrad",
  "enrollmentYear": 2026,
  "researchTopic": "컴퓨터 비전을 활용한 포즈 에스티메이션 알고리즘 연구",
  "phone": "010-1234-5678",
  "bio": "끊임없이 추론하고 응용하는 개발자입니다.",
  "githubUrl": "[https://github.com/hyeonjun](https://github.com/hyeonjun)",
  "linkedinUrl": null
}