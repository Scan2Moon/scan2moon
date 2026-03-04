let stats = {
  visits: 0,
  scans: 0,
  shares: 0,
  moon: 0,
};

export default async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  try {
    if (req.method === "POST") {
      let body = {};
      try {
        body = await req.json();
      } catch (e) {}

      const type = body.type;

      if (type === "visit") stats.visits = (stats.visits || 0) + 1;
      else if (type === "scan") stats.scans = (stats.scans || 0) + 1;
      else if (type === "share") stats.shares = (stats.shares || 0) + 1;
      else if (type === "moon") stats.moon = (stats.moon || 0) + 1;
    }

    return new Response(JSON.stringify(stats), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Stats function error:", error);
    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
};