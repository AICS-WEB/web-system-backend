# AICS Lab Central System - Budget & Expense API Specification

본 문서는 국책 및 민간 연구과제별 예산 총량 관리, 연구비 지출 상신, 그리고 관리자의 영수증 증빙 정산 심사 워크플로우를 정의한 백엔드 API 명세서입니다.

---

## 1. 연구비 지출 내역 상신 (Create Expense Request)
- **Method:** `POST`
- **Endpoint:** `/api/budget/expenses`
- **Content-Type:** `application/json`
- **Auth Required:** `True` (Bearer Token 필수 - 일반 연구원 이상)

### 1.1. Request Body JSON 스펙 (DTO)
```json
{
  "projectId": 2,
  "amount": 154000.0,
  "expenseType": "materials",
  "purpose": "딥러닝 서버 학습용 GPU 쿨러 및 서멀구리스 자재 구입",
  "receiptType": "nas",
  "receiptPath": "/var/nas/receipts/2026_07_01_gpu_cooler.pdf",
  "receiptUrl": null
}