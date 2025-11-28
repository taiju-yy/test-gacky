import { NextResponse } from 'next/server';

export async function POST(request) {
  const authHeader = request.headers.get('authorization');
  const body = await request.json();

  // Lambda関数のエンドポイントにリクエストを転送
  const response = await fetch(process.env.LAMBDA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  return NextResponse.json(data);
}