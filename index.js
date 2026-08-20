import "dotenv/config"; // 1. Added at the top to load .env variables locally
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { MongoClient } from "mongodb";
import { z } from "zod";

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Initialize MongoDB Connection
const MONGO_URI = process.env.MONGODB_URI;

// 2. Added safety check to catch missing environment variables before connecting
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

// Active connection session tracker
const transports = new Map();

// 3. SSE Connection Route
app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  const server = createMcpServer(); // Create unique server instance for this session

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});