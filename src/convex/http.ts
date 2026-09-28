import { httpRouter } from "convex/server";
import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS }));

const health = httpAction(async () =>
  json({ status: "ok", service: "cloudsweep-api", time: Date.now() }),
);

const scan = httpAction(async (ctx) => json(await ctx.runQuery(api.s3.scan, {})));

const rules = httpAction(async (ctx) => json(await ctx.runQuery(api.s3.generateRules, {})));

http.route({ path: "/health", method: "GET", handler: health });
http.route({ path: "/health", method: "OPTIONS", handler: preflight });
http.route({ path: "/s3/scan", method: "GET", handler: scan });
http.route({ path: "/s3/scan", method: "OPTIONS", handler: preflight });
http.route({ path: "/s3/rules", method: "GET", handler: rules });
http.route({ path: "/s3/rules", method: "OPTIONS", handler: preflight });

export default http;
