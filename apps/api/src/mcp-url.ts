export function requiredUrl(value: string): URL {
  const url = new URL(value);
  const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) {
    throw new Error("MCP server URL must use HTTPS");
  }
  return url;
}
