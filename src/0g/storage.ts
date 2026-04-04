import { Indexer, ZgFile } from "@0glabs/0g-ts-sdk";
import { ethers } from "ethers";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const EVM_RPC = "https://evmrpc-testnet.0g.ai";
const INDEXER_RPC = "https://indexer-storage-testnet-turbo.0g.ai";

export interface StorageReceipt {
  txHash: string;
  rootHash: string;
  timestamp: string;
}

export async function logAnalysisTo0G(
  aiSummaryText: string,
): Promise<StorageReceipt> {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY is not set in environment");
  }

  const timestamp = new Date().toISOString();
  const payload = JSON.stringify(
    {
      type: "trading-research-analysis",
      version: "1.0.0",
      timestamp,
      analysis: aiSummaryText,
    },
    null,
    2,
  );

  const tempPath = join(tmpdir(), `0g-analysis-${Date.now()}.json`);

  try {
    writeFileSync(tempPath, payload, "utf-8");

    const file = await ZgFile.fromFilePath(tempPath);

    const [tree, treeErr] = await file.merkleTree();
    if (treeErr !== null) {
      await file.close();
      throw new Error(`Merkle tree generation failed: ${treeErr}`);
    }

    const rootHash = tree!.rootHash();

    const provider = new ethers.JsonRpcProvider(EVM_RPC);
    const signer = new ethers.Wallet(privateKey, provider);
    const indexer = new Indexer(INDEXER_RPC);

    const [tx, uploadErr] = await indexer.upload(file, EVM_RPC, signer);
    await file.close();

    if (uploadErr !== null) {
      throw new Error(`0G upload failed: ${uploadErr}`);
    }

    return {
      txHash: tx as string,
      rootHash,
      timestamp,
    };
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      // temp file cleanup is best-effort
    }
  }
}
