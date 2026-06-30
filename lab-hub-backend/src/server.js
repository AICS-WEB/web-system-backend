/**
 * @file server.js
 * @description Express 앱을 실제 네트워크 포트에 바인딩하여 HTTP 서버로 기동하는 부트스트랩 파일입니다.
 */

require('dotenv').config(); // .env 파일의 환경 변수를 process.env에 로드합니다.
const app = require('./app'); // 미들웨어와 라우터가 구성된 Express 앱 인스턴스를 가져옵니다.

// 환경 변수 PORT가 정의되어 있지 않을 경우 기본값 4000을 사용합니다.
const PORT = process.env.PORT || 4000;

// 지정된 포트에서 HTTP 서버를 기동합니다.
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}.`);
});
