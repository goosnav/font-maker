export default {
  async fetch(
    request: Request,
    env: { ASSETS: { fetch: (r: Request) => Promise<Response> } },
  ): Promise<Response> {
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    // OpenCV's packaged embind wrapper generates functions. Limit this permission to its worker.
    if (new URL(request.url).pathname === "/engine/scan.worker.js")
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self'; object-src 'none'",
      );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
