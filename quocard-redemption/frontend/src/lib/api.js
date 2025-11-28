const API_BASE_URL = process.env.NEXT_PUBLIC_LAMBDA_ENDPOINT || '';

export async function verifyStaffAuth(authString) {
    const response = await fetch(`${API_BASE_URL}/verify-auth`, {
        method: 'POST',  // GETからPOSTに変更
        headers: {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/json'
        }
    });
    return response.ok;
}

export async function verifyCode(authString, code, action) {
    const response = await fetch(`${API_BASE_URL}/verify-code`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code, action })
    });
    return response.json();
}