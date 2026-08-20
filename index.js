import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { MongoClient } from "mongodb";
import { z } from "zod";

const app = express();
const PORT = process.env.PORT || 8000;

// 1. Initialize MongoDB Connection
const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://albertoarguello0421_db_user:aj6KsAFFw1SYSynB@cluster0.x5ygu7m.mongodb.net/proyectoTCU?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(MONGO_URI);
await client.connect();
const db = client.db();

// 2. Initialize MCP Server instance
const server = new McpServer({
  name: "MongoDB-Zia-Server",
  version: "1.0.0"
});

// 3. Register MCP Tools
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
      .find(filter, { projection: { _id: 0 } }) // Exclude _id for clean JSON
      .limit(limit)
      .toArray();

    return {
      content: [{ type: "text", text: JSON.stringify(results) }]
    };
  }
);

// 4. SSE Transport Routing (Dual-endpoint structure required for cloud clients)
let transport;

app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: "No active SSE connection found." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`SSE URL for Zia: http://localhost:${PORT}/sse`);
});