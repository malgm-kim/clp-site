import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { text } = await req.json();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `다음 텍스트에서 화물 정보를 추출해서 JSON 배열만 반환해. 다른 텍스트 절대 쓰지 마.

파싱 규칙:
- W=폭(width), L=길이(length), H=높이(height) 레이블이 있으면 그에 맞게 매핑
- 쉼표가 포함된 숫자는 천단위 구분자임 (예: 1,100 → 1100)
- Pallet, Pallets, EA, BOX, 박스, 개 등은 수량 단위로 인식
- 화물 치수가 아닌 텍스트(금액, 써차지, 운임, 불, USD 등)는 완전히 무시

단위 변환 규칙:
- 소수점 있으면 M → ×100 해서 CM으로
- 1000 이상이면 MM → ÷10 해서 CM으로
- 나머지는 컨테이너 물리적 한계로 판단:
  컨테이너 최대 폭 235cm, 높이 269cm
  변환 후 하나라도 235 초과하면 MM → ÷10 재적용
  예: 500*500*500 → 500>235 → MM → 50*50*50
  예: 3070*600*570 → 3070>235 → MM → 307*60*57
  예: 120*80*100 → 모두 235 이하 → CM 그대로

적재 옵션:
- "다단불가", "다단금지", "no stack" → noStack: true
- "상단적재", "상단만", "위에못올림" → noTopLoad: true
- "자체다단A", "자체다단 A" → stackGroup: "A"
- 품명이 있으면 name에 저장
- 옵션 없으면 noStack: false, noTopLoad: false, stackGroup: ""

출력 키: length, width, height, quantity, name, noStack, noTopLoad, stackGroup

입력: ${text}

출력 예시: [{"length":50,"width":50,"height":50,"quantity":1,"name":"","noStack":false,"noTopLoad":false,"stackGroup":""}]`,
        },
      ],
    }),
  });

  const data = await response.json();
  const content = data.content?.[0]?.text || '[]';
  return NextResponse.json({ result: content });
}
