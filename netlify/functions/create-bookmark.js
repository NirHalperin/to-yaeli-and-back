export async function handler(event) {
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
fetch('/api/bookmark?url=' + encodeURIComponent(window.location.href))
  .then(res => res.json())
  .then(data => console.log('API response:', data));