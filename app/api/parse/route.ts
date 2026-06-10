import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;

    // 키 앞 10자만 로그 (보안)
    console.log('API KEY 확인:', apiKey ? apiKey.substring(0,15)+'...' : 'KEY 없음!');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: `"${text}" 에서 화물 치수만 추출해서 JSON 배열로 반환. 예: [{"length":50,"width":50,"height":50,"quantity":1,"name":"","noStack":false,"noTopLoad":false,"stackGroup":""}]` }],
      }),
    });

    const data = await response.json();
    console.log('Anthropic 상태:', response.status);
    console.log('Anthropic 응답 전체:', JSON.stringify(data).substring(0,200));

    if(data.error) {
      return NextResponse.json({ error: data.error.message, result: '[]' });
    }

    const content = data.content?.[0]?.text || '[]';
    return NextResponse.json({ result: content });

  } catch (err) {
    console.error('route 에러:', err);
    return NextResponse.json({ error: String(err), result: '[]' });
  }
}
