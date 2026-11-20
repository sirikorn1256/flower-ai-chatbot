/**
 * Cloudflare Worker for PIM Flower Studio RAG Chatbot
 * ทำหน้าที่เป็น Serverless Proxy ถือกุญแจ OPENROUTER_KEY ไว้ฝั่งเซิร์ฟเวอร์
 * เพื่อความปลอดภัยสูงสุด ป้องกัน API Key รั่วไหล
 */

// โดเมนที่อนุญาตให้เรียกใช้งาน Worker (CORS)
// แก้ไขเพิ่ม URL ของ GitHub Pages ของตนเอง เช่น "https://username.github.io"
const ALLOWED = [
  "https://pimflower.github.io",
  "https://github.io",
  "http://localhost:8000",
  "http://localhost:5500",
  "http://localhost:3000",
  "http://127.0.0.1:8000",
  "http://127.0.0.1:5500"
];

// OpenRouter API Base URL
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";

    // ตรวจสอบ CORS Origin (อนุญาต localhost, 127.0.0.1, โดเมนที่อยู่ใน ALLOWED หรือ GitHub Pages)
    const isAllowedOrigin = ALLOWED.some(allowed => 
      origin.toLowerCase().startsWith(allowed.toLowerCase()) || 
      origin.toLowerCase().endsWith(".github.io") ||
      origin.includes("localhost") || 
      origin.includes("127.0.0.1")
    );

    const corsHeaders = {
      "Access-Control-Allow-Origin": isAllowedOrigin && origin ? origin : "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Title",
      "Access-Control-Max-Age": "86400",
    };

    // จัดการ CORS Preflight (OPTIONS request)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);

    // 1. หน้าทดสอบสถานะ Worker (ตามคู่มือ ตอนที่ 4 ขั้นที่ 2.4)
    // เมื่อเปิดลิงก์ Worker ตรงๆ ในเบราว์เซอร์ จะตอบกลับ {"status":"ok","hasKey":true}
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
      const hasKey = Boolean(env.OPENROUTER_KEY && env.OPENROUTER_KEY.trim() !== "");
      return new Response(
        JSON.stringify({
          status: "ok",
          hasKey: hasKey,
          message: hasKey 
            ? "PIM Flower Studio Worker is ready! (Key is configured)" 
            : "Worker is running, but OPENROUTER_KEY secret is not set yet in Cloudflare Settings."
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...corsHeaders,
          },
        }
      );
    }

    // ตรวจสอบว่ามี OPENROUTER_KEY ใน Environment Variables / Secrets หรือไม่
    if (!env.OPENROUTER_KEY) {
      return new Response(
        JSON.stringify({
          error: "OPENROUTER_KEY secret is missing. Please set it in Cloudflare Worker Settings > Variables and Secrets."
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...corsHeaders,
          },
        }
      );
    }

    // 2. ส่งต่อคำขอไปยัง OpenRouter (Proxy POST requests)
    if (request.method === "POST") {
      try {
        const body = await request.text();

        // ระบุปลายทาง: chat/completions หรือ embeddings
        let targetEndpoint = `${OPENROUTER_BASE_URL}/chat/completions`;
        if (url.pathname.includes("/embeddings") || url.pathname.endsWith("/embeddings")) {
          targetEndpoint = `${OPENROUTER_BASE_URL}/embeddings`;
        } else if (url.pathname.includes("/chat/completions")) {
          targetEndpoint = `${OPENROUTER_BASE_URL}/chat/completions`;
        }

        const openRouterResponse = await fetch(targetEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.OPENROUTER_KEY}`,
            "HTTP-Referer": origin || "https://pimflower.github.io",
            "X-Title": "PIM Flower Studio RAG Chatbot",
          },
          body: body,
        });

        const responseData = await openRouterResponse.text();

        return new Response(responseData, {
          status: openRouterResponse.status,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...corsHeaders,
          },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Worker Proxy Error", details: err.message }),
          {
            status: 502,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              ...corsHeaders,
            },
          }
        );
      }
    }

    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  },
};
