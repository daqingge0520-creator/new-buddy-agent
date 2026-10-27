import { selectModelMode } from "./model.js";
import { startApp } from "./server.js";

const env = process.env;
const mode = selectModelMode(env);
const app = await startApp({ env });
console.log(`buddy-agent listening on ${app.baseUrl} mode=${mode}`);
console.log("POST /v1/chat  Authorization: Bearer <BUDDY_API_TOKEN or demo>");
