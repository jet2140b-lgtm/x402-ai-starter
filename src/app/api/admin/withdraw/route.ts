// src/app/api/admin/withdraw/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";
import { parseUnits } from "viem/utils";

// Base USDC（6 位小数）
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54b268c0e6";
// 你的 X404 合约地址（18 位小数）
const X404 = process.env.X404_CONTRACT_ADDRESS!;

function ok(data: any, code = 200) {
  return NextResponse.json(data, { status: code });
}
function bad(msg: string, code = 400) {
  return ok({ error: msg }, code);
}

// 直接用浏览器 GET 时给出说明，避免 405
export async function GET() {
  return ok({
    ok: true,
    message: "Use POST with header x-admin-token to withdraw.",
    example: {
      curl:
        'curl -X POST https://<你的域名>/api/admin/withdraw ' +
        '-H "content-type: application/json" ' +
        '-H "x-admin-token: <ADMIN_TOKEN>" ' +
        `-d '{"to":"0x收款地址","amount":"10","asset":"USDC"}'`,
    },
  });
}

export async function POST(req: NextRequest) {
  // 简单鉴权
  const token = req.headers.get("x-admin-token");
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return bad("unauthorized", 401);
  }

  const body = await req.json().catch(() => ({}));
  const { to, amount, asset = "USDC" } = body as {
    to: string;
    amount: string; // “整币”数量，如 "100"
    asset?: "USDC" | "X404";
  };

  if (!to || !amount) return bad("missing 'to' or 'amount'");

  // 初始化 CDP 客户端
  const cdp = new CdpClient({
    apiKeyName: process.env.CDP_API_KEY_ID!,
    apiKeySecret: process.env.CDP_API_KEY_SECRET!,
    walletSecret: process.env.CDP_WALLET_SECRET!,
  });

  const tokenAddress = asset === "USDC" ? USDC_BASE : X404;
  const decimals = asset === "USDC" ? 6 : Number(process.env.X404_DECIMALS || "18");

  const tx = await cdp.transfers.sendErc20({
    tokenAddress,
    to,
    amount: parseUnits(amount, decimals),
  });

  return ok({ ok: true, asset, to, amount, tx });
}
