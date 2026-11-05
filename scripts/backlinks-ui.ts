import { createDashboard } from "./backlinks/ui/server.js";

const args = process.argv.slice(2);
const port = args.length === 0 ? 4310 : args.length === 2 && args[0] === "--port" && /^\d+$/.test(args[1]) ? Number(args[1]) : NaN;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Usage: npm run backlinks:ui -- [--port 4310]");
  process.exitCode = 1;
} else {
  const server = createDashboard();
  server.on("error", error => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => console.log("http://127.0.0.1:" + port));
}
