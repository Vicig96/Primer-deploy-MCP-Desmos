import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const widgetHtml = readFileSync("public/graph-widget.html", "utf8");

function createGraphServer() {
  const server = new McpServer({ name: "desmos-graph-app", version: "0.1.0" });

  registerAppResource(
    server,
    "graph-widget",
    "ui://widget/graph.html",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://widget/graph.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: {
            "openai/widgetDescription": "Muestra una gráfica interactiva con Desmos.",
            "openai/widgetPrefersBorder": true,
            "openai/widgetCSP": {
              resource_domains: ["https://www.desmos.com"]
            }
          }
        }
      ]
    })
  );

  registerAppTool(
    server,
    "graph_expression",
    {
      title: "Graficar expresión",
      description: "Muestra una función o ecuación en Desmos dentro del chat.",
      inputSchema: {
        latex: z.string().min(1)
      },
      _meta: {
        ui: { resourceUri: "ui://widget/graph.html" }
      }
    },
    async (args) => {
      const latex = args?.latex?.trim?.() || "y=x^2";

      return {
        content: [
          {
            type: "text",
            text: `Mostrando la gráfica de ${latex}`
          }
        ],
        structuredContent: {
          latex
        }
      };
    }
  );

  return server;
}

const port = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
  const requestedHeaders = req.headers["access-control-request-headers"];

  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      requestedHeaders ||
      "content-type, accept, mcp-session-id, mcp-protocol-version, authorization",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
    "Access-Control-Max-Age": "86400",
  });
  res.end();
  return;
}

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain" }).end("Desmos MCP server");
    return;
  }

  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);

    if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
     "content-type, accept, mcp-session-id, mcp-protocol-version, authorization"
     );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, MCP-Protocol-Version");

    const server = createGraphServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => {
  console.log(`Desmos MCP server listening on http://localhost:${port}${MCP_PATH}`);
});