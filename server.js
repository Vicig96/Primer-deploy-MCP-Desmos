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

const defaultPalette = [
  "#c74440",
  "#2d70b3",
  "#388c46",
  "#6042a6",
  "#000000",
  "#fa7e19",
  "#7f4f24",
  "#118ab2",
];

function splitLatexIntoExpressions(latexText) {
  if (!latexText || typeof latexText !== "string") {
    return [];
  }

  const raw = latexText.trim();
  if (!raw) {
    return [];
  }

  // Caso 1: separadas por salto de línea, punto y coma o comas claras
  const separators = /[\n;]+/;
  if (separators.test(raw)) {
    return raw
      .split(separators)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Caso 2: varias expresiones pegadas del tipo:
  // y=x^2-4x+3 y=2x-1
  // y=\sin(x) y=\cos(x)
  // x=2 y=x^2
  const matches = [...raw.matchAll(/(?:^|\s)((?:y|x)\s*=\s*.*?)(?=(?:\s+(?:y|x)\s*=)|$)/g)];

  if (matches.length >= 2) {
    return matches.map((m) => m[1].trim()).filter(Boolean);
  }

  // Caso 3: fallback: una sola expresión
  return [raw];
}

function normalizeExpressionsFromArgs(args) {
  let expressions = [];

  if (Array.isArray(args?.expressions) && args.expressions.length > 0) {
    expressions = args.expressions
      .filter((expr) => expr && typeof expr.latex === "string" && expr.latex.trim())
      .map((expr, index) => ({
        id: expr.id || `expr_${index + 1}`,
        latex: expr.latex.trim(),
        color: expr.color || defaultPalette[index % defaultPalette.length],
        hidden: Boolean(expr.hidden),
      }));
  } else if (typeof args?.latex === "string" && args.latex.trim()) {
    const splitExpressions = splitLatexIntoExpressions(args.latex);

    expressions = splitExpressions.map((latex, index) => ({
      id: `expr_${index + 1}`,
      latex,
      color: defaultPalette[index % defaultPalette.length],
      hidden: false,
    }));
  }

  if (expressions.length === 0) {
    expressions = [
      {
        id: "expr_1",
        latex: "y=x^2",
        color: defaultPalette[0],
        hidden: false,
      },
    ];
  }

  return expressions;
}

function createGraphServer() {
  const server = new McpServer({ name: "desmos-graph-app", version: "0.4.0" });

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
            "openai/widgetDescription":
              "Muestra una gráfica interactiva en Desmos con una o varias expresiones, resumen, puntos clave y leyenda.",
            "openai/widgetPrefersBorder": true,
            "openai/widgetCSP": {
              resource_domains: ["https://www.desmos.com"],
            },
          },
        },
      ],
    })
  );

  registerAppTool(
    server,
    "graph_expression",
    {
      title: "Graficar expresión",
      description:
        "Muestra una o varias funciones o ecuaciones en Desmos. Si hay varias, deben enviarse como elementos separados en expressions. Nunca concatenes varias funciones en una sola expresión.",
      inputSchema: {
        title: z.string().optional(),
        summary: z.string().optional(),
        keyPoints: z.array(z.string()).optional(),
        latex: z.string().optional(),
        expressions: z
          .array(
            z.object({
              id: z.string().optional(),
              latex: z.string().min(1),
              color: z.string().optional(),
              hidden: z.boolean().optional(),
            })
          )
          .optional(),
      },
      _meta: {
        ui: { resourceUri: "ui://widget/graph.html" },
      },
    },
    async (args) => {
      const title = args?.title?.trim?.() || "Gráfica";
      const summary = args?.summary?.trim?.() || "";
      const keyPoints = Array.isArray(args?.keyPoints) ? args.keyPoints : [];
      const expressions = normalizeExpressionsFromArgs(args);

      return {
        content: [
          {
            type: "text",
            text: `Mostrando ${expressions.length} expresión(es) en Desmos`,
          },
        ],
        structuredContent: {
          title,
          expressions,
          summary,
          keyPoints,
        },
      };
    }
  );

  registerAppTool(
    server,
    "study_function",
    {
      title: "Estudiar y graficar función",
      description:
        "Analiza brevemente una o varias funciones y las muestra en Desmos. Si hay varias, envíalas como elementos separados en expressions.",
      inputSchema: {
        title: z.string().optional(),
        summary: z.string().optional(),
        keyPoints: z.array(z.string()).optional(),
        latex: z.string().optional(),
        expressions: z
          .array(
            z.object({
              id: z.string().optional(),
              latex: z.string().min(1),
              color: z.string().optional(),
              hidden: z.boolean().optional(),
            })
          )
          .optional(),
      },
      _meta: {
        ui: { resourceUri: "ui://widget/graph.html" },
      },
    },
    async (args) => {
      const title = args?.title?.trim?.() || "Estudio de función";
      const summary = args?.summary?.trim?.() || "";
      const keyPoints = Array.isArray(args?.keyPoints) ? args.keyPoints : [];
      const expressions = normalizeExpressionsFromArgs(args);

      return {
        content: [
          {
            type: "text",
            text: `Mostrando el estudio de ${expressions.length} expresión(es)`,
          },
        ],
        structuredContent: {
          title,
          expressions,
          summary,
          keyPoints,
        },
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