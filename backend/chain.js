import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const abi = [
  "function logAction(string memory action) external",
  "function lastAction() external view returns (string memory)"
];

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, wallet);

export async function logOnChain(action) {
  try {
    console.log(`[logOnChain] Logging action: ${action}`);
    const tx = await contract.logAction(action);
    console.log(`[logOnChain] Transaction sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[logOnChain] Transaction confirmed: ${receipt.hash}`);
    return {
      ok: true,
      txHash: receipt.hash,
      action
    };
  } catch (error) {
    console.error(`[logOnChain] Error:`, error);
    throw error;
  }
}

export async function sendCoins(to, amount) {
  const tx = await wallet.sendTransaction({
    to,
    value: ethers.parseEther(amount)
  });
  const receipt = await tx.wait();
  return {
    ok: true,
    txHash: receipt.hash,
    to,
    amount
  };
}

export async function readLastAction() {
  try {
    console.log(`[readLastAction] Reading last action from contract...`);
    const lastAction = await contract.lastAction();
    console.log(`[readLastAction] Last action: ${lastAction}`);
    return {
      ok: true,
      lastAction: lastAction || "No actions logged yet",
      contractAddress: process.env.CONTRACT_ADDRESS
    };
  } catch (error) {
    console.error(`[readLastAction] Error:`, error);
    throw error;
  }
}