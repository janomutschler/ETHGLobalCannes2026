// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AgentActions {
    string public lastAction;
    event ActionLogged(address indexed sender, string action);

    function logAction(string memory action) external {
        lastAction = action;
        emit ActionLogged(msg.sender, action);
    }
}