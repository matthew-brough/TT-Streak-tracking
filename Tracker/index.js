import path from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { MongoClient } from "mongodb";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.APP_PORT || 8000);
const HOST = "0.0.0.0";
const USERAPP_DIR = path.join(__dirname, "userapp");

const MONGO_URL = process.env.MONGO_URL;

const MONGO_DB = process.env.MONGO_DB;
const MONGO_COLLECTION = "streak_events";

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const WEBHOOK_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS || 5000);

const mongoClient = new MongoClient(MONGO_URL);

const app = Fastify({
  logger: true,
});

function normalizePayload(body) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be a JSON object");
  }

  const userId = Number(body.user_id);
  const streakName =
    typeof body.streak_name === "string" ? body.streak_name.trim() : "";
  const streakValue = Number(body.streak_value);
  const timestamp = new Date(body.timestamp);

  if (!Number.isInteger(userId)) {
    throw new Error("user_id must be an integer");
  }

  if (!streakName) {
    throw new Error("streak_name must be a non-empty string");
  }

  if (!Number.isInteger(streakValue)) {
    throw new Error("streak_value must be an integer");
  }

  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("timestamp must be a valid date/time");
  }

  return {
    user_id: userId,
    streak_name: streakName.toLowerCase(),
    streak_value: streakValue,
    timestamp,
  };
}

async function postWebhook(payload) {
  if (!WEBHOOK_URL) {
    return { skipped: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const responseText = await response.text().catch(() => "");

    return {
      skipped: false,
      ok: response.ok,
      status: response.status,
      response_text: responseText.slice(0, 1000),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildApp() {
  await mongoClient.connect();

  const db = mongoClient.db(MONGO_DB);
  const streakEvents = db.collection(MONGO_COLLECTION);

  await streakEvents.createIndex({ user_id: 1, streak_name: 1, timestamp: -1 });
  await streakEvents.createIndex({ user_id: 1, timestamp: -1 });
  await streakEvents.createIndex({ received_at: -1 });

  await app.register(fastifyStatic, {
    root: USERAPP_DIR,
    prefix: "/static",
  });

  app.get("/healthz", async () => {
    return { ok: true };
  });

  app.get("/", async (request, reply) => {
    return reply.sendFile("streaks.html");
  });

  app.post(
    "/api/streak",
    {
      schema: {
        body: {
          type: "object",
          required: ["user_id", "streak_name", "streak_value", "timestamp"],
          additionalProperties: true,
          properties: {
            user_id: { type: "integer" },
            streak_name: { type: "string", minLength: 1 },
            streak_value: { type: "integer" },
            timestamp: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      let normalized;

      try {
        normalized = normalizePayload(request.body);
      } catch (err) {
        request.log.warn({ err }, "Invalid streak payload");
        return reply.code(400).send({
          ok: false,
          error: err.message,
        });
      }

      // Check if the latest event for this user and streak_name has the same value
      const latest = await streakEvents.findOne(
        { user_id: normalized.user_id, streak_name: normalized.streak_name },
        { sort: { timestamp: -1 } }
      );

      if (latest && latest.streak_value === normalized.streak_value) {
        // No change, do not insert
        return reply.code(202).send({
          ok: true,
          skipped: true,
          reason: "No change in streak value",
        });
      }

      const storedDoc = {
        ...normalized,
        received_at: new Date(),
      };

      const insertResult = await streakEvents.insertOne(storedDoc);

      let webhookResult;
      try {
        webhookResult = await postWebhook({
          content: `**${storedDoc.streak_name}** streak updated to **${storedDoc.streak_value}** (user ${storedDoc.user_id})`,
        });
      } catch (err) {
        request.log.error({ err }, "Webhook delivery failed");
        webhookResult = {
          skipped: false,
          ok: false,
          error: err.message,
        };
      }

      return reply.code(202).send({
        ok: true,
        inserted_id: insertResult.insertedId,
        webhook: webhookResult,
      });
    },
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Unhandled request error");

    if (!reply.sent) {
      reply.code(500).send({
        ok: false,
        error: "Internal server error",
      });
    }
  });

  const shutdown = async (signal) => {
    app.log.info({ signal }, "Shutting down");
    await app.close();
    await mongoClient.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await buildApp();
await app.listen({ port: PORT, host: HOST });

app.log.info(`Server running at http://${HOST}:${PORT}/`);
