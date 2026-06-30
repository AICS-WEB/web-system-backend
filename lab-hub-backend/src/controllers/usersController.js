/**
 * @file usersController.js
 * @description 사용자 회원가입 및 프로필 관리에 대한 비즈니스 로직을 제어하는 컨트롤러 레이어입니다.
 */

const UsersModel = require('../models/usersModel'); // 유저 DB 질의를 담당할 모델 모듈을 로드합니다.
const BcryptUtils = require('../utils/bcryptUtils'); // 우리가 만든 암호화 유틸을 불러옵니다.

const UsersController = {
  /**
   * @function registerUser
   * @description 신규 회원가입 요청을 처리합니다. 유효성 검사 후 비밀번호를 해싱하여 DB에 승인 대기(pending) 상태로 저장합니다.
   */
  registerUser: async (req, res) => {
    try {
      const {
        email, password, name, studentId, department,
        program, enrollmentYear, researchTopic, phone, bio, githubUrl, linkedinUrl
      } = req.body;

      // [알고리즘 1단계] 필수 입력 파라미터 누락 여부를 검증합니다. (Null Check)
      if (!email || !password || !name || !studentId || !department || !program || !enrollmentYear) {
        return res.status(400).json({
          status: 'error',
          message: '필수 입력 항목이 누락되었습니다.'
        });
      }

      // [알고리즘 2단계] 비밀번호의 최소 강도를 검증합니다. (8자 이상 제약 조건)
      if (password.length < 8) {
        return res.status(400).json({
          status: 'error',
          message: '비밀번호는 최소 8자 이상이어야 합니다.'
        });
      }

      // [알고리즘 3단계] 데이터베이스 무결성을 위해 이메일 중복 여부를 1차로 조회합니다.
      const existingUserByEmail = await UsersModel.findByEmail(email);
      if (existingUserByEmail) {
        return res.status(409).json({
          status: 'error',
          message: '이미 가입 신청되었거나 사용 중인 이메일 주소입니다.'
        });
      }

      // [알고리즘 4단계] 학번(student_id) UNIQUE 제약조건 충돌을 방어합니다.
      const existingUserByStudentId = await UsersModel.findByStudentId(studentId);
      if (existingUserByStudentId) {
        return res.status(409).json({
          status: 'error',
          message: '이미 등록된 학번(사번)입니다.'
        });
      }

      // [알고리즘 5단계] 보안 무결성을 위해 평문 비밀번호를 Bcrypt 단방향 해시 암호화합니다.
      const passwordHash = await BcryptUtils.hashPassword(password);

      // [알고리즘 6단계] 정제된 DTO 객체를 구성하여 Model 레이어를 통해 DB에 삽입 연산을 단행합니다.
      const newUser = await UsersModel.createPendingUser({
        email,
        passwordHash, // 암호화된 해시값을 바인딩합니다.
        name,
        studentId,
        department,
        program,
        enrollmentYear,
        researchTopic,
        phone,
        bio,
        githubUrl,
        linkedinUrl
      });

      // [알고리즘 7단계] 성공 시 가입 대기 상태 응답을 클라이언트에게 반환합니다.
      return res.status(201).json({
        status: 'success',
        message: 'AICS Lab 회원가입 신청이 완료되었습니다. 관리자(교수님/랩장) 승인 후 로그인이 가능합니다.',
        data: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          account_status: newUser.account_status,
          created_at: newUser.created_at
        }
      });

    } catch (error) {
      console.error('회원가입 비즈니스 로직 수행 중 치명적 예외 발생:', error);
      return res.status(500).json({
        status: 'error',
        message: '서버 내부 오류로 인해 회원가입 처리에 실패했습니다.'
      });
    }
  }
};

module.exports = UsersController;