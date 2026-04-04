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
  const tx = await contract.logAction(action);
  const receipt = await tx.wait();
  return {
    ok: true,
    txHash: receipt.hash,
    action
  };
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