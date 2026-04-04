import { Type } from "@sinclair/typebox";
import { logAnalysisTo0G, type StorageReceipt } from "../0g/storage.js";

export const LOG_ANALYSIS_TOOL_NAME = "log_analysis_to_0g";

export const logAnalysisTool = {
  name: LOG_ANALYSIS_TOOL_NAME,
  description:
    "Permanently logs the AI trading analysis summary to the decentralized 0G Storage network. " +
    "Returns a transaction hash and root hash for on-chain verification.",
  parameters: Type.Object({
    summary: Type.String({
      description:
        "The complete 3-sentence trading analysis to be logged on-chain.",
    }),
  }),
};

export async function executeLogAnalysisTool(params: {
  summary: string;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  let receipt: StorageReceipt;

  try {
    receipt = await logAnalysisTo0G(params.summary);
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Unknown 0G upload error";
    return {
      content: [
        {
          type: "text",
          text: `0G Storage upload failed: ${msg}`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text",
        text: [
          "Analysis permanently logged to 0G Storage.",
          `Transaction: ${receipt.txHash}`,
          `Root Hash: ${receipt.rootHash}`,
          `Timestamp: ${receipt.timestamp}`,
        ].join("\n"),
      },
    ],
  };
}
