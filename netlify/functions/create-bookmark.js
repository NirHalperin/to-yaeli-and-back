export async function handler(event) {
  console.log("DEBUG EVENT:", event);

  const params = event.queryStringParameters || {};
  const url = params.url;

  if (!url) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        error: "missing_query",
        received: params
      })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      url
    })
  };
}