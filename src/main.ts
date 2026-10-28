import { selectModelMode } from "./model.js";
import { startApp } from "./server.js";

const app = await startApp();
console.log(`buddy-agent listening on ${app.baseUrl} mode=${selectModelMode()}`);
console.log("POST /v1/chat  { \"content\": \"...\", \"sessionId\"?: \"...\" }");
