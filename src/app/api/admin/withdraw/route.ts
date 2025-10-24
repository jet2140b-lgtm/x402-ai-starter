// src/app/api/admin/withdraw/route.ts
// 运行在 Node 环境，便于使用 SDK
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";
import { parseUnits } from "viem/utils";
// 仍然保留 export const runtime = "nodejs";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Use POST with header x-admin-token to withdraw.",
    example: {
      curl: 'curl -X POST https://你的域名.vercel.app/api/admin/withdraw -H "content-type: application/json" -H "x-admin-token: <ADMIN_TOKEN>" -d \'{"to":"0x...","amount":"10","asset":"USDC"}\''
    }
  });
}


// Base 主网 USDC 合约（6位小数）
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54b268c0e6";
// 你自己的 X404 合约地址（18位小数）——也可以直接读 env
const X404 = process.env.X404_CONTRACT_ADDRESS!;

function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}
function bad(msg: string, code = 400) {
  return ok({ error: msg }, code);
}

export async function POST(req: NextRequest) {
  // 简单鉴权：只接受带有正确管理令牌的请求
  const token = req.headers.get("x-admin-token");
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return bad("unauthorized", 401);
  }

  const body = await req.json().catch(() => ({}));
  const { to, amount, asset = "USDC" } = body as {
    to: string;          // 收款地址
    amount: string;      // “整币”数量：例如 "100" 表示 100 USDC
    asset?: "USDC" | "X404";
  };

  if (!to || !amount) return bad("missing 'to' or 'amount'");

  // 初始化 CDP 客户端（使用你在 Vercel 的环境变量）
  const cdp = new CdpClient({
    apiKeyName: process.env.CDP_API_KEY_ID!,
    apiKeySecret: process.env.CDP_API_KEY_SECRET!,
    walletSecret: process.env.CDP_WALLET_SECRET!,
  });

  // 选择代币与小数位
  const tokenAddress =
    asset === "USDC" ? USDC_BASE : X404;
  const decimals = asset === "USDC" ? 6 : Number(process.env.X404_DECIMALS || "18");

  // 发送 ERC20（从 Seller 金库 → 目标地址）
  const tx = await cdp.transfers.sendErc20({
    tokenAddress,
    to,
    amount: parseUnits(amount, decimals),
  });

  return ok({ ok: true, asset, to, amount, tx });
}
