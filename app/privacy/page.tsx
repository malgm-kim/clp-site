export default function Privacy() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '60px 24px', fontFamily: '-apple-system, sans-serif', color: '#1c1917', lineHeight: 1.8 }}>
      <a href="/" style={{ color: '#78716c', fontSize: 14, textDecoration: 'none' }}>← CLP Studio로 돌아가기</a>

      <h1 style={{ fontSize: 28, fontWeight: 800, marginTop: 32, marginBottom: 8 }}>개인정보처리방침</h1>
      <p style={{ color: '#78716c', fontSize: 14, marginBottom: 40 }}>최종 수정일: 2025년 6월 1일</p>

      {[
        {
          title: '1. 수집하는 개인정보',
          content: 'CLP Studio는 서비스 이용을 위해 아이디(내부적으로 이메일 형식으로 저장)와 비밀번호를 수집합니다. 화물 적재 계산에 입력하신 데이터(화물 사이즈, 수량 등)는 사용자의 선택에 따라 저장됩니다.',
        },
        {
          title: '2. 개인정보 이용 목적',
          content: '수집된 정보는 로그인 및 CLP 기록 저장·조회 서비스 제공을 위해서만 사용됩니다. 마케팅 목적의 활용이나 제3자 제공은 하지 않습니다.',
        },
        {
          title: '3. 개인정보 보유 기간',
          content: '회원 탈퇴 시까지 보유합니다. 탈퇴를 원하실 경우 서비스 내 계정 삭제 또는 이메일로 요청하시면 즉시 삭제해드립니다.',
        },
        {
          title: '4. 개인정보 보호 조치',
          content: 'Supabase의 보안 인프라를 통해 데이터를 안전하게 보호합니다. 비밀번호는 암호화되어 저장되며, 평문으로 저장되지 않습니다.',
        },
        {
          title: '5. 쿠키 및 광고',
          content: '본 서비스는 Google AdSense를 통한 광고를 게재할 수 있으며, 이 과정에서 Google이 쿠키를 사용할 수 있습니다. Google의 개인정보처리방침은 https://policies.google.com/privacy 에서 확인하실 수 있습니다.',
        },
        {
          title: '6. 문의',
          content: '개인정보 관련 문의사항은 서비스 내 문의 기능을 통해 연락해 주시기 바랍니다.',
        },
      ].map(section => (
        <div key={section.title} style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: '#1c1917' }}>{section.title}</h2>
          <p style={{ fontSize: 15, color: '#57534e', margin: 0 }}>{section.content}</p>
        </div>
      ))}

      <div style={{ marginTop: 60, padding: '24px', background: '#f5f5f4', borderRadius: 12, fontSize: 13, color: '#78716c' }}>
        본 방침은 2025년 6월 1일부터 적용됩니다.
      </div>
    </div>
  );
}
