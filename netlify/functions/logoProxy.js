exports.handler = async (event) => {
  const url = event.queryStringParameters.url;
  if (!url) {
    return { statusCode: 400, body: "Missing URL" };
  }

  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") || "image/png",
        "Access-Control-Allow-Origin": "*"
      },
      body: Buffer.from(buffer).toString("base64"),
      isBase64Encoded: true
    };
  } catch (err) {
    return { statusCode: 500, body: "Failed to fetch image" };
  }
};