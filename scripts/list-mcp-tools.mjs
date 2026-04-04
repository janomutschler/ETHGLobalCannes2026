import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.env.ZERO_G_MCP_COMMAND || "npx",
  args: process.env.ZERO_G_MCP_ARGS
    ? JSON.parse(process.env.ZERO_G_MCP_ARGS)
    : ["-y", "@0gfoundation/0g-cc"],
  env: { ...getDefaultEnvironment(), ...process.env },
  stderr: "inherit",
});

const client = new Client({ name: "0g-tool-list", version: "1.0.0" }, { capabilities: {} });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  for (const t of tools) {
    console.log(t.name);
  }
} finally {
  await client.close();
}
