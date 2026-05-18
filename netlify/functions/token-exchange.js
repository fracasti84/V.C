exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { code, code_verifier, redirect_uri } = JSON.parse(event.body);

    const response = await fetch("https://auth.deriv.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "33j3KnddANLxl1PUwgCYq",
        code,
        code_verifier,
        redirect_uri
      }).toString()
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "https://moneymekapro.com/callback"
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "token_exchange_failed", message: err.message })
    };
  }
};
