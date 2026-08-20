import "dotenv/config";
import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { MongoClient } from "mongodb";
import { z } from "zod";

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing required for cloud agents
app.use(cors());
app.use(express.json());

// Root Health Check Route (Fixes "Cannot GET /" and Zia base-URL validation)
app.get("/", (req, res) => {
  res.status(200).send("MongoDB MCP Server is running.");
});

// 1. Initialize MongoDB Connection
const MONGO_URI = process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error("Error: MONGODB_URI environment variable is missing.");
  process.exit(1);
}

const client = new MongoClient(MONGO_URI);
await client.connect();
const db = client.db();

// 2. Factory function to generate a fresh McpServer per session
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
  const transport = new SSEServerTransport("/messages", res);
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
    await transport.handlePostMessage(req, res, req.body);
  } else {
    res.status(400).json({ error: "Session not found or expired" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});