// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Constant-product bonding curve (x * y = k) with a virtual ETH reserve.
/// Every buy and sell pays FEE_BPS of the ETH side to the fee splitter.
contract CurveMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 100; // 1%

    IERC20 public token;
    address public immutable feeSink;
    address private immutable deployer;

    uint256 public immutable virtualEth;
    uint256 public ethReserve; // real ETH held for sellers

    event Trade(address indexed trader, bool isBuy, uint256 ethAmount, uint256 tokenAmount, uint256 fee);

    constructor(address feeSink_, uint256 virtualEth_) {
        feeSink = feeSink_;
        virtualEth = virtualEth_;
        deployer = msg.sender;
    }

    /// @dev Called once by the factory after the token (which mints to this market) exists.
    function init(IERC20 token_) external {
        require(msg.sender == deployer && address(token) == address(0), "init");
        token = token_;
    }

    function reserves() public view returns (uint256 eth, uint256 tokens) {
        return (virtualEth + ethReserve, token.balanceOf(address(this)));
    }

    function quoteBuy(uint256 ethIn) public view returns (uint256 tokensOut, uint256 fee) {
        fee = ethIn * FEE_BPS / 10_000;
        (uint256 x, uint256 y) = reserves();
        uint256 net = ethIn - fee;
        tokensOut = y * net / (x + net);
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 ethOut, uint256 fee) {
        (uint256 x, uint256 y) = reserves();
        uint256 gross = x * tokensIn / (y + tokensIn);
        if (gross > ethReserve) gross = ethReserve;
        fee = gross * FEE_BPS / 10_000;
        ethOut = gross - fee;
    }

    function buy(uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        uint256 fee;
        (tokensOut, fee) = quoteBuy(msg.value);
        require(tokensOut >= minTokensOut && tokensOut > 0, "slippage");
        ethReserve += msg.value - fee;
        _sendEth(feeSink, fee);
        token.safeTransfer(msg.sender, tokensOut);
        emit Trade(msg.sender, true, msg.value, tokensOut, fee);
    }

    function sell(uint256 tokensIn, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        uint256 fee;
        (ethOut, fee) = quoteSell(tokensIn);
        require(ethOut >= minEthOut && ethOut > 0, "slippage");
        token.safeTransferFrom(msg.sender, address(this), tokensIn);
        ethReserve -= ethOut + fee;
        _sendEth(feeSink, fee);
        _sendEth(msg.sender, ethOut);
        emit Trade(msg.sender, false, ethOut, tokensIn, fee);
    }

    function _sendEth(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "eth transfer failed");
    }
}
