# AICS Lab Central System - Notice & Attachment API Specification

본 문서는 연구원 대상 주요 소식 전파, 상단 고정 제어, 그리고 NAS/Drive 하이브리드 첨부파일 스토리지 무결성 검증을 위한 백엔드 API 명세서입니다.

---

## 1. 공지사항 작성 및 첨부파일 등록 (Create Notice)
- **Method:** `POST`
- **Endpoint:** `/api/notices`
- **Content-Type:** `application/json`
- **Auth Required:** `True` (Bearer Token 필수 - 기장/랩장 및 교수 권한 가드 배포)

### 1.1. Request Body JSON 스펙 (DTO)
```json
{
  "title": "2026년도 하반기 AI융합소프트웨어 연구실 안전수칙 지침 수령의 건",
  "content": "안녕하세요. 랩장입니다. 연구실 안전사고 예방을 위한 지침서 파일 및 드라이브 링크를 공유합니다...",
  "category": "important",
  "isPinned": true,
  "attachments": [
    {
      "filename": "2026_연구실_안전수칙.pdf",
      "mimeType": "application/pdf",
      "storageType": "nas",
      "filepath": "/var/nas/documents/2026_safety_guide.pdf",
      "fileUrl": null,
      "filesize": 2048576
    }
  ]
}