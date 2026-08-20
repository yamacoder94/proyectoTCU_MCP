import "dotenv/config";
import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { MongoClient } from "mongodb";
import { z } from "zod";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Health Check Route
app.get("/", (req, res) => {
  res.status(200).send("MongoDB MCP Server is running.");
});

const MONGO_URI = process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error("Error: MONGODB_URI environment variable is missing.");
  process.exit(1);
}

let db;

function createMcpServer() {
  const server = new McpServer({
    name: "MongoDB-Zia-Server",
    version: "1.0.0"
  });

  server.tool(
    "list_collections",
    "List all available collections in the database",
    {},
    async () => {
      const collections = await db.listCollections().toArray();
      const names = collections.map((c) => c.name);
      return {
        content: [{ type: "text", text: JSON.stringify(names) }]
      };
    }
  );

  server.tool(
    "query_collection",
    "Query a collection using a filter object",
    {
      collectionName: z.string().describe("The name of the target collection"),
      filter: z.record(z.any()).optional().describe("Query filter object, e.g., { status: 'active' }"),
      limit: z.number().optional().default(10).describe("Number of documents to return")
    },
    async ({ collectionName, filter = {}, limit }) => {
      const collection = db.collection(collectionName);
      const results = await collection
        .find(filter, { projection: { _id: 0 } })
        .limit(limit)
        .toArray();

      return {
        content: [{ type: "text", text: JSON.stringify(results) }]
      };
    }
  );

  return server;
}

const transports = new Map();

// 3. SSE Connection Route
app.get("/sse", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // Construct absolute HTTPS URL so Zoho knows exactly where to POST messages
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.get("host");
  const messageUrl = `${protocol}://${host}/messages`;

  const transport = new SSEServerTransport(messageUrl, res);
  const server = createMcpServer();

  transports.set(transport.sessionId, transport);

  transport.onclose = () => {
    transports.delete(transport.sessionId);
  };

  await server.connect(transport);
});

// 4. Message Endpoint Route
app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: "Session not found or expired" });
  }
});

async function start() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db();
    console.log("Connected to MongoDB successfully.");

    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("Database connection error:", error);
    process.exit(1);
  }
}

start();