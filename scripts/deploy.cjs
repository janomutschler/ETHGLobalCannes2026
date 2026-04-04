const { ethers } = require("hardhat");

async function main() {
  const Factory = await ethers.getContractFactory("AgentActions");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();
  console.log("AgentActions deployed to:", await contract.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});